"use strict";

import {BOARD_CONFIG, KLOCKOMINOS} from "./config.js";
import {cloneShape, rotateMatrixClockwise} from "./utils.js";

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
        this.shape = cloneShape(def.shape);
        this.x = Math.floor((cols - this.shape[0].length) / 2);
        this.y = 0;
    }

    rotated() {
        return rotateMatrixClockwise(this.shape);
    }
}
