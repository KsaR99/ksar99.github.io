"use strict";

/**
 * Translates keyboard/mouse input into game actions. Knows nothing about game
 * rules — it only maps input events to calls on the other controllers, so new
 * keybinds/mouse behavior can be added here without touching gameplay code.
 */
export class InputController {
    constructor(game) {
        this.game = game;
    }

    toggleControlsList() {
        const game = this.game;
        if (!game.dom) return;
        const list = game.dom.querySelector('[data-role="controls-list"]');
        if (list) list.classList.toggle("controls__list--collapsed");
    }

    bindControlsToggle() {
        const game = this.game;
        if (!game.dom) return;
        const title = game.dom.querySelector('[data-role="controls-toggle"]');
        if (!title) return;
        title.addEventListener("click", () => this.toggleControlsList());
    }

    bindControls() {
        const game = this.game;
        if (!game.dom) return;

        /** @type {Record<string, () => void>} */
        const KEY_ACTIONS = {
            ArrowLeft: () => game.pieceController.handleHorizontalArrow(-1),
            ArrowRight: () => game.pieceController.handleHorizontalArrow(1),
            ArrowDown: () => game.pieceController.softDrop(),
            ArrowUp: () => game.pieceController.rotate(),
            Space: () => game.pieceController.hardDrop(),
            Enter: () => game.screenFlow.handleEnter(),
            Escape: () => game.screenFlow.handleEscape(),
            KeyH: () => this.toggleControlsList(),
            KeyM: () => game.settingsController.toggleSound(),
            KeyO: () => game.screenFlow.toggleOptions(),
            KeyP: () => game.screenFlow.togglePause(),
            KeyZ: () => game.pieceController.rotate(),
            KeyR: () => game.screenFlow.restart(),
        };

        const PREVENT_DEFAULT_KEYS = new Set([
            "ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space", "Enter", "Escape"
        ]);

        const REPEATABLE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowDown"]);
        const REPEAT_INITIAL_DELAY_MS = 100;
        const REPEAT_INTERVAL_MS = 50;
        const heldTimers = new Map();

        // Keys that move/rotate/drop the piece. Using one of these should win
        // over mouse steering for a short window, otherwise a mouse that's
        // merely resting near its last position (or drifting a pixel) fires
        // a mousemove that immediately snaps the piece back under it, undoing
        // whatever the keyboard just did.
        const MOVEMENT_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space", "KeyZ"]);
        const MOUSE_STEER_SUPPRESS_MS = 200;

        const stopRepeat = (code) => {
            const timers = heldTimers.get(code);
            if (!timers) return;
            if (timers.timeoutId !== undefined) clearTimeout(timers.timeoutId);
            if (timers.intervalId !== undefined) clearInterval(timers.intervalId);
            heldTimers.delete(code);
        };

        const startRepeat = (code, action) => {
            stopRepeat(code);
            const timeoutId = setTimeout(() => {
                const intervalId = setInterval(action, REPEAT_INTERVAL_MS);
                heldTimers.set(code, {intervalId});
            }, REPEAT_INITIAL_DELAY_MS);
            heldTimers.set(code, {timeoutId});
        };

        const isTypingInField = (event) => {
            const tag = event.target.tagName;
            return tag === "INPUT" || tag === "TEXTAREA";
        };

        game.dom.addEventListener("keydown", (event) => {
            if (isTypingInField(event) && event.code !== "Enter") return;

            if (PREVENT_DEFAULT_KEYS.has(event.code)) event.preventDefault();

            const baseAction = KEY_ACTIONS[event.code];
            if (!baseAction) return;

            const action = MOVEMENT_KEYS.has(event.code)
                ? () => {
                    game.mouseSteerSuppressUntil = Date.now() + MOUSE_STEER_SUPPRESS_MS;
                    game.usingMouseSteering = false;
                    baseAction();
                }
                : baseAction;

            if (REPEATABLE_KEYS.has(event.code)) {
                if (event.repeat) return;
                action();
                startRepeat(event.code, action);
                return;
            }

            if (event.repeat && event.code === "Space") return;
            action();
        });

        game.dom.addEventListener("keyup", (event) => stopRepeat(event.code), {passive: true});

        if (globalThis.window) {
            window.addEventListener("blur", () => {
                heldTimers.forEach((timers) => {
                    if (timers.timeoutId !== undefined) clearTimeout(timers.timeoutId);
                    if (timers.intervalId !== undefined) clearInterval(timers.intervalId);
                });
                heldTimers.clear();
            });
        }
    }

    /**
     * Mouse controls: moving the pointer left/right steers the current piece
     * toward the column under it, right click rotates, left click hard-drops.
     * Column math (canvas rect + cell size) lives on the renderer, which owns
     * that geometry — this controller only maps input to piece actions.
     */
    bindMouseControls() {
        const game = this.game;
        if (!game.dom) return;

        const canvas = game.dom.getElementById("klockis-board");
        if (!canvas) return;

        canvas.addEventListener("contextmenu", (event) => event.preventDefault());

        game.dom.addEventListener("mousemove", (event) => {
            if (!game.settings?.mouseControl) return;

            game.pointerClientX = event.clientX;
            if (game.state !== "running") return;
            if (game.mouseSteerSuppressUntil && Date.now() < game.mouseSteerSuppressUntil) return;

            const column = game.renderer.columnFromClientX(event.clientX);
            if (column === null || column === undefined) return;
            game.usingMouseSteering = true;
            game.pieceController.moveToColumn(column);
        });

        game.dom.addEventListener("mousedown", (event) => {
            if (!game.settings?.mouseControl) return;
            if (game.state !== "running") return;

            if (event.button === 2) {
                event.preventDefault();
                game.pieceController.rotate();
            } else if (event.button === 0) {
                event.preventDefault();
                game.pieceController.hardDrop();
            }
        });
    }
}
