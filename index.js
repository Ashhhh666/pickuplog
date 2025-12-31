const MODULE_NAME = "pickuplog";
const CONFIG_FILE = "settings.json";

const defaultConfig = {
    x: 20,
    y: 60,
    scale: 1.0,
    inventoryHistoryTime: 4,
    enabled: true
};

let config = {};
let saving = false;

// --- Config --- \\
function loadConfig() {
    try {
        const data = FileLib.read(MODULE_NAME, CONFIG_FILE);
        const parsed = data ? JSON.parse(data) : {};
        config = (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : { ...defaultConfig };
    } catch (e) {
        config = { ...defaultConfig };
    }
    // Fill missing keys with defaults
    for (const key in defaultConfig) {
        config[key] ??= defaultConfig[key];
    }
    // Always save to fix corrupted file
    saveConfig();
}

function saveConfig() {
    if (saving) return;
    saving = true;
    const safeConfig = (typeof config === "object" && config !== null) ? config : { ...defaultConfig };
    FileLib.write(MODULE_NAME, CONFIG_FILE, JSON.stringify(safeConfig, null, 2));
    Client.scheduleTask(1, () => saving = false);
}

register("gameLoad", loadConfig);
register("gameUnload", saveConfig);

// --- Item Detection --- \\
const MCItem = Java.type("net.minecraft.item.Item");
let lastInventory = [];
let history = {};

const makeObj = (item, slot) => {
    if (!item || typeof item.func_77973_b !== "function") return null;

    try {
        let id = MCItem.func_150891_b(item.func_77973_b());
        let name = item.func_82833_r();

        if (id === 403) { // Book
            try {
                name = item.func_82840_a(Player.getPlayer(), Client.getMinecraft().field_71474_y.field_82882_x)[1];
            } catch (e) {}
        }

        return { id, stackSize: item.field_77994_a, name, item, slot };
    } catch (e) {
        return null;
    }
};

const getInventory = () => {
    const inv = Player.getPlayer().field_71071_by;
    return {
        getItems() {
            const items = [];
            for (let i = 0; i < inv.func_70302_i_(); i++) {
                if ((i >= 36 && i <= 39) || i === 40) continue;
                const obj = makeObj(inv.func_70301_a(i), i);
                if (obj) items.push(obj);
            }
            return items;
        }
    };
};

const getSignature = (itemStack) => {
    try {
        return itemStack.func_77978_p()
            ?.func_74775_l("SkullOwner")
            ?.func_74775_l("Properties")
            ?.func_74781_a("textures")
            ?.func_150305_b(0)
            ?.func_74779_i("Signature");
    } catch (e) {
        return null;
    }
};

// --- Item History --- \\
const addItemChange = (name, amount) => {
    if (amount === 0) return;
    if (!history[name]) {
        history[name] = { net: amount, time: Date.now() };
    } else {
        history[name].net += amount;
        history[name].time = Date.now();
    }
};

// --- Inventory Tracking --- \\
register("step", () => {
    if (!config.enabled || !Player.getInventory()) return;

    const invSlots = Player.getPlayer().field_71071_by;
    const now = Date.now();

    for (let slot = 0; slot < 36; slot++) {
        const currStack = makeObj(invSlots.func_70301_a(slot), slot);
        const prevStack = lastInventory.find(i => i.slot === slot) || null;

        if (!prevStack && currStack) addItemChange(currStack.name, currStack.stackSize);
        else if (prevStack && !currStack) addItemChange(prevStack.name, -prevStack.stackSize);
        else if (prevStack && currStack) {
            if (prevStack.id !== currStack.id) {
                addItemChange(prevStack.name, -prevStack.stackSize);
                addItemChange(currStack.name, currStack.stackSize);
            } else if (prevStack.stackSize !== currStack.stackSize) {
                addItemChange(currStack.name, currStack.stackSize - prevStack.stackSize);
            } else if (currStack.id === 397 && getSignature(prevStack.item) !== getSignature(currStack.item)) {
                addItemChange(currStack.name, currStack.stackSize - prevStack.stackSize);
            }
        }
    }

    lastInventory = [];
    for (let slot = 0; slot < 36; slot++) {
        const stack = makeObj(invSlots.func_70301_a(slot), slot);
        if (stack) lastInventory.push(stack);
    }

    Object.keys(history).forEach(name => {
        if (now - history[name].time > config.inventoryHistoryTime * 1000) delete history[name];
    });
});

// --- Gui stuff --- \\
let PickupHUDGUI;
const pickupHudGui = new Gui();

function initPickupHUDGUI() {
    PickupHUDGUI = {
        x: config.x,
        y: config.y,
        scale: config.scale,
        isOpen: false,
        draw() {
            Renderer.retainTransforms(true);
            Renderer.translate(this.x, this.y);
            Renderer.scale(this.scale);

            const now = Date.now();
            const entries = Object.entries(history)
                .filter(([_, data]) => now - data.time <= config.inventoryHistoryTime * 1000 && data.net !== 0)
                .map(([name, data]) => ({
                    str: `${data.net > 0 ? "&a+" : "&c-"}${Math.abs(data.net)} ${name}`,
                    time: data.time
                }))
                .sort((a, b) => b.time - a.time);

            if (this.isOpen) {
                Renderer.drawString("&a+16 &fExample Item", 0, 0);
                Renderer.drawString("&c-1 &fExample Item", 0, 12);
                Renderer.drawString("&a+5 &fDiamond", 0, 24);
            } else {
                entries.forEach((entry, i) => Renderer.drawStringWithShadow(entry.str, 0, i * 12));
            }

            Renderer.retainTransforms(false);
            Renderer.finishDraw();
        }
    };
}

register("gameLoad", () => {
    loadConfig();
    initPickupHUDGUI();
});

register("renderOverlay", () => PickupHUDGUI?.draw());

// --- HUD Editor --- \\
export function openPickupHudEditor() {
    if (!PickupHUDGUI) initPickupHUDGUI();

    PickupHUDGUI.isOpen = true;
    pickupHudGui.open();

    const dragMove = register("dragged", (dx, dy, x, y, button) => {
        if (!PickupHUDGUI.isOpen || button === 2) return;
        PickupHUDGUI.x = x;
        PickupHUDGUI.y = y;
    });

    const scrollMove = register("scrolled", (_, __, dir) => {
        if (!PickupHUDGUI.isOpen) return;
        PickupHUDGUI.scale = Math.min(4, Math.max(0.5, +(PickupHUDGUI.scale + (dir === 1 ? 0.05 : -0.05)).toFixed(2)));
    });

    const closeEditor = () => {
        config.x = PickupHUDGUI.x;
        config.y = PickupHUDGUI.y;
        config.scale = PickupHUDGUI.scale;
        saveConfig();

        PickupHUDGUI.isOpen = false;
        pickupHudGui.close();

        dragMove.unregister();
        scrollMove.unregister();
        mouseClose.unregister();
        keyClose.unregister();
    };

    const mouseClose = register("guiMouseClick", (_, __, button) => { if (button === 1) closeEditor(); });
    const keyClose = register("guiKey", (_, key) => { if (key === 1) closeEditor(); });
}

// --- Commands --- \\
register("command", () => openPickupHudEditor()).setName("itemhud");

register("command", seconds => {
    const s = parseInt(seconds);
    if (isNaN(s) || s < 1 || s > 30) {
        ChatLib.chat("&cUsage: /itemtime <1-30>");
        return;
    }
    config.inventoryHistoryTime = s;
    saveConfig();
    ChatLib.chat(`&aPickup HUD duration set to &f${s}s`);
}).setName("itemtime");
