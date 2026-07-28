"use strict";

import {InputSource} from "./input-source.js";

const PREVENT_DEFAULT_KEYS = new Set([
    "ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space", "Enter", "Escape"
]);

const REPEATABLE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowDown"]);
const REPEAT_INITIAL_DELAY_MS = 100;
const REPEAT_INTERVAL_MS = 50;

// Keys that move/rotate/drop the piece. Using one of these should win over
// pointer steering for a short window - see SteeringArbiter.markKeyboardSteer.
const MOVEMENT_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space", "KeyZ"]);

function isTypingInField(event) {
    const tag = event.target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA";
}

/**
 * Keyboard input source: arrow keys, space, enter, and the various letter
 * shortcuts. Knows nothing about mouse/touch - only maps key events to calls
 * on the other controllers, and tells the shared SteeringArbiter whenever it
 * takes over steering from a pointer source.
 */
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
        return {
            ArrowLeft: () => game.pieceController.handleHorizontalArrow(-1),
            ArrowRight: () => game.pieceController.handleHorizontalArrow(1),
            ArrowDown: () => game.pieceController.softDrop(),
            ArrowUp: () => game.pieceController.rotate(),
            Space: () => game.pieceController.hardDrop(),
            Enter: () => game.screenFlow.handleEnter(),
            Escape: () => game.screenFlow.handleEscape(),
            KeyH: () => this.onToggleControlsList(),
            KeyM: () => game.settingsController.toggleSound(),
            KeyO: () => game.screenFlow.toggleOptions(),
            KeyP: () => game.screenFlow.togglePause(),
            KeyZ: () => game.pieceController.rotate(),
            KeyR: () => game.screenFlow.restart(),
        };
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
        const timeoutId = setTimeout(() => {
            const intervalId = setInterval(action, REPEAT_INTERVAL_MS);
            this.heldTimers.set(code, {intervalId});
        }, REPEAT_INITIAL_DELAY_MS);
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
