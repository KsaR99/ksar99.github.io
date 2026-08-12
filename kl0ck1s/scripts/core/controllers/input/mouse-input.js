"use strict";

import {InputSource} from "./input-source.js";
import {PIECE_CONTROLLABLE_STATES} from "../../game/game-constants.js";

const SOFT_DROP_REPEAT_INTERVAL_MS = 50;

export class MouseInput extends InputSource {
    constructor(game, steeringArbiter) {
        super(game, steeringArbiter);
        this.canvas = null;
        this.softDropIntervalId = undefined;
        this._handlers = null;
    }

    stopSoftDrop() {
        if (this.softDropIntervalId === undefined) return;
        clearInterval(this.softDropIntervalId);
        this.softDropIntervalId = undefined;
    }

    steerTo(clientX) {
        const game = this.game;
        const sensitivity = game.settings?.mouseSensitivity ?? 1;

        let effectiveX = clientX;
        if (sensitivity !== 1) {
            const rect = game.renderer.boardCanvasRect ?? this.canvas?.getBoundingClientRect();
            if (rect) {
                const centerX = rect.left + rect.width / 2;
                effectiveX = centerX + (clientX - centerX) * sensitivity;
            }
        }

        const column = game.renderer.columnFromClientX(effectiveX);
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

        const onContextMenu = (event) => event.preventDefault();

        const onMouseMove = (event) => {
            game.pointerClientX = event.clientX;
            game.pointerClientY = event.clientY;

            const calibrating = game.state === "calibrating";
            if (!game.settings?.mouseControl && !calibrating) return;

            if (!PIECE_CONTROLLABLE_STATES.has(game.state)) return;
            if (!calibrating && this.steeringArbiter.isPointerSuppressed()) return;

            this.steerTo(event.clientX);
        };

        const onMouseDown = (event) => {
            const calibrating = game.state === "calibrating";
            if (!game.settings?.mouseControl && !calibrating) return;
            if (!PIECE_CONTROLLABLE_STATES.has(game.state)) return;

            if (event.button === 2) {
                event.preventDefault();
                game.pieceController.rotate();
            } else if (event.button === 0) {
                event.preventDefault();
                this.steerTo(event.clientX);
                game.pieceController.hardDrop();
            } else if (event.button === 1) {
                event.preventDefault();
                this.stopSoftDrop();
                game.pieceController.softDrop();
                this.softDropIntervalId = setInterval(
                    () => game.pieceController.softDrop(), SOFT_DROP_REPEAT_INTERVAL_MS
                );
            }
        };

        const onAuxClick = (event) => {
            if (event.button === 1) event.preventDefault();
        };

        const onMouseUp = (event) => {
            if (event.button === 1) this.stopSoftDrop();
        };

        const onBlur = () => this.stopSoftDrop();

        canvas.addEventListener("contextmenu", onContextMenu);
        canvas.addEventListener("auxclick", onAuxClick);
        game.dom.addEventListener("mousemove", onMouseMove);
        game.dom.addEventListener("mousedown", onMouseDown);
        game.dom.addEventListener("mouseup", onMouseUp);
        if (globalThis.window) window.addEventListener("blur", onBlur);

        this._handlers = {onContextMenu, onAuxClick, onMouseMove, onMouseDown, onMouseUp, onBlur};
    }

    unbind() {
        const game = this.game;
        this.stopSoftDrop();

        if (this._handlers) {
            const {onContextMenu, onAuxClick, onMouseMove, onMouseDown, onMouseUp, onBlur} = this._handlers;
            if (this.canvas) {
                this.canvas.removeEventListener("contextmenu", onContextMenu);
                this.canvas.removeEventListener("auxclick", onAuxClick);
            }
            if (game.dom) {
                game.dom.removeEventListener("mousemove", onMouseMove);
                game.dom.removeEventListener("mousedown", onMouseDown);
                game.dom.removeEventListener("mouseup", onMouseUp);
            }
            if (globalThis.window) window.removeEventListener("blur", onBlur);
        }

        this._handlers = null;
        this.canvas = null;
    }
}
