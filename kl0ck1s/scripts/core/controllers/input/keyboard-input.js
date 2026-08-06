"use strict";

import {InputSource} from "./input-source.js";

const PREVENT_DEFAULT_KEYS = new Set([
    "ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space", "Enter", "Escape"
]);

const REPEATABLE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowDown"]);

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
     * @param {object} [callbacks]
     * @param {() => void} [callbacks.onToggleControlsList] - UI concern owned by InputController, not this source
     */
    constructor(game, steeringArbiter, {onToggleControlsList} = {}) {
        super(game, steeringArbiter);
        this.onToggleControlsList = onToggleControlsList ?? (() => {
        });
        this.heldTimers = new Map();
        this._keydownHandler = null;
        this._keyupHandler = null;
        this._blurHandler = null;
    }

    get keyActions() {
        const game = this.game;
        const isMenuScreen = () => game.state === "idle" || game.state === "gameOver-saved";
        return {
            ArrowLeft: () => game.pieceController.handleHorizontalArrow(-1),
            ArrowRight: () => game.pieceController.handleHorizontalArrow(1),
            ArrowDown: () => isMenuScreen() ? game.screenFlow.moveMenuFocus(1) : game.pieceController.softDrop(),
            ArrowUp: () => isMenuScreen() ? game.screenFlow.moveMenuFocus(-1) : game.pieceController.rotate(),
            Space: () => game.pieceController.hardDrop(),
            Enter: () => game.screenFlow.handleEnter(),
            Escape: () => game.screenFlow.handleEscape(),
            KeyH: () => this.onToggleControlsList(),
            KeyM: () => game.settingsController.toggleSound(),
            KeyO: () => game.screenFlow.toggleOptions(),
            KeyP: () => game.screenFlow.togglePause(),
            KeyZ: () => game.pieceController.rotate(),
            KeyA: () => game.pieceController.rotate180(),
            KeyR: () => game.screenFlow.restart(),
            KeyX: () => game.screenFlow.exitToMenu(),
        };
    }

    bindKeyActionElements(root) {
        if (!root) return;
        const keyActions = this.keyActions;
        root.querySelectorAll("[data-key-action]").forEach((el) => {
            const code = el.dataset.keyAction;
            const action = keyActions[code];
            if (!action) return;
            el.addEventListener("click", () => {
                if (MOVEMENT_KEYS.has(code)) this.steeringArbiter.markKeyboardSteer();
                action();
            });
        });
    }

    stopRepeat(code) {
        const timers = this.heldTimers.get(code);
        if (!timers) return;
        if (timers.timeoutId !== undefined) clearTimeout(timers.timeoutId);
        if (timers.intervalId !== undefined) clearInterval(timers.intervalId);
        this.heldTimers.delete(code);
    }

    startRepeat(code, action) {
        this.stopRepeat(code);
        const settings = this.game.settings;
        const dasMs = settings?.keyboardDAS ?? DEFAULT_DAS_MS;
        const arrMs = settings?.keyboardARR ?? DEFAULT_ARR_MS;
        const timeoutId = setTimeout(() => {
            const intervalId = setInterval(action, arrMs);
            this.heldTimers.set(code, {intervalId});
        }, dasMs);
        this.heldTimers.set(code, {timeoutId});
    }

    stopAllRepeats() {
        this.heldTimers.forEach((timers) => {
            if (timers.timeoutId !== undefined) clearTimeout(timers.timeoutId);
            if (timers.intervalId !== undefined) clearInterval(timers.intervalId);
        });
        this.heldTimers.clear();
    }

    bind() {
        const game = this.game;
        if (!game.dom) return;

        const keyActions = this.keyActions;

        this._keydownHandler = (event) => {
            if (isTypingInField(event) && event.code !== "Enter") return;

            if (PREVENT_DEFAULT_KEYS.has(event.code)) event.preventDefault();

            const baseAction = keyActions[event.code];
            if (!baseAction) return;

            const action = MOVEMENT_KEYS.has(event.code)
                ? () => {
                    this.steeringArbiter.markKeyboardSteer();
                    baseAction();
                }
                : baseAction;

            if (REPEATABLE_KEYS.has(event.code)) {
                if (event.repeat) return;
                action();
                this.startRepeat(event.code, action);
                return;
            }

            if (event.repeat && event.code === "Space") return;
            action();
        };

        this._keyupHandler = (event) => this.stopRepeat(event.code);
        this._blurHandler = () => this.stopAllRepeats();

        game.dom.addEventListener("keydown", this._keydownHandler);
        game.dom.addEventListener("keyup", this._keyupHandler, {passive: true});
        if (globalThis.window) window.addEventListener("blur", this._blurHandler);
    }

    unbind() {
        const game = this.game;
        this.stopAllRepeats();

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
