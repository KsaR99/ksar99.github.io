"use strict";

import {SteeringArbiter} from "./input/steering-arbiter.js";
import {KeyboardInput} from "./input/keyboard-input.js";
import {MouseInput} from "./input/mouse-input.js";

/**
 * Composition root for input. Owns the shared SteeringArbiter and wires up
 * each input source (keyboard, mouse, and - later - touch, for mobile)
 * against it. Callers (main.js) keep using the same bindControls() /
 * bindMouseControls() / bindControlsToggle() surface as before.
 *
 * To add mobile support: create a TouchInput implementing the same
 * InputSource contract as KeyboardInput/MouseInput (see input/input-source.js),
 * instantiate it here alongside `this.mouse`, and add a `bindTouchControls()`
 * method that calls `this.touch.bind()` - no changes needed to the existing
 * sources or to the SteeringArbiter.
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
}
