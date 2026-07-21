"use strict";

import {SCORING} from "./config.js";

export function pointsForLineClear(cleared, level, scoring = SCORING) {
    return (scoring.POINTS_PER_LINES[cleared] ?? 0) * level;
}

export function levelForLines(totalLines, startLevel, scoring = SCORING) {
    return startLevel + Math.floor(totalLines / scoring.LINES_PER_LEVEL);
}

export function pointsForSoftDrop(scoring = SCORING) {
    return scoring.SOFT_DROP_POINT;
}

export function pointsForHardDrop(cellsDropped, scoring = SCORING) {
    return cellsDropped * scoring.HARD_DROP_POINT;
}
