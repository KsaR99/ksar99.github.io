"use strict";

/**
 * Common contract every input source (keyboard, mouse, and later touch)
 * implements. InputController composes these; each source only needs to
 * know how to attach/detach its own listeners and report to the shared
 * SteeringArbiter - nothing else has to change to add a new source.
 */
export class InputSource {
    /**
     * @param {object} game
     * @param {import("./steering-arbiter.js").SteeringArbiter} steeringArbiter
     */
    constructor(game, steeringArbiter) {
        this.game = game;
        this.steeringArbiter = steeringArbiter;
    }

    /** Attaches this source's event listeners. */
    bind() {
        throw new Error("InputSource.bind() must be implemented by subclass");
    }

    /** Detaches this source's event listeners/timers, if it holds any. Safe to call even if bind() was never called. */
    unbind() {
    }
}
