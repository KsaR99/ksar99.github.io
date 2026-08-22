"use strict";

export interface GameClock {
    now(): number;

    reset(): void;
}

export class RealTimeGameClock implements GameClock {
    now(): number {
        return globalThis.performance?.now() ?? Date.now();
    }

    reset(): void {
    }
}

export class DeterministicGameClock implements GameClock {
    private currentTime = 0;

    now(): number {
        return this.currentTime;
    }

    advance(deltaMs: number): number {
        if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError("deltaMs must be a finite non-negative number");
        this.currentTime += deltaMs;
        return this.currentTime;
    }

    set(timeMs: number): void {
        if (!Number.isFinite(timeMs) || timeMs < 0) throw new RangeError("timeMs must be a finite non-negative number");
        this.currentTime = timeMs;
    }

    reset(): void {
        this.currentTime = 0;
    }
}
