"use strict";

import {BaseMode} from "./base-mode.js";

export class CheeseRaceMode extends BaseMode {
    objectiveText(): string {
        return `${this.game.lines} / ${this.def.cheeseRows}`;
    }

    objectivePercent(): number {
        return Math.min(100, (this.game.lines / this.def.cheeseRows) * 100);
    }

    objectiveColorMode(): string {
        return "ramp";
    }

    checkObjectiveComplete(): boolean {
        if (this.game.lines >= this.def.cheeseRows) {
            this.game.screenFlow.endRound("cheeseClear");
            return true;
        }
        return false;
    }
}
