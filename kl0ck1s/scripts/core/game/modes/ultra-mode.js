"use strict";

import {formatDuration} from "../../shared/utils.js";
import {BaseMode} from "./base-mode.js";

export class UltraMode extends BaseMode {
    objectiveText() {
        return formatDuration(Math.max(0, this.def.timeLimitMs - this.game.elapsedMs));
    }

    objectivePercent() {
        return Math.min(100, (this.game.elapsedMs / this.def.timeLimitMs) * 100);
    }

    objectiveUrgency() {
        return this.urgencyFromRemainingMs(this.def.timeLimitMs - this.game.elapsedMs);
    }

    objectiveColorMode() {
        return "urgency";
    }

    update(_delta) {
        if (this.game.elapsedMs >= this.def.timeLimitMs) {
            this.game.screenFlow.endRound("timeUp");
        }
    }
}
