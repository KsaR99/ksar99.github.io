"use strict";

import {SteeringArbiter} from "./input/steering-arbiter.js";
import {KeyboardInput} from "./input/keyboard-input.js";
import {MouseInput} from "./input/mouse-input.js";
import {TouchInput} from "./input/touch-input.js";

/**
 * Composition root for input. Owns the shared SteeringArbiter and wires up
 * each input source (keyboard, mouse, touch) against it. Callers (main.js)
 * keep using the same bindControls() / bindMouseControls() /
 * bindControlsToggle() / bindTouchControls() surface.
 */
export class InputController {
    constructor(game) {
        this.game = game;
        this.steeringArbiter = game.steeringArbiter ?? new SteeringArbiter();
        game.steeringArbiter = this.steeringArbiter;

        this.keyboard = new KeyboardInput(game, this.steeringArbiter, {
            onToggleControlsList: () => this.toggleControlsList(),
        });
        this.mouse = new MouseInput(game, this.steeringArbiter);
        this.touch = new TouchInput(game, this.steeringArbiter, {
            getAction: (code) => this.keyboard.keyActions[code],
        });
    }

    /** Toggles the collapsed/expanded state of the sidebar controls list. UI concern, not tied to any input source. */
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

    bindKeyActionElements(root) {
        this.keyboard.bindKeyActionElements(root);
    }

    bindLegendShortcuts() {
        const game = this.game;
        if (!game.dom) return;
        const sidebar = game.dom.querySelector(".sidebar--controls");
        this.bindKeyActionElements(sidebar);
    }

    bindControls() {
        this.keyboard.bind();
        this.bindLegendShortcuts();
    }

    bindMouseControls() {
        this.mouse.bind();
    }

    /** Binds on-canvas touch gestures (drag/tap/swipe) and the on-screen touch-controls button bar. */
    bindTouchControls() {
        const game = this.game;
        this.touch.bind();
        if (!game.dom) return;
        const bar = game.dom.querySelector('[data-role="touch-controls"]');
        if (bar) this.touch.bindButtons(bar);
    }
}
