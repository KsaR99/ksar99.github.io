"use strict";

export const DEFAULT_DAS_MS = 80;
export const DEFAULT_ARR_MS = 46;

export class InputSource {
    /**
     * @param {object} game
     * @param {import("./steering-arbiter.js").SteeringArbiter} steeringArbiter
     */
    constructor(game, steeringArbiter) {
        this.game = game;
        this.steeringArbiter = steeringArbiter;
        this._repeatTimers = new Map();
    }

    bind() {
        throw new Error("InputSource.bind() must be implemented by subclass");
    }

    unbind() {
    }

    /**
     * @param {string} key
     * @param {() => void} action
     * @param {object} [options]
     * @param {number} [options.dasMs] - overrides settings.keyboardDAS / DEFAULT_DAS_MS
     * @param {number} [options.arrMs] - overrides settings.keyboardARR / DEFAULT_ARR_MS
     */
    startRepeat(key, action, {dasMs, arrMs} = {}) {
        this.stopRepeat(key);
        const settings = this.game.settings;
        const das = dasMs ?? settings?.keyboardDAS ?? DEFAULT_DAS_MS;
        const arr = arrMs ?? settings?.keyboardARR ?? DEFAULT_ARR_MS;
        const entry = {action, arrMs: arr};
        entry.timeoutId = setTimeout(() => {
            delete entry.timeoutId;
            entry.intervalId = setInterval(action, entry.arrMs);
        }, das);
        this._repeatTimers.set(key, entry);
    }

    /**
     * Changes the repeat rate of an already-running repeat without resetting
     * its DAS delay. If the repeat is still waiting out its initial DAS
     * timeout, the new rate takes effect once that timeout fires.
     * @param {string} key
     * @param {number} arrMs
     */
    updateRepeatArr(key, arrMs) {
        const entry = this._repeatTimers.get(key);
        if (!entry || entry.arrMs === arrMs) return;
        entry.arrMs = arrMs;
        if (entry.intervalId !== undefined) {
            clearInterval(entry.intervalId);
            entry.intervalId = setInterval(entry.action, arrMs);
        }
    }

    stopRepeat(key) {
        const timers = this._repeatTimers.get(key);
        if (!timers) return;
        if (timers.timeoutId !== undefined) clearTimeout(timers.timeoutId);
        if (timers.intervalId !== undefined) clearInterval(timers.intervalId);
        this._repeatTimers.delete(key);
    }

    stopAllRepeats() {
        this._repeatTimers.forEach((timers) => {
            if (timers.timeoutId !== undefined) clearTimeout(timers.timeoutId);
            if (timers.intervalId !== undefined) clearInterval(timers.intervalId);
        });
        this._repeatTimers.clear();
    }
}
