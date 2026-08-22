// @ts-nocheck
import type {Game} from "../game.js";
import {BaseMode} from "./base-mode.js";
import {MarathonHardcoreMode} from "./marathon-hardcore-mode.js";
import {ZenMode} from "./zen-mode.js";
import {SprintMode} from "./sprint-mode.js";
import {UltraMode} from "./ultra-mode.js";
import {SurvivalMode} from "./survival-mode.js";
import {CheeseRaceMode} from "./cheese-race-mode.js";
import {DigSurvivalMode} from "./dig-survival-mode.js";
import {CountdownMode} from "./countdown-mode.js";
import {CascadeHardcoreMode, CascadeMode} from "./cascade-mode.js";

"use strict";

export const MODE_CLASSES = {
    zen: ZenMode,
    marathon: BaseMode,
    marathonHardcore: MarathonHardcoreMode,
    sprint: SprintMode,
    ultra: UltraMode,
    survival: SurvivalMode,
    cheeseRace: CheeseRaceMode,
    digSurvival: DigSurvivalMode,
    countdown: CountdownMode,
    cascade: CascadeMode,
    cascadeHardcore: CascadeHardcoreMode,
    random: BaseMode,
};

export function createMode(mode: string, game: Game) {
    const ModeClass = MODE_CLASSES[mode] ?? BaseMode;
    return new ModeClass(game);
}
