"use strict";

import {BaseMode} from "./base-mode.js";

export class SprintMode extends BaseMode {
    objectiveText() {
        return `${this.game.lines} / ${this.def.sprintTarget}`;
    }

    objectivePercent() {
        return Math.min(100, (this.game.lines / this.def.sprintTarget) * 100);
    }

    objectiveColorMode() {
        return "ramp";
    }

    checkObjectiveComplete() {
        if (this.game.lines >= this.def.sprintTarget) {
            this.game.screenFlow.endRound("sprintComplete");
            return true;
        }
        return false;
    }
}
