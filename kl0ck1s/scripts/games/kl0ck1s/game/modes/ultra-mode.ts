"use strict";

import {formatDuration} from "../../shared/utils.js";
import {BaseMode} from "./base-mode.js";

export class UltraMode extends BaseMode {
    objectiveText(): string {
        return formatDuration(Math.max(0, this.def.timeLimitMs - this.game.elapsedMs));
    }

    objectivePercent(): number {
        return Math.min(100, (this.game.elapsedMs / this.def.timeLimitMs) * 100);
    }

    objectiveUrgency(): "danger" | "warning" | null {
        return this.urgencyFromRemainingMs(this.def.timeLimitMs - this.game.elapsedMs);
    }

    objectiveColorMode(): string {
        return "urgency";
    }

    update(_delta: number): void {
        if (this.game.elapsedMs >= this.def.timeLimitMs) {
            this.game.screenFlow.endRound("timeUp");
        }
    }
}
