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

    /** @todo: unused? */
    /** Detaches this source's event listeners/timers, if it holds any. Safe to call even if bind() was never called. */
    unbind() {
    }
}
