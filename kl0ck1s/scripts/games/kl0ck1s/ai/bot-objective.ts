"use strict";

import {formatDuration} from "../shared/utils.js";

export type BotObjectiveMode = string | null;
export type BotObjectiveDefinition = Record<string, boolean | number | number[] | null>;

export interface BotObjectiveSnapshot {
    mode: BotObjectiveMode;
    lines: number;
    boardRows: number;
    boardOccupancy: Uint8Array;
    startedAt: number | null;
    finishedAt: number | null;
    countdownRemainingMs: number;
}

export class BotObjective {
    constructor(
        private readonly mode: BotObjectiveMode,
        private readonly definition: BotObjectiveDefinition,
    ) {
    }

    text(snapshot: BotObjectiveSnapshot): string | null {
        if (this.mode === "sprint") return `${snapshot.lines} / ${this.number("sprintTarget")}`;
        if (this.mode === "cheeseRace") return `${snapshot.lines} / ${this.number("cheeseRows")}`;
        if (this.mode === "digSurvival") return `${snapshot.lines} / ${this.number("digTarget")}`;
        if (this.mode === "ultra") return formatDuration(this.remainingTime(snapshot, "timeLimitMs"));
        if (this.mode === "countdown") return formatDuration(Math.max(0, snapshot.countdownRemainingMs));
        if (this.mode === "zen") return `${this.zenHeight(snapshot)}`;
        return null;
    }

    percent(snapshot: BotObjectiveSnapshot): number | null {
        if (this.mode === "sprint") return this.ratio(snapshot.lines, this.number("sprintTarget"));
        if (this.mode === "cheeseRace") return this.ratio(snapshot.lines, this.number("cheeseRows"));
        if (this.mode === "digSurvival") return this.ratio(snapshot.lines, this.number("digTarget"));
        if (this.mode === "ultra") {
            const total = Math.max(1, this.number("timeLimitMs"));
            const elapsed = this.elapsed(snapshot);
            return Math.min(100, (elapsed / total) * 100);
        }
        if (this.mode === "countdown") {
            const total = Math.max(1, this.number("countdownStartMs"));
            return Math.min(100, (snapshot.countdownRemainingMs / total) * 100);
        }
        return null;
    }

    urgency(snapshot: BotObjectiveSnapshot): "danger" | "warning" | null {
        let remainingMs: number;
        if (this.mode === "ultra") remainingMs = this.remainingTime(snapshot, "timeLimitMs");
        else if (this.mode === "countdown") remainingMs = snapshot.countdownRemainingMs;
        else return null;

        if (remainingMs <= 5000) return "danger";
        if (remainingMs <= 10000) return "warning";
        return null;
    }

    colorMode(): "ramp" | "urgency" | null {
        if (["sprint", "cheeseRace", "digSurvival"].includes(this.mode ?? "")) return "ramp";
        if (["ultra", "countdown"].includes(this.mode ?? "")) return "urgency";
        return null;
    }

    isComplete(lines: number): boolean {
        if (this.mode === "sprint") return lines >= this.number("sprintTarget");
        if (this.mode === "cheeseRace") return lines >= this.number("cheeseRows");
        if (this.mode === "digSurvival") return lines >= this.number("digTarget");
        return false;
    }

    private number(key: string): number {
        const value = this.definition[key];
        return typeof value === "number" && Number.isFinite(value) ? value : 0;
    }

    private elapsed(snapshot: BotObjectiveSnapshot): number {
        const now = snapshot.finishedAt ?? Date.now();
        return snapshot.startedAt == null ? 0 : Math.max(0, now - snapshot.startedAt);
    }

    private remainingTime(snapshot: BotObjectiveSnapshot, key: string): number {
        return Math.max(0, this.number(key) - this.elapsed(snapshot));
    }

    private ratio(value: number, target: number): number {
        return target > 0 ? Math.min(100, (value / target) * 100) : 0;
    }

    private zenHeight(snapshot: BotObjectiveSnapshot): number {
        let highestFilledRow = snapshot.boardRows;
        for (let y = 0; y < snapshot.boardRows; y++) {
            if (snapshot.boardOccupancy[y] !== 0) {
                highestFilledRow = y;
                break;
            }
        }
        return snapshot.boardRows - highestFilledRow;
    }
}
