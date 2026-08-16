"use strict";

import {BaseMode} from "./base-mode.js";

export class CheeseRaceMode extends BaseMode {
    objectiveText() {
        return `${this.game.lines} / ${this.def.cheeseRows}`;
    }

    objectivePercent() {
        return Math.min(100, (this.game.lines / this.def.cheeseRows) * 100);
    }

    objectiveColorMode() {
        return "ramp";
    }

    checkObjectiveComplete() {
        if (this.game.lines >= this.def.cheeseRows) {
            this.game.screenFlow.endRound("cheeseClear");
            return true;
        }
        return false;
    }
}
