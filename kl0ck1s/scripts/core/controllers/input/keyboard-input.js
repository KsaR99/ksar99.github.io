"use strict";

import {InputSource} from "./input-source.js";
import {defaultKeyBindings} from "../../shared/key-bindings.js";

const PREVENT_DEFAULT_KEYS = new Set([
    "ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space", "Enter", "Escape"
]);

const REPEATABLE_SLOTS = new Set(["moveLeft", "moveRight", "softDrop"]);
const MOVEMENT_SLOTS = new Set(["moveLeft", "moveRight", "softDrop", "rotateUp", "rotateZ", "rotate180", "hardDrop"]);

export const DEFAULT_DAS_MS = 125;
export const DEFAULT_ARR_MS = 16;

export const MOVEMENT_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space", "KeyZ", "KeyA"]);

function isTypingInField(event) {
    const tag = event.target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA";
}

export class KeyboardInput extends InputSource {
    /**
     * @param {object} game
     * @param {import("./steering-arbiter.js").SteeringArbiter} steeringArbiter
     */
    constructor(game, steeringArbiter) {
        super(game, steeringArbiter);
        this.heldTimers = new Map();
        this._keydownHandler = null;
        this._keyupHandler = null;
        this._blurHandler = null;
        this._listening = false;
        this._listenHandler = null;
    }

    get actionHandlers() {
        const game = this.game;
        const isMenuScreen = () => game.state === "idle";
        return {
            moveLeft: (isRepeat) => game.pieceController.handleHorizontalArrow(-1, isRepeat),
            moveRight: (isRepeat) => game.pieceController.handleHorizontalArrow(1, isRepeat),
            softDrop: () => isMenuScreen() ? game.screenFlow.moveMenuFocus(1) : game.pieceController.softDrop(),
            rotateUp: () => isMenuScreen() ? game.screenFlow.moveMenuFocus(-1) : game.pieceController.rotate(1),
            rotateZ: () => game.pieceController.rotate(-1),
            rotate180: () => game.pieceController.rotate180(),
            hardDrop: () => game.pieceController.hardDrop(),
            confirm: () => game.screenFlow.handleEnter(),
            cancel: () => game.screenFlow.handleEscape(),
            toggleSound: () => game.settingsController.toggleSound(),
            toggleOptions: () => game.screenFlow.toggleOptions(),
            togglePause: () => game.screenFlow.togglePause(),
            restart: () => game.screenFlow.restart(),
            exitToMenu: () => game.screenFlow.exitToMenu(),
        };
    }

    get touchActions() {
        const handlers = this.actionHandlers;
        return {
            ArrowLeft: handlers.moveLeft,
            ArrowRight: handlers.moveRight,
            ArrowDown: handlers.softDrop,
            ArrowUp: handlers.rotateUp,
            Space: handlers.hardDrop,
            KeyP: handlers.togglePause,
        };
    }

    dispatchMap() {
        const bindings = {...defaultKeyBindings(), ...(this.game.settings?.keyBindings ?? {})};
        const map = {};
        Object.entries(bindings).forEach(([slotId, code]) => {
            if (code) map[code] = slotId;
        });
        return map;
    }

    stopRepeat(slotId) {
        const timers = this.heldTimers.get(slotId);
        if (!timers) return;
        if (timers.timeoutId !== undefined) clearTimeout(timers.timeoutId);
        if (timers.intervalId !== undefined) clearInterval(timers.intervalId);
        this.heldTimers.delete(slotId);
    }

    startRepeat(slotId, action) {
        this.stopRepeat(slotId);
        const settings = this.game.settings;
        const dasMs = settings?.keyboardDAS ?? DEFAULT_DAS_MS;
        const arrMs = settings?.keyboardARR ?? DEFAULT_ARR_MS;
        const timeoutId = setTimeout(() => {
            const intervalId = setInterval(action, arrMs);
            this.heldTimers.set(slotId, {intervalId});
        }, dasMs);
        this.heldTimers.set(slotId, {timeoutId});
    }

    stopAllRepeats() {
        this.heldTimers.forEach((timers) => {
            if (timers.timeoutId !== undefined) clearTimeout(timers.timeoutId);
            if (timers.intervalId !== undefined) clearInterval(timers.intervalId);
        });
        this.heldTimers.clear();
    }

    listenForNextKey(callback) {
        this.cancelListening();
        if (!globalThis.window) {
            callback(null);
            return;
        }

        this._listening = true;
        this._listenHandler = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const code = event.code === "Escape" ? null : event.code;
            this.stopListening();
            callback(code);
        };

        window.addEventListener("keydown", this._listenHandler, {capture: true});
    }

    stopListening() {
        if (this._listenHandler && globalThis.window) {
            window.removeEventListener("keydown", this._listenHandler, {capture: true});
        }
        this._listening = false;
        this._listenHandler = null;
    }

    cancelListening() {
        if (!this._listening) return;
        this.stopListening();
    }

    bind() {
        const game = this.game;
        if (!game.dom) return;

        this._keydownHandler = (event) => {
            if (this._listening) return;
            if (isTypingInField(event) && event.code !== "Enter") return;

            const isMenuScreen = game.state === "idle";
            if (isMenuScreen && (event.code === "ArrowUp" || event.code === "ArrowDown")) {
                event.preventDefault();
                if (!event.repeat) game.screenFlow.moveMenuFocus(event.code === "ArrowDown" ? 1 : -1);
                return;
            }

            let slotId = this.dispatchMap()[event.code];
            if (isMenuScreen) {
                if (event.code === "ArrowLeft") slotId = "moveLeft";
                else if (event.code === "ArrowRight") slotId = "moveRight";
            }
            if (!slotId) return;

            const baseAction = this.actionHandlers[slotId];
            if (!baseAction) return;

            if (PREVENT_DEFAULT_KEYS.has(event.code)) event.preventDefault();

            const action = MOVEMENT_SLOTS.has(slotId)
                ? (isRepeat) => {
                    this.steeringArbiter.markKeyboardSteer();
                    baseAction(isRepeat);
                }
                : baseAction;

            if (REPEATABLE_SLOTS.has(slotId)) {
                if (event.repeat) return;
                action(false);
                this.startRepeat(slotId, () => action(true));
                return;
            }

            if (event.repeat && slotId === "hardDrop") return;
            action();
        };

        this._keyupHandler = (event) => {
            if (this._listening) return;
            const isMenuScreen = game.state === "idle";
            let slotId = this.dispatchMap()[event.code];
            if (isMenuScreen) {
                if (event.code === "ArrowLeft") slotId = "moveLeft";
                else if (event.code === "ArrowRight") slotId = "moveRight";
            }
            if (slotId) this.stopRepeat(slotId);
        };
        this._blurHandler = () => this.stopAllRepeats();

        game.dom.addEventListener("keydown", this._keydownHandler);
        game.dom.addEventListener("keyup", this._keyupHandler, {passive: true});
        if (globalThis.window) window.addEventListener("blur", this._blurHandler);
    }

    unbind() {
        const game = this.game;
        this.stopAllRepeats();
        this.cancelListening();

        if (game.dom) {
            if (this._keydownHandler) game.dom.removeEventListener("keydown", this._keydownHandler);
            if (this._keyupHandler) game.dom.removeEventListener("keyup", this._keyupHandler);
        }
        if (globalThis.window && this._blurHandler) window.removeEventListener("blur", this._blurHandler);

        this._keydownHandler = null;
        this._keyupHandler = null;
        this._blurHandler = null;
    }
}
