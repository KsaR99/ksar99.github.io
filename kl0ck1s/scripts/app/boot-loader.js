"use strict";

// Rough relative cost of each boot phase, used to turn discrete steps into a
// smooth-ish progress bar. Audio decoding dominates real-world load time, so
// it gets the largest share; the rest are comparatively quick.
const STEP_WEIGHTS = {
    start: 0.03,
    settings: 0.07,
    sprites: 0.15,
    audio: 0.65,
    finalize: 0.10,
};

const STEP_ORDER = ["start", "settings", "sprites", "audio", "finalize", "done"];

function cumulativeUpTo(step) {
    const index = STEP_ORDER.indexOf(step);
    let total = 0;
    for (let i = 0; i < index; i++) total += STEP_WEIGHTS[STEP_ORDER[i]] ?? 0;
    return total;
}

/**
 * Drives the full-page boot/loading screen shown before the app is revealed:
 * a logo + progress bar + status line covering everything else, so the user
 * never sees a bare or half-initialized page. Hidden away with `finish()`
 * once every boot phase (settings, sprite cache, audio) has completed.
 */
export class BootLoader {
    constructor({rootEl, fillEl, statusEl}) {
        this.rootEl = rootEl;
        this.fillEl = fillEl;
        this.statusEl = statusEl;
        this.progress = 0;
        this._setWidth(STEP_WEIGHTS.start);
    }

    _setWidth(fraction) {
        this.progress = Math.max(this.progress, Math.min(1, fraction));
        if (this.fillEl) this.fillEl.style.width = `${(this.progress * 100).toFixed(1)}%`;
    }

    setStatus(text) {
        if (this.statusEl && text) this.statusEl.textContent = text;
    }

    /** Marks the start of a named phase and updates the status text for it. */
    step(name, text) {
        this._setWidth(cumulativeUpTo(name));
        this.setStatus(text);
    }

    /** Fine-grained progress within the "audio" phase, as sounds finish decoding. */
    audioProgress(loaded, total) {
        if (!total) return;
        const within = STEP_WEIGHTS.audio * (loaded / total);
        this._setWidth(cumulativeUpTo("audio") + within);
    }

    /** Fades out and removes the boot screen from the DOM. */
    finish() {
        const rootEl = this.rootEl;
        if (!rootEl) return;
        this.rootEl = null; // guards against double-calls (watchdog + normal completion)
        this._setWidth(1);

        requestAnimationFrame(() => {
            rootEl.classList.add("boot-screen--hidden");
            rootEl.addEventListener("transitionend", () => rootEl.remove(), {once: true});
            // Fallback in case transitionend doesn't fire (e.g. reduced motion, display:none races).
            setTimeout(() => rootEl.remove(), 700);
        });
    }
}
