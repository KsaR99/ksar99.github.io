"use strict";

export interface ScheduledTask {
    cancel(): void;
}

export interface Scheduler {
    after(delayMs: number, callback: () => void): ScheduledTask;

    every(intervalMs: number, callback: () => void): ScheduledTask;
}

export class TimeoutScheduler implements Scheduler {
    after(delayMs: number, callback: () => void): ScheduledTask {
        const id = globalThis.setTimeout(callback, delayMs);
        return {cancel: () => globalThis.clearTimeout(id)};
    }

    every(intervalMs: number, callback: () => void): ScheduledTask {
        const id = globalThis.setInterval(callback, intervalMs);
        return {cancel: () => globalThis.clearInterval(id)};
    }
}
