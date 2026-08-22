"use strict";

import {rollSurvivalGarbageCount} from "../../shared/utils.js";
import {BaseMode} from "./base-mode.js";

export class SurvivalMode extends BaseMode {
    objectiveText(): string {
        const remainingMs = Math.max(0, this.def.garbageIntervalMs - this.game.modeState.garbageTimer);
        return `${Math.ceil(remainingMs / 1000)}s`;
    }

    objectivePercent(): number {
        return Math.min(100, (this.game.modeState.garbageTimer / this.def.garbageIntervalMs) * 100);
    }

    objectiveUrgency(): "danger" | "warning" | null {
        return this.urgencyFromRemainingMs(this.def.garbageIntervalMs - this.game.modeState.garbageTimer);
    }

    objectiveColorMode(): string {
        return "urgency";
    }

    update(delta: number): void {
        const game = this.game;
        const def = this.def;
        if (!def.garbage) return;

        game.modeState.garbageTimer += delta;
        if (game.modeState.garbageTimer >= def.garbageIntervalMs) {
            game.modeState.garbageTimer -= def.garbageIntervalMs;
            const count = rollSurvivalGarbageCount(def);
            const {toppedOut} = game.board.addGarbageLines(count);
            if (game.current) game.engine.shiftCurrentY(-count);
            if (toppedOut) {
                game.screenFlow.endRound("topOut");
            }
        }
    }
}
