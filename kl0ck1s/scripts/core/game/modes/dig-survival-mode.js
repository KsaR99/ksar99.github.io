"use strict";

import {BaseMode} from "./base-mode.js";

export class DigSurvivalMode extends BaseMode {
    objectiveText() {
        return `${this.game.modeState.digCleared} / ${this.def.digTarget}`;
    }

    objectivePercent() {
        return Math.min(100, (this.game.modeState.digCleared / this.def.digTarget) * 100);
    }

    objectiveColorMode() {
        return "ramp";
    }

    onLinesCleared(cleared) {
        const game = this.game;
        game.modeState.digCleared += cleared;

        const {toppedOut} = game.board.addGarbageLines(cleared);
        if (toppedOut) {
            game.screenFlow.endRound("topOut");
            return true;
        }
        return false;
    }

    checkObjectiveComplete() {
        if (this.game.modeState.digCleared >= this.def.digTarget) {
            this.game.screenFlow.endRound("digComplete");
            return true;
        }
        return false;
    }
}
