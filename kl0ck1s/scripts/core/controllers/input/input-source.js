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

    startRepeat(key, action) {
        this.stopRepeat(key);
        const settings = this.game.settings;
        const dasMs = settings?.keyboardDAS ?? DEFAULT_DAS_MS;
        const arrMs = settings?.keyboardARR ?? DEFAULT_ARR_MS;
        const timeoutId = setTimeout(() => {
            const intervalId = setInterval(action, arrMs);
            this._repeatTimers.set(key, {intervalId});
        }, dasMs);
        this._repeatTimers.set(key, {timeoutId});
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
