"use strict";

import {KLOCKOMINOS} from "../shared/config.js";
import {Board} from "../game/board.js";
import {PieceBag} from "../game/piece-bag.js";
import {levelForLines, pointsForLineClear} from "../game/scoring.js";
import {mulberry32} from "../shared/seeded-random.js";
import {formatNumber} from "../shared/utils.js";

/**
 * Per-difficulty tuning. `placeIntervalMs`/`minIntervalMs` control how fast
 * the bot places pieces (ramping down as it clears lines, like real gravity
 * speeding up with level); `mistakeChance` is the odds it ignores its best
 * move and plays a weaker one instead, so "easy" doesn't play a flawless
 * game; `lookahead` turns on a shallow (next-piece) search.
 */
export const BOT_DIFFICULTIES = Object.freeze({
    easy: Object.freeze({
        startLevel: 1,
        placeIntervalMs: 900,
        minIntervalMs: 550,
        mistakeChance: 0.35,
        lookahead: false
    }),
    medium: Object.freeze({
        startLevel: 3,
        placeIntervalMs: 600,
        minIntervalMs: 350,
        mistakeChance: 0.14,
        lookahead: true
    }),
    hard: Object.freeze({
        startLevel: 6,
        placeIntervalMs: 380,
        minIntervalMs: 180,
        mistakeChance: 0.03,
        lookahead: true
    }),
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
 * `{kind: "stats"|"board"|"piece"|"final", ...}`, matching what
 * MultiplayerController#_localStatsSnapshot sends for a real peer, so the
 * controller's existing peer-message handling (opponent badge/board/result)
 * works unmodified.
 */
export class BotOpponent extends EventTarget {
    constructor({
                    types,
                    cols,
                    rows,
                    seed,
                    difficultyKey = "medium",
                    difficulties = BOT_DIFFICULTIES,
                    startLevel = null,
                    // The selected game mode's key + definition (see
                    // GAME_MODES in config.js) - drives the same cheese/
                    // garbage/dig setup ModeController applies to the
                    // player's own board, so the bot's board actually
                    // matches whatever mode was picked instead of always
                    // playing a plain endless marathon.
                    mode = null,
                    modeDef = null
                }) {
        super();
        this.types = types;
        this.cols = cols;
        this.rows = rows;
        this.difficultyKey = difficultyKey;
        this.profile = difficulties[difficultyKey] ?? difficulties.medium;
        this.startLevel = Number.isFinite(startLevel) ? startLevel : this.profile.startLevel;
        this.mode = mode;
        this.modeDef = modeDef ?? {};

        this.board = new Board(cols, rows);
        // Same starting stack the player's board gets from
        // ModeController#setupBoard (cheese race / dig survival).
        if (this.modeDef.cheeseRows) this.board.addGarbageLines(this.modeDef.cheeseRows);

        this.bag = new PieceBag(types, mulberry32(seed));
        this.random = Math.random;

        this.current = this.bag.next();
        this.pending = this.bag.next();
        this.level = this.startLevel;
        this.lines = 0;
        this.score = 0;
        this.finished = false;

        // Survival mode's periodic garbage growth (mirrors
        // ModeController#update's garbageTimer accumulation).
        this._garbageTimer = null;

        // Mirrors StatsTracker's fields (see stats-tracker.js) so the bot can
        // send a full "stats"/"final" snapshot in the same shape a real peer
        // does, instead of just a bare score.
        this.clearCounts = {1: 0, 2: 0, 3: 0, 4: 0};
        this.piecesSpawned = 0;
        this.drought = 0;
        this.maxDrought = 0;
        this.droughtTotal = 0;
        this.droughtCount = 0;
        this.burn = 0;
        this.currentCombo = 0;
        this.maxCombo = 0;
        this._startedAt = null;
        this._finishedAt = null;

        this._timer = null;
        this._dropTimer = null;
    }

    start() {
        if (this._timer) return;
        this._startedAt = Date.now();
        this._registerPieceSpawn(this.current);
        this._sendBoard();
        this._sendStats();
        this._scheduleNext();
        this._scheduleSurvivalGarbage();
    }

    /** Mirrors StatsTracker#registerPieceSpawn - tracks the I-piece drought. */
    _registerPieceSpawn(type) {
        ++this.piecesSpawned;
        if (type === "I") {
            if (this.drought > 0) {
                this.droughtTotal += this.drought;
                ++this.droughtCount;
            }
            this.drought = 0;
            return;
        }
        ++this.drought;
        this.maxDrought = Math.max(this.maxDrought, this.drought);
    }

    stop() {
        if (this._timer) clearTimeout(this._timer);
        this._timer = null;
        if (this._dropTimer) clearTimeout(this._dropTimer);
        this._dropTimer = null;
        if (this._garbageTimer) clearTimeout(this._garbageTimer);
        this._garbageTimer = null;
    }

    /** Re-arms survival mode's garbage timer (no-op for every other mode). */
    _scheduleSurvivalGarbage() {
        if (this.finished || !this.modeDef.garbage) return;
        this._garbageTimer = setTimeout(() => this._addSurvivalGarbage(), this.modeDef.garbageIntervalMs);
    }

    /**
     * Adds a random-height garbage chunk to the bot's own board, same as
     * ModeController#update does for the player's board in survival mode. If
     * a piece is mid-drop, wait a beat rather than mutating the occupancy
     * the in-flight animation was computed against.
     */
    _addSurvivalGarbage() {
        if (this.finished) return;
        if (this._dropTimer) {
            this._garbageTimer = setTimeout(() => this._addSurvivalGarbage(), 50);
            return;
        }

        const {garbageLinesMin, garbageLinesMax} = this.modeDef;
        const span = garbageLinesMax - garbageLinesMin + 1;
        const count = garbageLinesMin + Math.floor(this.random() * span);
        const {toppedOut} = this.board.addGarbageLines(count);
        this._sendBoard();
        if (toppedOut) {
            this._topOut();
            return;
        }
        this._scheduleSurvivalGarbage();
    }

    _intervalForLevel() {
        const {placeIntervalMs, minIntervalMs} = this.profile;
        // Ramps down ~4% per level above the bot's start level, floored at minIntervalMs -
        // mirrors the game's own "gets faster as you clear lines" feel without needing
        // the full drop-speed curve (the bot places whole pieces, not single rows).
        const levelsIn = Math.max(0, this.level - this.startLevel);
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

        const colorIndex = KLOCKOMINOS[this.current].colorIndex;
        this._animateDrop(placement, colorIndex, () => this._commitPlacement(placement, colorIndex));
    }

    /**
     * Reveals the piece at its spawn rotation, steps it through each
     * intermediate rotation up to the chosen one (so a rotation is actually
     * visible instead of the piece just appearing pre-rotated), then falls
     * it down to its resting row before `_commitPlacement` locks it in -
     * without this the bot would place pieces instantly (empty cell ->
     * locked cell, no in-between), so the "piece" live-update
     * MultiplayerController relies on to show movement/rotation on the
     * opponent panel never had anything to show.
     */
    _animateDrop(placement, colorIndex, onDone) {
        const stepMs = 40;
        const def = KLOCKOMINOS[this.current];
        const spawnX = Math.floor((this.cols - def.width) / 2);

        const startFall = () => this._animateFall(placement, colorIndex, onDone);

        if (placement.rotationState === 0) {
            this._sendPiece({
                x: spawnX, y: 0, mask: def.states[0],
                width: placement.width, height: placement.height, colorIndex,
            });
            this._dropTimer = setTimeout(startFall, stepMs);
            return;
        }

        // Step through 1, 2, ... up to the target rotation state, one frame
        // each, holding the piece at the spawn column the whole time - the
        // same shape a player rotating in place before moving/dropping
        // would show.
        let state = 0;
        const rotateTick = () => {
            if (this.finished) return;
            this._sendPiece({
                x: spawnX, y: 0, mask: def.states[state],
                width: placement.width, height: placement.height, colorIndex,
            });
            if (state >= placement.rotationState) {
                this._dropTimer = setTimeout(startFall, stepMs);
                return;
            }
            state++;
            this._dropTimer = setTimeout(rotateTick, stepMs);
        };
        rotateTick();
    }

    /**
     * Falls the already-rotated piece from the top down to its resting row.
     * Speed is a fixed *per-row* rate (not a fixed total duration) so the
     * piece actually takes longer to fall the further it has to go, instead
     * of every drop - 1 row or 16 - taking the same wall-clock time. That
     * old behaviour made deep drops look like the bot was slamming the
     * piece down (holding the drop key) on every single placement, while
     * shallow drops looked unnaturally slow by comparison.
     */
    _animateFall(placement, colorIndex, onDone) {
        const startY = 0;
        const distance = Math.max(0, placement.y - startY);

        const msPerRow = 35;
        const minTotalMs = 60;
        // Bounded by a share of the bot's own placement cadence, not a tiny
        // fixed millisecond ceiling, so a near-full-height drop on a slow
        // difficulty still visibly takes noticeably longer than a 1-row one.
        const maxTotalMs = Math.max(minTotalMs, this._intervalForLevel() * 0.8);
        const totalMs = Math.min(maxTotalMs, Math.max(minTotalMs, distance * msPerRow));
        const stepMs = 40;
        const steps = Math.max(1, Math.round(totalMs / stepMs));

        let step = 0;
        const tick = () => {
            if (this.finished) return;
            const progress = Math.min(1, step / steps);
            const y = startY + Math.round(distance * progress);
            this._sendPiece({
                x: placement.x, y, mask: placement.mask,
                width: placement.width, height: placement.height, colorIndex,
            });

            if (progress >= 1) {
                onDone();
                return;
            }
            step++;
            this._dropTimer = setTimeout(tick, stepMs);
        };
        tick();
    }

    _commitPlacement(placement, colorIndex) {
        const piece = {
            type: this.current,
            colorIndex,
            mask: placement.mask,
            width: placement.width,
            height: placement.height,
            x: placement.x,
            y: placement.y,
        };
        this.board.lockPiece(piece);
        const cleared = this.board.clearFullLines();

        if (cleared > 0) {
            this.clearCounts[cleared] = (this.clearCounts[cleared] ?? 0) + 1;
            this.burn = cleared === 4 ? 0 : this.burn + cleared;
            this.score += pointsForLineClear(cleared, this.level);
            this.lines += cleared;
            this.level = levelForLines(this.lines, this.startLevel);
            ++this.currentCombo;
            this.maxCombo = Math.max(this.maxCombo, this.currentCombo);

            // Dig survival: every cleared line regrows immediately, same as
            // ModeController#onLinesCleared does for the player's board.
            if (this.mode === "digSurvival") {
                const {toppedOut} = this.board.addGarbageLines(cleared);
                if (toppedOut) {
                    this._sendBoard();
                    this._sendStats();
                    this._topOut();
                    return;
                }
            }
        } else {
            this.currentCombo = 0;
        }

        // The receiving end clears its live-piece overlay as soon as a
        // "board" update comes in (see MultiplayerController#_onPeerMessage)
        // - no need for a separate "piece cleared" message here.
        this._sendBoard();
        this._sendStats();

        // Sprint/cheese race/dig survival all have a concrete finish line
        // (see ModeController#checkObjectiveComplete for the player-side
        // equivalent) - without this the bot just kept digging/sprinting
        // forever, so by the time the player's own round ended at exactly
        // their target the bot could've already blown past it (e.g. 11
        // lines vs. the player's 10), corrupting both the "who finished
        // first" result and the line-count comparison.
        if (this._objectiveComplete()) {
            this.finish();
            return;
        }

        this.current = this.pending;
        this.pending = this.bag.next();
        this._registerPieceSpawn(this.current);

        // Spawn check for the *new* current piece - if it can't even appear, the bot topped out.
        const def = KLOCKOMINOS[this.current];
        const spawnX = Math.floor((this.cols - def.width) / 2);
        if (collidesAt(this.board.occupancy, this.cols, this.rows, def.states[0], def.width, def.height, spawnX, 0)) {
            this._topOut();
            return;
        }

        this._scheduleNext();
    }

    /** Mirrors ModeController#checkObjectiveComplete for whichever mode this match is using. */
    _objectiveComplete() {
        const def = this.modeDef;
        if (this.mode === "sprint") return this.lines >= def.sprintTarget;
        if (this.mode === "cheeseRace") return this.lines >= def.cheeseRows;
        if (this.mode === "digSurvival") return this.lines >= def.digTarget;
        return false;
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
        // Freeze the clock at the moment of finishing (mirrors game.elapsedMs,
        // which stops advancing once the player's own state leaves
        // "running") - otherwise a bot stopped a few seconds *after* the
        // player's round ended would report extra elapsed time it never
        // actually needed, skewing the sprint/cheese-race time comparison.
        this._finishedAt = Date.now();
        this.stop();
        this.dispatchEvent(new CustomEvent("message", {detail: {kind: "final", ...this._statsSnapshot()}}));
    }

    _sendPiece(piece) {
        this.dispatchEvent(new CustomEvent("message", {detail: {kind: "piece", ...piece}}));
    }

    _sendStats() {
        this.dispatchEvent(new CustomEvent("message", {detail: {kind: "stats", ...this._statsSnapshot()}}));
    }

    /**
     * Same shape as MultiplayerController#_localStatsSnapshot for a real
     * peer - both the raw numeric fields (for the result panel's
     * better/worse comparison) and the pre-formatted `display` strings (for
     * the live opponent badge), so the controller's handling of "stats"/
     * "final" messages works identically whether the peer is a bot or human.
     */
    _statsSnapshot() {
        const totalClears = Object.values(this.clearCounts).reduce((sum, n) => sum + n, 0);
        const tetrisRatePercent = totalClears ? (this.clearCounts[4] / totalClears) * 100 : 0;
        const now = this._finishedAt ?? Date.now();
        const elapsedMs = this._startedAt ? now - this._startedAt : 0;
        const elapsedSeconds = elapsedMs / 1000;
        const pps = elapsedSeconds > 0 ? this.piecesSpawned / elapsedSeconds : 0;
        const efficiencyValue = this.lines > 0 ? this.score / this.lines : 0;
        const droughtAvgValue = this.droughtCount > 0 ? this.droughtTotal / this.droughtCount : 0;

        return {
            score: this.score,
            lines: this.lines,
            elapsedMs,
            // Whether the bot actually reached this mode's finish line
            // (sprint/cheese race/dig survival) rather than just being cut
            // off when the player's own round ended first - see
            // MultiplayerController#_showResultPanel, which needs this to
            // judge a race by who finished (and how fast), not by score.
            raceCompleted: this._objectiveComplete(),
            drought: this.drought,
            maxDrought: this.maxDrought,
            droughtTotal: this.droughtTotal,
            droughtAvg: droughtAvgValue,
            burn: this.burn,
            maxCombo: this.maxCombo,
            efficiency: efficiencyValue,
            tetrisRatePercent,
            pps,
            bestRaw: null,
            bestIsTime: false,
            display: {
                best: "—",
                score: formatNumber(this.score),
                lines: String(this.lines),
                tetrisRate: `${tetrisRatePercent.toFixed(1)}%`,
                pps: pps.toFixed(2),
                drought: String(this.drought),
                maxDrought: String(this.maxDrought),
                droughtTotal: String(this.droughtTotal),
                droughtAvg: droughtAvgValue.toFixed(1),
                burn: String(this.burn),
                maxCombo: String(this.maxCombo),
                efficiency: formatNumber(Math.round(efficiencyValue)),
            },
        };
    }

    _sendBoard() {
        this.dispatchEvent(new CustomEvent("message", {detail: {kind: "board", cells: Array.from(this.board.colors)}}));
    }
}
