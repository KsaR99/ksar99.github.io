// @ts-nocheck
"use strict";

export class SteeringArbiter {

    suppressMs: number;
    pointerActive: false | true;
    suppressUntil: 0;

    constructor({suppressMs = 200} = {}) {
        this.suppressMs = suppressMs;
        this.pointerActive = false;
        this.suppressUntil = 0;
    }

    markPointerSteer() {
        this.pointerActive = true;
    }

    markKeyboardSteer() {
        this.pointerActive = false;
        this.suppressUntil = Date.now() + this.suppressMs;
    }

    isPointerSuppressed() {
        return Date.now() < this.suppressUntil;
    }

    isPointerSteering() {
        return this.pointerActive;
    }
}
