"use strict";

import {BaseMode} from "./base-mode.js";
import {ZenMode} from "./zen-mode.js";
import {SprintMode} from "./sprint-mode.js";
import {UltraMode} from "./ultra-mode.js";
import {SurvivalMode} from "./survival-mode.js";
import {CheeseRaceMode} from "./cheese-race-mode.js";
import {DigSurvivalMode} from "./dig-survival-mode.js";
import {CountdownMode} from "./countdown-mode.js";
import {CascadeMode} from "./cascade-mode.js";

export const MODE_CLASSES = {
    zen: ZenMode,
    marathon: BaseMode,
    sprint: SprintMode,
    ultra: UltraMode,
    survival: SurvivalMode,
    cheeseRace: CheeseRaceMode,
    digSurvival: DigSurvivalMode,
    countdown: CountdownMode,
    cascade: CascadeMode,
    random: BaseMode,
};

export function createMode(mode, game) {
    const ModeClass = MODE_CLASSES[mode] ?? BaseMode;
    return new ModeClass(game);
}
