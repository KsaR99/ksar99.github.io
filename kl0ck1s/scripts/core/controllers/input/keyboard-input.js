"use strict";

import {DEFAULT_ARR_MS, DEFAULT_DAS_MS, InputSource} from "./input-source.js";
import {defaultKeyBindings} from "../../shared/key-bindings.js";

export {DEFAULT_DAS_MS, DEFAULT_ARR_MS};

const PREVENT_DEFAULT_KEYS = new Set([
    "ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space", "Enter", "Escape"
]);

const REPEATABLE_SLOTS = new Set(["moveLeft", "moveRight", "softDrop"]);
const MOVEMENT_SLOTS = new Set(["moveLeft", "moveRight", "softDrop", "rotateUp", "rotateZ", "rotate180", "hardDrop"]);
const OPPOSITE_HORIZONTAL_SLOT = {moveLeft: "moveRight", moveRight: "moveLeft"};

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
        this._keydownHandler = null;
        this._keyupHandler = null;
        this._blurHandler = null;
        this._listening = false;
        this._listenHandler = null;
        this._heldHorizontal = new Set();
        this._activeHorizontal = null;
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

    _buildAction(slotId) {
        const baseAction = this.actionHandlers[slotId];
        if (!baseAction) return null;
        if (!MOVEMENT_SLOTS.has(slotId)) return baseAction;
        return (isRepeat) => {
            this.steeringArbiter.markKeyboardSteer();
            baseAction(isRepeat);
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
            if (game.multiplayerController?.isOpen) return;

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

            const action = this._buildAction(slotId);
            if (!action) return;

            if (PREVENT_DEFAULT_KEYS.has(event.code)) event.preventDefault();

            if (REPEATABLE_SLOTS.has(slotId)) {
                if (event.repeat) return;

                const opposite = OPPOSITE_HORIZONTAL_SLOT[slotId];
                if (opposite) {
                    this._heldHorizontal.add(slotId);
                    if (this._heldHorizontal.has(opposite)) this.stopRepeat(opposite);
                    this._activeHorizontal = slotId;
                }

                action(false);
                this.startRepeat(slotId, () => action(true));
                return;
            }

            if (event.repeat) return;
            action();
        };

        this._keyupHandler = (event) => {
            if (this._listening) return;
            if (game.multiplayerController?.isOpen) return;
            const isMenuScreen = game.state === "idle";
            let slotId = this.dispatchMap()[event.code];
            if (isMenuScreen) {
                if (event.code === "ArrowLeft") slotId = "moveLeft";
                else if (event.code === "ArrowRight") slotId = "moveRight";
            }
            if (!slotId) return;

            const opposite = OPPOSITE_HORIZONTAL_SLOT[slotId];
            if (opposite) {
                this._heldHorizontal.delete(slotId);
                this.stopRepeat(slotId);
                if (this._activeHorizontal === slotId) {
                    this._activeHorizontal = null;
                    if (this._heldHorizontal.has(opposite)) {
                        const resumeAction = this._buildAction(opposite);
                        if (resumeAction) {
                            this._activeHorizontal = opposite;
                            resumeAction(false);
                            this.startRepeat(opposite, () => resumeAction(true));
                        }
                    }
                }
                return;
            }

            this.stopRepeat(slotId);
        };
        this._blurHandler = () => {
            this.stopAllRepeats();
            this._heldHorizontal.clear();
            this._activeHorizontal = null;
        };

        game.dom.addEventListener("keydown", this._keydownHandler);
        game.dom.addEventListener("keyup", this._keyupHandler, {passive: true});
        if (globalThis.window) window.addEventListener("blur", this._blurHandler);
    }

    unbind() {
        const game = this.game;
        this.stopAllRepeats();
        this.cancelListening();
        this._heldHorizontal.clear();
        this._activeHorizontal = null;

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
