"use strict";

import {BaseMode} from "./base-mode.js";

export class SprintMode extends BaseMode {
    objectiveText(): string {
        return `${this.game.lines} / ${this.def.sprintTarget}`;
    }

    objectivePercent(): number {
        return Math.min(100, (this.game.lines / this.def.sprintTarget) * 100);
    }

    objectiveColorMode(): string {
        return "ramp";
    }

    checkObjectiveComplete(): boolean {
        if (this.game.lines >= this.def.sprintTarget) {
            this.game.screenFlow.endRound("sprintComplete");
            return true;
        }
        return false;
    }
}
