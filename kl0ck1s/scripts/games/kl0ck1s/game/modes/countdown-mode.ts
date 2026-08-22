// @ts-nocheck
"use strict";

import {formatDuration} from "../../shared/utils.js";
import {BaseMode} from "./base-mode.js";

export class CountdownMode extends BaseMode {
    objectiveText(): string {
        return formatDuration(Math.max(0, this.game.modeState.countdownRemainingMs));
    }

    objectivePercent(): number {
        return Math.min(100, (this.game.modeState.countdownRemainingMs / this.def.countdownStartMs) * 100);
    }

    objectiveUrgency(): "danger" | "warning" | null {
        return this.urgencyFromRemainingMs(this.game.modeState.countdownRemainingMs);
    }

    objectiveColorMode(): string {
        return "urgency";
    }

    update(delta: number): void {
        const game = this.game;
        game.modeState.countdownRemainingMs -= delta;
        if (game.modeState.countdownRemainingMs <= 0) {
            game.screenFlow.endRound("timeUp");
        }
    }

    onLinesCleared(cleared: number): boolean {
        const def = this.def;
        const bonusMs = def.countdownBonusMs[Math.min(cleared, def.countdownBonusMs.length - 1)];
        this.game.modeState.countdownRemainingMs += bonusMs;
        return false;
    }
}
