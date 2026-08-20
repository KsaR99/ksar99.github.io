"use strict";

import {BaseMode} from "./base-mode.js";
import {KLOCKOMINOS} from "../../shared/config.js";

/**
 * Finds the deepest board row that the given piece type could possibly
 * occupy, trying every rotation state at every horizontal position and
 * hard-dropping it against the current stack.
 *
 * Anything below that row is, by definition, out of reach for this piece -
 * no placement can touch it, let alone clear it - so it's safe to hide.
 *
 * @returns {number|null} deepest reachable row index, or null if the piece
 *   can't be placed anywhere (shouldn't normally happen).
 */
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
    hardcoreMaskFromRow() {
        if (!this.def.hardcoreMask) return null;

        const piece = this.game.current;
        if (!piece) return null;

        return deepestReachableRow(this.game.board, piece.type);
    }
}
