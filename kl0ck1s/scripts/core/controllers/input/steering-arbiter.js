"use strict";

/**
 * Arbitrates which input source is currently "steering" (controlling the
 * falling piece's column), so pointer-based sources (mouse, touch, ...) and
 * the keyboard don't fight over the piece's position. Shared by every input
 * source through the InputSource contract, instead of each one reaching
 * into ad-hoc game fields directly - adding a new pointer-style source
 * (e.g. touch) only means calling the same two methods.
 */
export class SteeringArbiter {
    constructor({suppressMs = 200} = {}) {
        this.suppressMs = suppressMs;
        this.pointerActive = false;
        this.suppressUntil = 0;
    }

    /** Call when a pointer source (mouse/touch) actually steers the piece to a new column. */
    markPointerSteer() {
        this.pointerActive = true;
    }

    /**
     * Call when the keyboard moves/rotates/drops the piece. Pointer sources
     * lose "steering rights" until they steer again, and are additionally
     * suppressed for a short window - otherwise a pointer merely resting
     * near its last position (or drifting a pixel) would immediately snap
     * the piece back under it, undoing whatever the keyboard just did.
     */
    markKeyboardSteer() {
        this.pointerActive = false;
        this.suppressUntil = Date.now() + this.suppressMs;
    }

    /** Whether a pointer source is currently inside the post-keyboard suppression window and should ignore movement. */
    isPointerSuppressed() {
        return Date.now() < this.suppressUntil;
    }

    /**
     * Whether a pointer source is the one currently "in control" of the
     * piece's column - used to decide whether a freshly spawned piece
     * should be snapped to the pointer's last known position.
     */
    isPointerSteering() {
        return this.pointerActive;
    }
}
