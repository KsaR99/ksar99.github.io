"use strict";

import {SCORING, SPIN_POINTS} from "../shared/config.js";

export function pointsForLineClear(cleared, level, scoring = SCORING) {
    return (scoring.POINTS_PER_LINES[cleared] ?? 0) * level;
}

export function levelForLines(totalLines, startLevel, scoring = SCORING) {
    return startLevel + Math.floor(totalLines / scoring.LINES_PER_LEVEL);
}

export function pointsForSpin(pieceType, cleared, level, mini = false, spinPoints = SPIN_POINTS) {
    const table = pieceType === "T"
        ? (mini ? spinPoints.T_MINI : spinPoints.T)
        : spinPoints.OTHER;
    const index = Math.min(cleared, table.length - 1);
    return table[index] * level;
}

export function pointsForSoftDrop(scoring = SCORING) {
    return scoring.SOFT_DROP_POINT;
}

export function pointsForHardDrop(cellsDropped, scoring = SCORING) {
    return cellsDropped * scoring.HARD_DROP_POINT;
}

export function pointsForCascadeChain(chainIndex, level, scoring = SCORING) {
    if (chainIndex <= 1) return 0;
    return scoring.CASCADE_CHAIN_BONUS * (chainIndex - 1) * level;
}
