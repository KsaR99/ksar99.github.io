// @ts-nocheck
import type {Game} from "../game.js";

"use strict";

export class BaseMode {

    game: Game;

    constructor(game: Game) {
        this.game = game;
    }

    get def() {
        return this.game.gameModes[this.game.mode];
    }

    urgencyFromRemainingMs(remainingMs: number): "danger" | "warning" | null {
        if (remainingMs <= 5000) return "danger";
        if (remainingMs <= 10000) return "warning";
        return null;
    }

    setupBoard(): void {
        const def = this.def;
        if (!def.cheeseRows) return;
        this.game.board.addGarbageLines(def.cheeseRows);
    }

    objectiveText(): string | null {
        return null;
    }

    objectivePercent(): number | null {
        return null;
    }

    objectiveUrgency(): "danger" | "warning" | null {
        return null;
    }

    objectiveColorMode(): string | null {
        return null;
    }

    hardcoreMaskFromRow(): number | null {
        return null;
    }

    update(_delta: number): void {
    }

    onLinesCleared(_cleared: number): boolean {
        return false;
    }

    checkObjectiveComplete(): boolean {
        return false;
    }
}
