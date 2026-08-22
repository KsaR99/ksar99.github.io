// @ts-nocheck
"use strict";

import {BaseMode} from "./base-mode.js";

export class DigSurvivalMode extends BaseMode {
    objectiveText(): string {
        return `${this.game.modeState.digCleared} / ${this.def.digTarget}`;
    }

    objectivePercent(): number {
        return Math.min(100, (this.game.modeState.digCleared / this.def.digTarget) * 100);
    }

    objectiveColorMode(): string {
        return "ramp";
    }

    onLinesCleared(cleared: number) {
        const game = this.game;
        game.modeState.digCleared += cleared;

        const {toppedOut} = game.board.addGarbageLines(cleared);
        if (toppedOut) {
            game.screenFlow.endRound("topOut");
            return true;
        }
        return false;
    }

    checkObjectiveComplete(): boolean {
        if (this.game.modeState.digCleared >= this.def.digTarget) {
            this.game.screenFlow.endRound("digComplete");
            return true;
        }
        return false;
    }
}
