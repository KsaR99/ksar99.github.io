// @ts-nocheck
"use strict";

import {InputSource} from "./input-source.js";
import {MOVEMENT_KEYS} from "./keyboard-input.js";
import {PIECE_CONTROLLABLE_STATES} from "../../game/game-constants.js";

const REPEATABLE_CODES = new Set(["ArrowLeft", "ArrowRight", "ArrowDown"]);

const TAP_MAX_MOVEMENT_PX = 12;
const TAP_MAX_DURATION_MS = 250;
const SWIPE_DOWN_THRESHOLD_RATIO = 0.22;

const DRAG_DISTANCE_IN_SCREENS = 0.8;

const JOYSTICK_DEADZONE_RATIO = 0.08;

const JOYSTICK_STEP_ZONE_RATIO = 0.30;
const JOYSTICK_ARR_AT_STEP_EDGE_MS = 90;
const JOYSTICK_ARR_MIN_MS = 28;

function joystickArrForPush(distRatio) {
    const t = Math.min(1, Math.max(0, (distRatio - JOYSTICK_STEP_ZONE_RATIO) / (1 - JOYSTICK_STEP_ZONE_RATIO)));
    return JOYSTICK_ARR_AT_STEP_EDGE_MS + t * (JOYSTICK_ARR_MIN_MS - JOYSTICK_ARR_AT_STEP_EDGE_MS);
}

export class TouchInput extends InputSource {

    getAction: (button: HTMLElement) => string | null;
    canvas: null;
    _canvasHandlers: null;
    _activeTouchId: null;
    _startX: 0;
    _startY: 0;
    _startTime: 0 | number;
    _dragged: false | true;
    _horizontalGesture: false | boolean;
    _dragSensitivity: 1;
    _lastSteerColumn: null;
    _pendingTouch: null;
    _moveFrameId: null | number;
    _buttonsRoot: null;
    _buttonHandlers: Map<HTMLElement, EventListener>;
    _joystickRoot: null;
    _joystickDirection: null;
    _joystickPointerId: null;

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
        this._lastSteerColumn = null;
        this._pendingTouch = null;
        this._moveFrameId = null;

        this._buttonsRoot = null;
        this._buttonHandlers = [];

        this._joystickRoot = null;
        this._joystickDirection = null;
        this._joystickPointerId = null;
    }

    steerTo(clientX) {
        const game = this.game;
        const column = game.renderer.columnFromClientX(clientX);
        if (column === null || column === undefined) return;
        if (column === this._lastSteerColumn) return;
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
        if (this._moveFrameId !== null) return;
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

            event.preventDefault();

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

        this._joystickRoot = null;
        this._joystickDirection = null;
        this._joystickPointerId = null;
    }

    _getJoystickRunner(direction) {
        const action = this.getAction(direction);
        if (!action) return null;
        return (isRepeat) => {
            if (MOVEMENT_KEYS.has(direction)) this.steeringArbiter.markKeyboardSteer();
            action(isRepeat);
        };
    }

    _setJoystickDirection(direction, arrMs = null) {
        if (direction === this._joystickDirection) {
            if (!direction) return;
            if (arrMs === null) {
                this.stopRepeat(direction);
            } else if (this._repeatTimers.has(direction)) {
                this.updateRepeatArr(direction, arrMs);
            } else {
                const runAction = this._getJoystickRunner(direction);
                if (runAction) this.startRepeat(direction, () => runAction(true), {dasMs: arrMs, arrMs});
            }
            return;
        }

        if (this._joystickDirection) {
            this.stopRepeat(this._joystickDirection);
        }
        this._joystickDirection = direction;
        if (!direction) return;

        const runAction = this._getJoystickRunner(direction);
        if (!runAction) return;

        runAction(false);
        if (arrMs !== null) {
            this.startRepeat(direction, () => runAction(true), {dasMs: arrMs, arrMs});
        }
    }

    bindJoystick(root) {
        if (!root) return;
        const base = root.querySelector('[data-role="touch-joystick-base"]');
        const stick = root.querySelector('[data-role="touch-joystick-stick"]');
        if (!base || !stick) return;

        this._joystickRoot = root;

        const addListener = (el, type, handler, options) => {
            el.addEventListener(type, handler, options);
            this._buttonHandlers.push({el, type, handler, options});
        };

        let centerX = 0;
        let centerY = 0;
        let maxRadius = 0;

        const resetStick = () => {
            stick.classList.remove("touch-controls__joystick-stick--dragging");
            stick.style.transform = "";
            base.classList.remove("touch-controls__joystick-base--active");
        };

        const updateFromPointer = (clientX, clientY) => {
            const dx = clientX - centerX;
            const dy = clientY - centerY;
            const dist = Math.hypot(dx, dy);
            const angle = Math.atan2(dy, dx);
            const clampedDist = Math.min(dist, maxRadius);
            const visualX = Math.cos(angle) * clampedDist;
            const visualY = Math.sin(angle) * clampedDist;
            stick.style.transform = `translate(${visualX}px, ${visualY}px)`;

            const distRatio = maxRadius > 0 ? clampedDist / maxRadius : 0;
            if (distRatio < JOYSTICK_DEADZONE_RATIO) {
                this._setJoystickDirection(null);
                return;
            }

            const arrMs = distRatio < JOYSTICK_STEP_ZONE_RATIO ? null : joystickArrForPush(distRatio);
            if (Math.abs(dx) >= Math.abs(dy)) {
                this._setJoystickDirection(dx < 0 ? "ArrowLeft" : "ArrowRight", arrMs);
            } else if (dy > 0) {
                this._setJoystickDirection("ArrowDown", arrMs);
            } else {
                this._setJoystickDirection(null);
            }
        };

        const onPointerDown = (event) => {
            if (this._joystickPointerId !== null) return;
            event.preventDefault();
            this._joystickPointerId = event.pointerId;

            const rect = base.getBoundingClientRect();
            centerX = rect.left + rect.width / 2;
            centerY = rect.top + rect.height / 2;
            maxRadius = Math.max((rect.width - stick.offsetWidth) / 2, 1);

            base.classList.add("touch-controls__joystick-base--active");
            stick.classList.add("touch-controls__joystick-stick--dragging");
            base.setPointerCapture?.(event.pointerId);
            updateFromPointer(event.clientX, event.clientY);
        };

        const onPointerMove = (event) => {
            if (event.pointerId !== this._joystickPointerId) return;
            event.preventDefault();
            updateFromPointer(event.clientX, event.clientY);
        };

        const onPointerEnd = (event) => {
            if (event.pointerId !== this._joystickPointerId) return;
            this._joystickPointerId = null;
            this._setJoystickDirection(null);
            resetStick();
        };

        addListener(base, "pointerdown", onPointerDown);
        addListener(base, "pointermove", onPointerMove);
        addListener(base, "pointerup", onPointerEnd);
        addListener(base, "pointercancel", onPointerEnd);
    }

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

            const runAction = (isRepeat) => {
                if (MOVEMENT_KEYS.has(code)) this.steeringArbiter.markKeyboardSteer();
                action(isRepeat);
            };

            if (REPEATABLE_CODES.has(code)) {
                const onPointerDown = (event) => {
                    event.preventDefault();
                    runAction(false);
                    this.startRepeat(code, () => runAction(true));
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
