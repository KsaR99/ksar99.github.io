"use strict";

export interface ScoringRules {
    POINTS_PER_LINES: readonly number[] | Record<number, number>;
    LINES_PER_LEVEL: number;
    SOFT_DROP_POINT: number;
    HARD_DROP_POINT: number;
    CASCADE_CHAIN_BONUS: number;
}

export interface SpinRules {
    T: readonly number[];
    T_MINI: readonly number[];
    OTHER: readonly number[];
}

export function pointsForLineClear(cleared: number, level: number, scoring: ScoringRules): number {
    return (scoring.POINTS_PER_LINES[cleared] ?? 0) * level;
}

export function levelForLines(totalLines: number, startLevel: number, scoring: ScoringRules): number {
    return startLevel + Math.floor(totalLines / scoring.LINES_PER_LEVEL);
}

export function pointsForSpin(
    pieceType: string,
    cleared: number,
    level: number,
    mini: boolean,
    spinPoints: SpinRules,
): number {
    const table = pieceType === "T"
        ? (mini ? spinPoints.T_MINI : spinPoints.T)
        : spinPoints.OTHER;
    const index = Math.min(cleared, table.length - 1);
    return (table[index] ?? 0) * level;
}

export function pointsForSoftDrop(scoring: ScoringRules): number {
    return scoring.SOFT_DROP_POINT;
}

export function pointsForHardDrop(cellsDropped: number, scoring: ScoringRules): number {
    return cellsDropped * scoring.HARD_DROP_POINT;
}

export function pointsForCascadeChain(chainIndex: number, level: number, scoring: ScoringRules): number {
    if (chainIndex <= 1) return 0;
    return scoring.CASCADE_CHAIN_BONUS * (chainIndex - 1) * level;
}
