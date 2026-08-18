"use strict";

import {BOARD_CONFIG, KLOCKOMINOS} from "../shared/config.js";

export class Piece {
    /**
     * @param {string} type - KLOCKOMINOS key (eg. "T")
     * @param {object} [options]
     * @param {number} [options.cols]
     */
    constructor(type, {cols = BOARD_CONFIG.COLS} = {}) {
        const def = KLOCKOMINOS[type];
        if (!def) throw new Error(`Unknown block type: ${type}`);

        this.type = type;
        this.color = def.color;
        this.colorIndex = def.colorIndex;
        this.width = def.width;
        this.height = def.height;
        this.rotationState = 0;

        if (type === "I") {
            this.pivotX = 1.5;
            this.pivotY = 1.5;
        } else if (type === "O") {
            this.pivotX = 0.5;
            this.pivotY = 0.5;
        } else {
            this.pivotX = 1;
            this.pivotY = 1;
        }

        this.mask = def.states[this.rotationState];
        this.x = Math.floor((cols - this.width) / 2);
        this.y = 0;
    }

    /**
     * @param {number} [dir=1] - +1 for clockwise, -1 for counterclockwise
     */
    rotated(dir = 1) {
        return KLOCKOMINOS[this.type].states[(this.rotationState + dir + 4) % 4];
    }
}
