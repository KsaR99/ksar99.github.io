"use strict";

import {formatDuration} from "../../shared/utils.js";
import {BaseMode} from "./base-mode.js";

export class CountdownMode extends BaseMode {
    objectiveText() {
        return formatDuration(Math.max(0, this.game.modeState.countdownRemainingMs));
    }

    objectivePercent() {
        return Math.min(100, (this.game.modeState.countdownRemainingMs / this.def.countdownStartMs) * 100);
    }

    objectiveUrgency() {
        return this.urgencyFromRemainingMs(this.game.modeState.countdownRemainingMs);
    }

    objectiveColorMode() {
        return "urgency";
    }

    update(delta) {
        const game = this.game;
        game.modeState.countdownRemainingMs -= delta;
        if (game.modeState.countdownRemainingMs <= 0) {
            game.screenFlow.endRound("timeUp");
        }
    }

    onLinesCleared(cleared) {
        const def = this.def;
        const bonusMs = def.countdownBonusMs[Math.min(cleared, def.countdownBonusMs.length - 1)];
        this.game.modeState.countdownRemainingMs += bonusMs;
        return false;
    }
}
