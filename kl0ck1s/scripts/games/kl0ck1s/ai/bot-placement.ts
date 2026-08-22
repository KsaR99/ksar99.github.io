import {KLOCKOMINOS} from "../shared/config.js";
import type {KlockominoType} from "../game/piece.js";
import {analyzeOccupancy} from "../game/board-analysis.js";

const WEIGHTS = Object.freeze({
    aggregateHeight: -0.510066,
    lines: 0.760666,
    holes: -0.35663,
    bumpiness: -0.184483,
});

type Occupancy = Uint32Array;
type Rotation = { state: number; mask: number; width: number; height: number };
type PlacementOptions = { lookahead: boolean; mistakeChance: number; random: () => number };

export type BotPlacement = {
    rotationState: number; mask: number; width: number; height: number;
    x: number; y: number; lines: number; resulting: Uint32Array; score: number; combined?: number;
};

export function buildDropRows(fullRows: number[], rowCount: number): Uint8Array {
    const dropRows = new Uint8Array(rowCount);
    for (let y = 0; y < rowCount; y++) {
        dropRows[y] = fullRows.reduce((count, clearedY) => count + (clearedY > y ? 1 : 0), 0);
    }
    return dropRows;
}

export function collidesAt(occupancy: Occupancy, cols: number, rows: number, mask: number, width: number, height: number, px: number, py: number): boolean {
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (!((mask >> (r * width + c)) & 1)) continue;
            const x = px + c;
            const y = py + r;
            if (x < 0 || x >= cols || y >= rows) return true;
            if (y >= 0 && (occupancy[y] & (1 << x)) !== 0) return true;
        }
    }
    return false;
}

export function dropY(occupancy: Occupancy, cols: number, rows: number, mask: number, width: number, height: number, px: number): number {
    let y = 0;
    while (!collidesAt(occupancy, cols, rows, mask, width, height, px, y + 1)) y++;
    return y;
}

export function withPiecePlaced(occupancy: Occupancy, cols: number, mask: number, width: number, height: number, px: number, py: number): Occupancy {
    const next = occupancy.slice();
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (!((mask >> (r * width + c)) & 1)) continue;
            const y = py + r;
            if (y < 0) continue;
            next[y] |= (1 << (px + c));
        }
    }
    return next;
}

export function countFullLines(occupancy: Occupancy, cols: number, rows: number): number {
    const fullMask = (1 << cols) - 1;
    let count = 0;
    for (let y = 0; y < rows; y++) {
        if (occupancy[y] === fullMask) count++;
    }
    return count;
}

export function collapseFullLines(occupancy: Occupancy, cols: number, rows: number): Occupancy {
    const fullMask = (1 << cols) - 1;
    const kept: number[] = [];
    for (let y = 0; y < rows; y++) {
        if (occupancy[y] !== fullMask) kept.push(occupancy[y]);
    }
    const result = new Uint32Array(rows);
    let dest = rows - 1;
    for (let i = kept.length - 1; i >= 0; i--, dest--) result[dest] = kept[i];
    return result;
}

export function analyzeBoard(occupancy: Occupancy, cols: number, rows: number): {
    aggregateHeight: number;
    holes: number;
    bumpiness: number
} {
    const {aggregateHeight, holes, bumpiness} = analyzeOccupancy(occupancy, cols, rows);
    return {aggregateHeight, holes, bumpiness};
}

export function heuristicScore(occupancy: Occupancy, cols: number, rows: number, lines: number): number {
    const {aggregateHeight, holes, bumpiness} = analyzeBoard(occupancy, cols, rows);
    return WEIGHTS.aggregateHeight * aggregateHeight
        + WEIGHTS.lines * lines
        + WEIGHTS.holes * holes
        + WEIGHTS.bumpiness * bumpiness;
}

export function distinctRotations(type: KlockominoType): Rotation[] {
    const def = KLOCKOMINOS[type];
    const seen = new Set();
    const rotations: Rotation[] = [];
    for (let state = 0; state < def.states.length; state++) {
        const mask = def.states[state];
        if (seen.has(mask)) continue;
        seen.add(mask);
        rotations.push({state, mask, width: def.width, height: def.height});
    }
    return rotations;
}

export function enumeratePlacements(type: KlockominoType, occupancy: Occupancy, cols: number, rows: number): BotPlacement[] {
    const placements: BotPlacement[] = [];
    for (const {state, mask, width, height} of distinctRotations(type)) {
        for (let x = -width; x <= cols; x++) {
            if (collidesAt(occupancy, cols, rows, mask, width, height, x, 0)) continue;
            const y = dropY(occupancy, cols, rows, mask, width, height, x);
            const placed = withPiecePlaced(occupancy, cols, mask, width, height, x, y);
            const lines = countFullLines(placed, cols, rows);
            const resulting = lines > 0 ? collapseFullLines(placed, cols, rows) : placed;
            const score = heuristicScore(resulting, cols, rows, lines);
            placements.push({rotationState: state, mask, width, height, x, y, lines, resulting, score});
        }
    }
    return placements;
}

export function choosePlacement(type: KlockominoType, nextType: KlockominoType | null, occupancy: Occupancy, cols: number, rows: number, {
    lookahead,
    mistakeChance,
    random
}: PlacementOptions): BotPlacement | null {
    const placements = enumeratePlacements(type, occupancy, cols, rows);
    if (!placements.length) return null;

    placements.sort((a, b) => b.score - a.score);

    let ranked = placements;
    if (lookahead && nextType) {
        const topN = placements.slice(0, Math.min(6, placements.length));
        const withLookahead = topN.map((placement) => {
            const nextPlacements = enumeratePlacements(nextType, placement.resulting, cols, rows);
            const bestNext = nextPlacements.reduce((best, p) => (p.score > best ? p.score : best), -Infinity);
            const combined = placement.score + (Number.isFinite(bestNext) ? bestNext * 0.65 : 0);
            return {...placement, combined};
        });
        withLookahead.sort((a, b) => b.combined - a.combined);
        ranked = withLookahead;
    }

    if (ranked.length > 1 && random() < mistakeChance) {
        const pool = ranked.slice(0, Math.min(ranked.length, 5));
        return pool[Math.floor(random() * pool.length)];
    }
    return ranked[0];
}

