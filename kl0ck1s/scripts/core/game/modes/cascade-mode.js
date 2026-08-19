"use strict";

import {BaseMode} from "./base-mode.js";

export class CascadeMode extends BaseMode {
    objectiveText() {
        const combo = this.game.currentCombo ?? 0;
        return combo >= 2 ? `x${combo}` : null;
    }
}

export class CascadeHardcoreMode extends CascadeMode {
}
