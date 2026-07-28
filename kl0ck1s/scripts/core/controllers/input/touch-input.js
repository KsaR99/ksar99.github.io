"use strict";

import {InputSource} from "./input-source.js";
import {MOVEMENT_KEYS} from "./keyboard-input.js";

// Codes that make sense to auto-repeat while a touch-controls button is
// held down, mirroring KeyboardInput's REPEATABLE_KEYS behaviour.
const REPEATABLE_CODES = new Set(["ArrowLeft", "ArrowRight", "ArrowDown"]);
const REPEAT_INITIAL_DELAY_MS = 100;
const REPEAT_INTERVAL_MS = 50;

// On-canvas gesture tuning.
const TAP_MAX_MOVEMENT_PX = 12;
const TAP_MAX_DURATION_MS = 250;
const SWIPE_DOWN_THRESHOLD_PX = 40;

/**
 * Touch input source for mobile. Two independent pieces:
 *
 *  1. bind() — direct touches on the board canvas: dragging steers the
 *     piece toward the finger (same column math as MouseInput), a quick
 *     tap rotates, and a downward swipe hard-drops.
 *  2. bindButtons(root) — the on-screen button bar (touch-controls),
 *     reusing the same `data-key-action` markup as the keyboard legend,
 *     but bound to pointerdown/pointerup so movement buttons can be held
 *     down to repeat instead of requiring one tap per row/column.
 *
 * Both report to the shared SteeringArbiter exactly like the other
 * sources, so keyboard/mouse/touch never fight over who's steering.
 */
export class TouchInput extends InputSource {
    /**
     * @param {object} game
     * @param {import("./steering-arbiter.js").SteeringArbiter} steeringArbiter
     * @param {object} [options]
     * @param {(code: string) => (() => void) | undefined} [options.getAction] - resolves a data-key-action code to the same action KeyboardInput would run for it
     */
    constructor(game, steeringArbiter, {getAction} = {}) {
        super(game, steeringArbiter);
        this.getAction = getAction ?? (() => undefined);

        this.canvas = null;
        this._canvasHandlers = null;
        this._activeTouchId = null;
        this._startX = 0;
        this._startY = 0;
        this._startTime = 0;
        this._dragged = false;

        this._buttonsRoot = null;
        this._buttonHandlers = [];
        this._heldTimers = new Map();
    }

    // --- canvas: drag to steer, tap to rotate, swipe down to hard-drop ---

    steerTo(clientX) {
        const game = this.game;
        const column = game.renderer.columnFromClientX(clientX);
        if (column === null || column === undefined) return;
        this.steeringArbiter.markPointerSteer();
        game.pieceController.moveToColumn(column);
    }

    bind() {
        const game = this.game;
        if (!game.dom) return;
        const canvas = game.dom.getElementById("klockis-board");
        if (!canvas) return;
        this.canvas = canvas;

        const findActiveTouch = (touchList) => {
            for (const touch of touchList) {
                if (touch.identifier === this._activeTouchId) return touch;
            }
            return null;
        };

        const onTouchStart = (event) => {
            if (game.state !== "running") return;
            const touch = event.changedTouches[0];
            if (!touch || this._activeTouchId !== null) return;
            event.preventDefault();
            this._activeTouchId = touch.identifier;
            this._startX = touch.clientX;
            this._startY = touch.clientY;
            this._startTime = Date.now();
            this._dragged = false;
        };

        const onTouchMove = (event) => {
            if (this._activeTouchId === null) return;
            const touch = findActiveTouch(event.changedTouches);
            if (!touch) return;
            event.preventDefault();

            if (!this._dragged) {
                const dx = touch.clientX - this._startX;
                const dy = touch.clientY - this._startY;
                if (Math.abs(dx) > TAP_MAX_MOVEMENT_PX || Math.abs(dy) > TAP_MAX_MOVEMENT_PX) {
                    this._dragged = true;
                }
            }
            if (this._dragged && game.state === "running") this.steerTo(touch.clientX);
        };

        const endTouch = (event) => {
            if (this._activeTouchId === null) return;
            const touch = findActiveTouch(event.changedTouches);
            if (!touch) {
                this._activeTouchId = null;
                this._dragged = false;
                return;
            }
            event.preventDefault();

            const dt = Date.now() - this._startTime;
            const dy = touch.clientY - this._startY;
            const dx = touch.clientX - this._startX;

            if (game.state === "running") {
                if (!this._dragged && dt <= TAP_MAX_DURATION_MS) {
                    game.pieceController.rotate();
                } else if (dy > SWIPE_DOWN_THRESHOLD_PX && Math.abs(dy) > Math.abs(dx)) {
                    game.pieceController.hardDrop();
                }
            }

            this._activeTouchId = null;
            this._dragged = false;
        };

        canvas.addEventListener("touchstart", onTouchStart, {passive: false});
        canvas.addEventListener("touchmove", onTouchMove, {passive: false});
        canvas.addEventListener("touchend", endTouch, {passive: false});
        canvas.addEventListener("touchcancel", endTouch, {passive: false});

        this._canvasHandlers = {onTouchStart, onTouchMove, endTouch};
    }

    unbind() {
        this.stopAllRepeats();

        if (this._canvasHandlers && this.canvas) {
            const {onTouchStart, onTouchMove, endTouch} = this._canvasHandlers;
            this.canvas.removeEventListener("touchstart", onTouchStart);
            this.canvas.removeEventListener("touchmove", onTouchMove);
            this.canvas.removeEventListener("touchend", endTouch);
            this.canvas.removeEventListener("touchcancel", endTouch);
        }
        this._canvasHandlers = null;
        this.canvas = null;
        this._activeTouchId = null;

        if (this._buttonsRoot) {
            this._buttonHandlers.forEach(({
                                              el,
                                              type,
                                              handler,
                                              options
                                          }) => el.removeEventListener(type, handler, options));
        }
        this._buttonHandlers = [];
        this._buttonsRoot = null;
    }

    // --- button bar: press-and-hold repeat for movement, tap for the rest ---

    stopRepeat(code) {
        const timers = this._heldTimers.get(code);
        if (!timers) return;
        if (timers.timeoutId !== undefined) clearTimeout(timers.timeoutId);
        if (timers.intervalId !== undefined) clearInterval(timers.intervalId);
        this._heldTimers.delete(code);
    }

    stopAllRepeats() {
        this._heldTimers.forEach((timers) => {
            if (timers.timeoutId !== undefined) clearTimeout(timers.timeoutId);
            if (timers.intervalId !== undefined) clearInterval(timers.intervalId);
        });
        this._heldTimers.clear();
    }

    startRepeat(code, action) {
        this.stopRepeat(code);
        const timeoutId = setTimeout(() => {
            const intervalId = setInterval(action, REPEAT_INTERVAL_MS);
            this._heldTimers.set(code, {intervalId});
        }, REPEAT_INITIAL_DELAY_MS);
        this._heldTimers.set(code, {timeoutId});
    }

    /** Binds every [data-key-action] button under `root` (the touch-controls bar). */
    bindButtons(root) {
        if (!root) return;
        this._buttonsRoot = root;

        const addListener = (el, type, handler, options) => {
            el.addEventListener(type, handler, options);
            this._buttonHandlers.push({el, type, handler, options});
        };

        root.querySelectorAll("[data-key-action]").forEach((el) => {
            const code = el.dataset.keyAction;
            const action = this.getAction(code);
            if (!action) return;

            const runAction = () => {
                if (MOVEMENT_KEYS.has(code)) this.steeringArbiter.markKeyboardSteer();
                action();
            };

            if (REPEATABLE_CODES.has(code)) {
                const onPointerDown = (event) => {
                    event.preventDefault();
                    runAction();
                    this.startRepeat(code, runAction);
                };
                const onPointerUp = () => this.stopRepeat(code);

                addListener(el, "pointerdown", onPointerDown);
                addListener(el, "pointerup", onPointerUp);
                addListener(el, "pointerleave", onPointerUp);
                addListener(el, "pointercancel", onPointerUp);
            } else {
                const onPointerDown = (event) => {
                    event.preventDefault();
                    runAction();
                };
                addListener(el, "pointerdown", onPointerDown);
            }
        });
    }
}
