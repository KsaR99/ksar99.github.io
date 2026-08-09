"use strict";

import {KLOCKOMINOS} from "../shared/config.js";
import {Board} from "../game/board.js";
import {PieceBag} from "../game/piece-bag.js";
import {levelForLines, pointsForLineClear} from "../game/scoring.js";
import {mulberry32} from "../shared/seeded-random.js";

/**
 * Per-difficulty tuning. `placeIntervalMs`/`minIntervalMs` control how fast
 * the bot places pieces (ramping down as it clears lines, like real gravity
 * speeding up with level); `mistakeChance` is the odds it ignores its best
 * move and plays a weaker one instead, so "easy" doesn't play a flawless
 * game; `lookahead` turns on a shallow (next-piece) search.
 */
export const BOT_DIFFICULTIES = Object.freeze({
    easy: Object.freeze({startLevel: 1, placeIntervalMs: 900, minIntervalMs: 550, mistakeChance: 0.35, lookahead: false}),
    medium: Object.freeze({startLevel: 3, placeIntervalMs: 600, minIntervalMs: 350, mistakeChance: 0.14, lookahead: true}),
    hard: Object.freeze({startLevel: 6, placeIntervalMs: 380, minIntervalMs: 180, mistakeChance: 0.03, lookahead: true}),
});

// Classic "El-Tetris"-style heuristic weights: reward clearing lines, punish
// tall/holey/bumpy boards. Tuned for stable, sensible play rather than
// perfect play.
const WEIGHTS = Object.freeze({
    aggregateHeight: -0.510066,
    lines: 0.760666,
    holes: -0.35663,
    bumpiness: -0.184483,
});

function collidesAt(occupancy, cols, rows, mask, width, height, px, py) {
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

function dropY(occupancy, cols, rows, mask, width, height, px) {
    let y = 0;
    while (!collidesAt(occupancy, cols, rows, mask, width, height, px, y + 1)) y++;
    return y;
}

function withPiecePlaced(occupancy, cols, mask, width, height, px, py) {
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

function countFullLines(occupancy, cols, rows) {
    const fullMask = (1 << cols) - 1;
    let count = 0;
    for (let y = 0; y < rows; y++) {
        if (occupancy[y] === fullMask) count++;
    }
    return count;
}

function collapseFullLines(occupancy, cols, rows) {
    const fullMask = (1 << cols) - 1;
    const kept = [];
    for (let y = 0; y < rows; y++) {
        if (occupancy[y] !== fullMask) kept.push(occupancy[y]);
    }
    const result = new Uint32Array(rows);
    let dest = rows - 1;
    for (let i = kept.length - 1; i >= 0; i--, dest--) result[dest] = kept[i];
    return result;
}

function analyzeBoard(occupancy, cols, rows) {
    const heights = new Array(cols).fill(0);
    let holes = 0;
    for (let c = 0; c < cols; c++) {
        let topSeen = false;
        for (let y = 0; y < rows; y++) {
            const filled = (occupancy[y] & (1 << c)) !== 0;
            if (filled && !topSeen) {
                topSeen = true;
                heights[c] = rows - y;
            } else if (!filled && topSeen) {
                holes++;
            }
        }
    }
    let bumpiness = 0;
    for (let c = 0; c < cols - 1; c++) bumpiness += Math.abs(heights[c] - heights[c + 1]);
    const aggregateHeight = heights.reduce((sum, h) => sum + h, 0);
    return {aggregateHeight, holes, bumpiness};
}

function heuristicScore(occupancy, cols, rows, lines) {
    const {aggregateHeight, holes, bumpiness} = analyzeBoard(occupancy, cols, rows);
    return WEIGHTS.aggregateHeight * aggregateHeight
        + WEIGHTS.lines * lines
        + WEIGHTS.holes * holes
        + WEIGHTS.bumpiness * bumpiness;
}

/** The 1-4 geometrically distinct rotation states for a piece type (dedupes O, etc.). */
function distinctRotations(type) {
    const def = KLOCKOMINOS[type];
    const seen = new Set();
    const rotations = [];
    for (let state = 0; state < def.states.length; state++) {
        const mask = def.states[state];
        if (seen.has(mask)) continue;
        seen.add(mask);
        rotations.push({state, mask, width: def.width, height: def.height});
    }
    return rotations;
}

/** Every legal resting placement for `type` on `occupancy`, with its resulting board. */
function enumeratePlacements(type, occupancy, cols, rows) {
    const placements = [];
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

/**
 * Picks where to put `type`. With `nextType` + `lookahead` it breaks ties
 * among the strongest immediate placements by also checking how good the
 * *following* piece's best placement would be on each resulting board -
 * cheap (a second flat search, no recursion) but enough to avoid short-sighted
 * moves like leaving a well that only an I-piece could fix right before an
 * S-piece is due.
 */
function choosePlacement(type, nextType, occupancy, cols, rows, {lookahead, mistakeChance, random}) {
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

    // "Mistakes" pick a middling placement instead of the best one, so lower
    // difficulties visibly misplay sometimes rather than playing perfectly-but-slowly.
    if (ranked.length > 1 && random() < mistakeChance) {
        const pool = ranked.slice(0, Math.min(ranked.length, 5));
        return pool[Math.floor(random() * pool.length)];
    }
    return ranked[0];
}

/**
 * Runs a fully local, headless Tetris game and picks moves for itself on a
 * timer, standing in for a second player in the "practice vs bot" mode.
 * Talks to MultiplayerController the same way a MultiplayerSession does:
 * it's an EventTarget that fires "message" events shaped like
 * `{kind: "score"|"board"|"final", ...}`, so the controller's existing
 * peer-message handling (opponent badge/board/result) works unmodified.
 */
export class BotOpponent extends EventTarget {
    constructor({types, cols, rows, seed, difficultyKey = "medium", difficulties = BOT_DIFFICULTIES}) {
        super();
        this.types = types;
        this.cols = cols;
        this.rows = rows;
        this.difficultyKey = difficultyKey;
        this.profile = difficulties[difficultyKey] ?? difficulties.medium;

        this.board = new Board(cols, rows);
        this.bag = new PieceBag(types, mulberry32(seed));
        this.random = Math.random;

        this.current = this.bag.next();
        this.pending = this.bag.next();
        this.level = this.profile.startLevel;
        this.lines = 0;
        this.score = 0;
        this.finished = false;

        this._timer = null;
        this._lastSentScore = -1;
    }

    start() {
        if (this._timer) return;
        this._sendBoard();
        this._sendScore();
        this._scheduleNext();
    }

    stop() {
        if (this._timer) clearTimeout(this._timer);
        this._timer = null;
    }

    _intervalForLevel() {
        const {placeIntervalMs, minIntervalMs} = this.profile;
        // Ramps down ~4% per level above the bot's start level, floored at minIntervalMs -
        // mirrors the game's own "gets faster as you clear lines" feel without needing
        // the full drop-speed curve (the bot places whole pieces, not single rows).
        const levelsIn = Math.max(0, this.level - this.profile.startLevel);
        const eased = placeIntervalMs * Math.pow(0.96, levelsIn);
        return Math.max(minIntervalMs, eased);
    }

    _scheduleNext() {
        if (this.finished) return;
        this._timer = setTimeout(() => this._placeOne(), this._intervalForLevel());
    }

    _placeOne() {
        if (this.finished) return;

        const placement = choosePlacement(
            this.current, this.pending, this.board.occupancy, this.cols, this.rows,
            {lookahead: this.profile.lookahead, mistakeChance: this.profile.mistakeChance, random: this.random}
        );

        if (!placement) {
            this._topOut();
            return;
        }

        const piece = {
            type: this.current,
            colorIndex: KLOCKOMINOS[this.current].colorIndex,
            mask: placement.mask,
            width: placement.width,
            height: placement.height,
            x: placement.x,
            y: placement.y,
        };
        this.board.lockPiece(piece);
        const cleared = this.board.clearFullLines();

        if (cleared > 0) {
            this.score += pointsForLineClear(cleared, this.level);
            this.lines += cleared;
            this.level = levelForLines(this.lines, this.profile.startLevel);
        }

        this._sendBoard();
        this._sendScore();

        this.current = this.pending;
        this.pending = this.bag.next();

        // Spawn check for the *new* current piece - if it can't even appear, the bot topped out.
        const def = KLOCKOMINOS[this.current];
        const spawnX = Math.floor((this.cols - def.width) / 2);
        if (collidesAt(this.board.occupancy, this.cols, this.rows, def.states[0], def.width, def.height, spawnX, 0)) {
            this._topOut();
            return;
        }

        this._scheduleNext();
    }

    _topOut() {
        this.finish();
    }

    /**
     * Locks in the bot's current score as final and stops it. Called both
     * when the bot tops out on its own board, and by the controller when
     * the *player's* round ends first (sprint/ultra/etc. finish on a
     * target, not necessarily a top-out) - either way the match needs a
     * result instead of waiting on a bot that might play for a long time.
     */
    finish() {
        if (this.finished) return;
        this.finished = true;
        this.stop();
        this.dispatchEvent(new CustomEvent("message", {detail: {kind: "final", score: this.score}}));
    }

    _sendScore() {
        if (this.score === this._lastSentScore) return;
        this._lastSentScore = this.score;
        this.dispatchEvent(new CustomEvent("message", {detail: {kind: "score", score: this.score}}));
    }

    _sendBoard() {
        this.dispatchEvent(new CustomEvent("message", {detail: {kind: "board", cells: Array.from(this.board.colors)}}));
    }
}
