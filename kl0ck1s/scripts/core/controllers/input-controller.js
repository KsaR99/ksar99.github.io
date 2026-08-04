"use strict";

import {SteeringArbiter} from "./input/steering-arbiter.js";
import {KeyboardInput} from "./input/keyboard-input.js";
import {MouseInput} from "./input/mouse-input.js";
import {TouchInput} from "./input/touch-input.js";

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

    toggleControlsList() {
        const game = this.game;
        if (!game.dom) return;
        game.dom.querySelectorAll('[data-role="controls-list"]').forEach((list) => {
            list.classList.toggle("controls__list--collapsed");
        });
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

    bindTouchControls() {
        const game = this.game;
        this.touch.bind();
        if (!game.dom) return;
        const bar = game.dom.querySelector('[data-role="touch-controls"]');
        if (bar) this.touch.bindButtons(bar);
    }
}
