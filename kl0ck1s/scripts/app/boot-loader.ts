// @ts-nocheck
"use strict";

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

export class BootLoader {

    rootEl: null;
    fillEl: HTMLElement;
    statusEl: HTMLElement;
    progress: 0 | number;

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

    step(name, text) {
        this._setWidth(cumulativeUpTo(name));
        this.setStatus(text);
    }

    audioProgress(loaded, total) {
        if (!total) return;
        const within = STEP_WEIGHTS.audio * (loaded / total);
        this._setWidth(cumulativeUpTo("audio") + within);
    }

    finish() {
        const rootEl = this.rootEl;
        if (!rootEl) return;
        this.rootEl = null;
        this._setWidth(1);

        requestAnimationFrame(() => {
            rootEl.classList.add("boot-screen--hidden");
            rootEl.addEventListener("transitionend", () => rootEl.remove(), {once: true});
            setTimeout(() => rootEl.remove(), 350);
        });
    }
}
