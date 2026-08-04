"use strict";

import {InputSource} from "./input-source.js";
import {MOVEMENT_KEYS} from "./keyboard-input.js";
import {PIECE_CONTROLLABLE_STATES} from "../../game/game-constants.js";

// Codes that make sense to auto-repeat while a touch-controls button is
// held down, mirroring KeyboardInput's REPEATABLE_KEYS behavior.
const REPEATABLE_CODES = new Set(["ArrowLeft", "ArrowRight", "ArrowDown"]);
// Fallbacks only - once settings are loaded, startRepeat() reads the
// player's calibrated game.settings.keyboardDAS/keyboardARR instead, same as
// KeyboardInput (see KeyboardCalibrationController). The on-screen D-pad
// deliberately shares the keyboard's calibrated DAS/ARR rather than having
// its own - it's simulating the same discrete key-repeat behavior.
const DEFAULT_DAS_MS = 120;
const DEFAULT_ARR_MS = 16;

// On-canvas gesture tuning.
const TAP_MAX_MOVEMENT_PX = 12;
const TAP_MAX_DURATION_MS = 250;
const SWIPE_DOWN_THRESHOLD_RATIO = 0.22;

// Fraction of the screen's width a drag needs to cover to steer the piece
// all the way across the board - lets one-handed thumb reach control the
// full board without needing to physically drag edge-to-edge.
const DRAG_DISTANCE_IN_SCREENS = 0.8;

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
        this._horizontalGesture = false;
        this._dragSensitivity = 1;

        // Column the piece was last steered to - avoids re-computing/re-issuing
        // moveToColumn() on every touchmove when the finger is still hovering
        // over the same board column (very common during a fast drag).
        this._lastSteerColumn = null;

        // rAF coalescing: touchmove can fire many times per animation frame
        // (especially during a fast swipe). We only keep the latest touch
        // point and process it once per frame instead of once per event.
        this._pendingTouch = null;
        this._moveFrameId = null;

        this._buttonsRoot = null;
        this._buttonHandlers = [];
        this._heldTimers = new Map();
    }

    // --- canvas: drag to steer, tap to rotate, swipe down to hard-drop ---

    steerTo(clientX) {
        const game = this.game;
        const column = game.renderer.columnFromClientX(clientX);
        if (column === null || column === undefined) return;
        if (column === this._lastSteerColumn) return; // same cell as last time - nothing to do
        this._lastSteerColumn = column;
        this.steeringArbiter.markPointerSteer();
        game.pieceController.moveToColumn(column);
    }

    _cancelPendingMoveFrame() {
        if (this._moveFrameId !== null) {
            cancelAnimationFrame(this._moveFrameId);
            this._moveFrameId = null;
        }
        this._pendingTouch = null;
    }

    _scheduleMoveFrame() {
        if (this._moveFrameId !== null) return; // already scheduled for this frame
        this._moveFrameId = requestAnimationFrame(() => {
            this._moveFrameId = null;
            this._processPendingTouch();
        });
    }

    _processPendingTouch() {
        const touch = this._pendingTouch;
        this._pendingTouch = null;
        if (!touch || this._activeTouchId === null) return;

        const game = this.game;
        const dx = touch.clientX - this._startX;
        const dy = touch.clientY - this._startY;

        if (!this._dragged) {
            if (Math.abs(dx) > TAP_MAX_MOVEMENT_PX || Math.abs(dy) > TAP_MAX_MOVEMENT_PX) {
                this._dragged = true;
                this._horizontalGesture = Math.abs(dx) > Math.abs(dy);
            }
        }
        if (this._dragged && this._horizontalGesture && PIECE_CONTROLLABLE_STATES.has(game.state)) {
            const scaledClientX = this._startX + dx * this._dragSensitivity;
            this.steerTo(scaledClientX);
        }
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
            if (!PIECE_CONTROLLABLE_STATES.has(game.state)) return;
            const touch = event.changedTouches[0];
            if (!touch || this._activeTouchId !== null) return;
            event.preventDefault();
            this._activeTouchId = touch.identifier;
            this._startX = touch.clientX;
            this._startY = touch.clientY;
            this._startTime = Date.now();
            this._dragged = false;
            this._horizontalGesture = false;
            this._lastSteerColumn = null;

            const boardRect = canvas.getBoundingClientRect();
            const screenWidth = window.visualViewport?.width ?? window.innerWidth;
            this._dragSensitivity = game.settings?.touchSensitivity
                ?? (boardRect.width / (screenWidth * DRAG_DISTANCE_IN_SCREENS));
        };

        const onTouchMove = (event) => {
            if (this._activeTouchId === null) return;
            const touch = findActiveTouch(event.changedTouches);
            if (!touch) return;
            // Must stay synchronous - preventDefault() has no effect if
            // deferred to a later frame, and we'd lose scroll suppression.
            event.preventDefault();

            // Defer the actual math/steering to the next animation frame,
            // keeping only the latest touch point. Collapses however many
            // touchmove events land within one frame into a single update.
            this._pendingTouch = touch;
            this._scheduleMoveFrame();
        };

        const endTouch = (event) => {
            if (this._activeTouchId === null) return;
            const touch = findActiveTouch(event.changedTouches);
            this._cancelPendingMoveFrame();

            if (!touch) {
                this._activeTouchId = null;
                this._dragged = false;
                this._horizontalGesture = false;
                this._lastSteerColumn = null;
                return;
            }
            event.preventDefault();

            const dt = Date.now() - this._startTime;
            const dy = touch.clientY - this._startY;
            const dx = touch.clientX - this._startX;

            if (PIECE_CONTROLLABLE_STATES.has(game.state)) {
                if (!this._dragged && dt <= TAP_MAX_DURATION_MS) {
                    game.pieceController.rotate();
                } else {
                    const boardHeight = this.canvas.getBoundingClientRect().height;
                    const swipeDownThreshold = boardHeight * SWIPE_DOWN_THRESHOLD_RATIO;
                    if (dy > swipeDownThreshold && Math.abs(dy) > Math.abs(dx)) {
                        game.pieceController.hardDrop();
                    }
                }
            }

            this._activeTouchId = null;
            this._dragged = false;
            this._horizontalGesture = false;
            this._lastSteerColumn = null;
        };

        canvas.addEventListener("touchstart", onTouchStart, {passive: false});
        canvas.addEventListener("touchmove", onTouchMove, {passive: false});
        canvas.addEventListener("touchend", endTouch, {passive: false});
        canvas.addEventListener("touchcancel", endTouch, {passive: false});

        this._canvasHandlers = {onTouchStart, onTouchMove, endTouch};
    }

    unbind() {
        this.stopAllRepeats();
        this._cancelPendingMoveFrame();

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
        this._lastSteerColumn = null;

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
        const settings = this.game.settings;
        const dasMs = settings?.keyboardDAS ?? DEFAULT_DAS_MS;
        const arrMs = settings?.keyboardARR ?? DEFAULT_ARR_MS;
        const timeoutId = setTimeout(() => {
            const intervalId = setInterval(action, arrMs);
            this._heldTimers.set(code, {intervalId});
        }, dasMs);
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
