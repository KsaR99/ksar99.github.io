"use strict";

import {BOARD_CONFIG, KLOCKOMINOS} from "./config.js";
import {cloneShape} from "./utils.js";

export class Piece {
    /**
     * @param {string} type - KLOCKOMINOS Key (eg. "T")
     * @param {object} [options]
     * @param {number} [options.cols]
     */
    constructor(type, {cols = BOARD_CONFIG.COLS} = {}) {
        const def = KLOCKOMINOS[type];
        if (!def) throw new Error(`Nieznany typ klocka: ${type}`);

        this.type = type;
        this.color = def.color;
        this.rotationState = 0;
        this.shape = cloneShape(def.states[this.rotationState]);
        this.x = Math.floor((cols - this.shape[0].length) / 2);
        this.y = 0;
    }

    rotated() {
        const states = KLOCKOMINOS[this.type].states;
        return cloneShape(states[(this.rotationState + 1) % 4]);
    }
}
