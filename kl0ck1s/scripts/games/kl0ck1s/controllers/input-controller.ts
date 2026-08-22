// @ts-nocheck
import type {Game} from "../game/game.js";
import {SteeringArbiter} from "./input/steering-arbiter.js";
import {KeyboardInput} from "./input/keyboard-input.js";
import {MouseInput} from "./input/mouse-input.js";
import {TouchInput} from "./input/touch-input.js";

"use strict";

export class InputController {

    game: Game;
    steeringArbiter: SteeringArbiter;
    keyboard: KeyboardInput;
    mouse: MouseInput;
    touch: TouchInput;

    constructor(game) {
        this.game = game;
        this.steeringArbiter = game.steeringArbiter ?? new SteeringArbiter();
        game.steeringArbiter = this.steeringArbiter;

        this.keyboard = new KeyboardInput(game, this.steeringArbiter);
        this.mouse = new MouseInput(game, this.steeringArbiter);
        this.touch = new TouchInput(game, this.steeringArbiter, {
            getAction: (code) => this.keyboard.touchActions[code],
        });
    }

    bindControls() {
        this.keyboard.bind();
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
        const joystick = game.dom.querySelector('[data-role="touch-joystick"]');
        if (joystick) this.touch.bindJoystick(joystick);
    }
}
