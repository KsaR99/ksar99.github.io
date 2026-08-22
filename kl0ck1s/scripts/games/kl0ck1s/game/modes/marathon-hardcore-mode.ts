// @ts-nocheck
"use strict";

import {BaseMode} from "./base-mode.js";
import {KLOCKOMINOS} from "../../shared/config.js";

export function deepestReachableRow(board, type) {
    const def = KLOCKOMINOS[type];
    if (!def) return null;

    const {width, height, states} = def;
    const probe = {x: 0, y: 0, width, height};
    let deepest = -1;

    for (const mask of states) {
        for (let x = -width; x <= board.cols; x++) {
            probe.x = x;
            probe.y = 0;
            if (board.collides(probe, 0, 0, mask)) continue;

            let dropOffset = 0;
            while (!board.collides(probe, 0, dropOffset + 1, mask)) ++dropOffset;

            for (let r = 0; r < height; r++) {
                for (let c = 0; c < width; c++) {
                    if (!((mask >> (r * width + c)) & 1)) continue;
                    const y = dropOffset + r;
                    if (y > deepest) deepest = y;
                }
            }
        }
    }

    if (deepest < 0) return null;
    return Math.min(deepest, board.rows - 1);
}

export class MarathonHardcoreMode extends BaseMode {
    hardcoreMaskFromRow(): number | null {
        if (!this.def.hardcoreMask) return null;

        const piece = this.game.current;
        if (!piece) return null;

        return deepestReachableRow(this.game.board, piece.type);
    }
}
