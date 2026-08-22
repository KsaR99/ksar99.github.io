// @ts-nocheck
"use strict";

export const KEY_BIND_SLOTS = [
    {id: "moveLeft", labelKey: "controls.moveLeftRight", defaultCode: "ArrowLeft"},
    {id: "moveRight", labelKey: "controls.moveLeftRight", defaultCode: "ArrowRight"},
    {id: "softDrop", labelKey: "controls.softDrop", defaultCode: "ArrowDown"},
    {id: "rotateUp", labelKey: "controls.rotate", defaultCode: "ArrowUp"},
    {id: "rotateZ", labelKey: "controls.rotate", defaultCode: "KeyZ"},
    {id: "rotate180", labelKey: "controls.rotate180", defaultCode: "KeyA"},
    {id: "hardDrop", labelKey: "controls.hardDrop", defaultCode: "Space"},
    {id: "confirm", labelKey: "controls.confirm", defaultCode: "Enter"},
    {id: "cancel", labelKey: "controls.cancel", defaultCode: "Escape"},
    {id: "toggleSound", labelKey: "controls.mute", defaultCode: "KeyM"},
    {id: "toggleOptions", labelKey: "controls.options", defaultCode: "KeyO"},
    {id: "togglePause", labelKey: "controls.pause", defaultCode: "KeyP"},
    {id: "restart", labelKey: "controls.restart", defaultCode: "KeyR"},
    {id: "exitToMenu", labelKey: "controls.exitToMenu", defaultCode: "KeyX"},
];

export type KeyBindingMap = Record<string, string>

export function defaultKeyBindings(): KeyBindingMap {
    const bindings: KeyBindingMap = {};
    KEY_BIND_SLOTS.forEach((slot) => {
        bindings[slot.id] = slot.defaultCode;
    });
    return bindings;
}

const NAMED_KEY_LABELS = {
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Space: "Space",
    Enter: "Enter",
    Escape: "Esc",
    Tab: "Tab",
    Backspace: "Backspace",
    ShiftLeft: "Shift",
    ShiftRight: "Shift",
    ControlLeft: "Ctrl",
    ControlRight: "Ctrl",
    AltLeft: "Alt",
    AltRight: "Alt",
};

export function formatKeyCode(code) {
    if (!code) return "—";
    if (NAMED_KEY_LABELS[code]) return NAMED_KEY_LABELS[code];
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) return `Num${code.slice(6)}`;
    if (code.startsWith("F") && /^F\d{1,2}$/.test(code)) return code;
    return code;
}
