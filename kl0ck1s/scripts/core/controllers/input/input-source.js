"use strict";

export class InputSource {
    /**
     * @param {object} game
     * @param {import("./steering-arbiter.js").SteeringArbiter} steeringArbiter
     */
    constructor(game, steeringArbiter) {
        this.game = game;
        this.steeringArbiter = steeringArbiter;
    }

    bind() {
        throw new Error("InputSource.bind() must be implemented by subclass");
    }

    unbind() {
    }
}
