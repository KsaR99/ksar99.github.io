"use strict";

import {SCORING, SPIN_POINTS} from "../shared/config.js";
import {
    levelForLines as engineLevelForLines,
    pointsForCascadeChain as enginePointsForCascadeChain,
    pointsForHardDrop as enginePointsForHardDrop,
    pointsForLineClear as enginePointsForLineClear,
    pointsForSoftDrop as enginePointsForSoftDrop,
    pointsForSpin as enginePointsForSpin,
} from "../../../engine/scoring/rules.js";

export const pointsForLineClear = (cleared: number, level: number, scoring = SCORING) =>
    enginePointsForLineClear(cleared, level, scoring);

export const levelForLines = (totalLines: number, startLevel: number, scoring = SCORING) =>
    engineLevelForLines(totalLines, startLevel, scoring);

export const pointsForSpin = (pieceType: string, cleared: number, level: number, mini = false, spinPoints = SPIN_POINTS) =>
    enginePointsForSpin(pieceType, cleared, level, mini, spinPoints);

export const pointsForSoftDrop = (scoring = SCORING) =>
    enginePointsForSoftDrop(scoring);

export const pointsForHardDrop = (cellsDropped: number, scoring = SCORING) =>
    enginePointsForHardDrop(cellsDropped, scoring);

export const pointsForCascadeChain = (chainIndex: number, level: number, scoring = SCORING) =>
    enginePointsForCascadeChain(chainIndex, level, scoring);
