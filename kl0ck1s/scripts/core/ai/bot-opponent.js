"use strict";

import {DIFFICULTIES, KLOCKOMINOS, LINE_CLEAR_ANIMATION_DURATION_MS, SCORING} from "../shared/config.js";
import {MESSAGE_KIND} from "../net/net-constants.js";
import {Board} from "../game/board.js";
import {
    HARD_DROP_IMPACT_FLASH_DURATION_MS,
    HARD_DROP_TRAIL_ALPHAS,
    HARD_DROP_TRAIL_DURATION_MS
} from "../game/game-constants.js";
import {PieceBag} from "../game/piece-bag.js";
import {levelForLines, pointsForLineClear} from "../game/scoring.js";
import {mulberry32} from "../shared/seeded-random.js";
import {formatDuration, formatNumber, rollSurvivalGarbageCount, tierForLevel} from "../shared/utils.js";

export const BOT_DIFFICULTIES = Object.freeze({
    easy: Object.freeze({
        startLevel: 1,
        placeIntervalMs: 900,
        minIntervalMs: 550,
        mistakeChance: 0.35,
        lookahead: false,
        reactionMs: 300,
        hardDropChance: 0.15,
    }),
    medium: Object.freeze({
        startLevel: 3,
        placeIntervalMs: 600,
        minIntervalMs: 350,
        mistakeChance: 0.14,
        lookahead: true,
        reactionMs: 210,
        hardDropChance: 0.45,
    }),
    hard: Object.freeze({
        startLevel: 6,
        placeIntervalMs: 380,
        minIntervalMs: 180,
        mistakeChance: 0.03,
        lookahead: true,
        reactionMs: 90,
        hardDropChance: 0.8,
    }),
});

const FREE_FALL_MS_PER_ROW = 12;
const FREE_FALL_MIN_MS = 60;
const FREE_FALL_MAX_MS = 180;
const FREE_FALL_STEP_MS = 40;
const HARD_DROP_COMMIT_MS = 20;

const WEIGHTS = Object.freeze({
    aggregateHeight: -0.510066,
    lines: 0.760666,
    holes: -0.35663,
    bumpiness: -0.184483,
});

function buildDropRows(fullRows, rowCount) {
    const dropRows = new Uint8Array(rowCount);
    for (let y = 0; y < rowCount; y++) {
        dropRows[y] = fullRows.reduce((count, clearedY) => count + (clearedY > y ? 1 : 0), 0);
    }
    return dropRows;
}

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
    const heights = new Uint8Array(cols);
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

    if (ranked.length > 1 && random() < mistakeChance) {
        const pool = ranked.slice(0, Math.min(ranked.length, 5));
        return pool[Math.floor(random() * pool.length)];
    }
    return ranked[0];
}

export class BotOpponent extends EventTarget {
    constructor({
                    types,
                    cols,
                    rows,
                    seed,
                    difficultyKey = "medium",
                    difficulties = BOT_DIFFICULTIES,
                    startLevel = null,
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
        if (this.modeDef.cheeseRows) this.board.addGarbageLines(this.modeDef.cheeseRows);

        this.bag = new PieceBag(types, mulberry32(seed));
        this.random = Math.random;

        this.current = this.bag.next();
        this.pending = this.bag.next();
        this.level = this.startLevel;
        this.lines = 0;
        this.score = 0;
        this.finished = false;

        this._garbageTimer = null;

        this.countdownRemainingMs = this.modeDef.countdownStartMs ?? 0;
        this._countdownTimer = null;

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
        this._clearTimer = null;
        this._pendingClear = null;
        this._pieceInFlight = false;
        this._paused = false;
    }

    start() {
        if (this._timer) return;
        this._startedAt = Date.now();
        this._registerPieceSpawn(this.current);
        this._sendBoard();
        this._sendStats();
        this._scheduleNext();
        this._scheduleSurvivalGarbage();
        this._scheduleCountdownTick();
    }

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
        if (this._clearTimer) clearTimeout(this._clearTimer);
        this._clearTimer = null;
        if (this._garbageTimer) clearTimeout(this._garbageTimer);
        this._garbageTimer = null;
        if (this._countdownTimer) clearTimeout(this._countdownTimer);
        this._countdownTimer = null;
        this._pieceInFlight = false;
    }

    pause() {
        if (this._paused || this.finished) return;
        this._paused = true;
        this.stop();
    }

    resume() {
        if (!this._paused || this.finished) return;
        this._paused = false;

        if (this._pendingClear) {
            this._pendingClear = null;
            this._finishClear();
        } else {
            this._scheduleNext();
        }
        this._scheduleSurvivalGarbage();
        this._scheduleCountdownTick();
    }

    _scheduleSurvivalGarbage() {
        if (this.finished || !this.modeDef.garbage) return;
        this._garbageTimer = setTimeout(() => this._addSurvivalGarbage(), this.modeDef.garbageIntervalMs);
    }

    _addSurvivalGarbage() {
        if (this.finished) return;
        if (this._pieceInFlight || this._pendingClear) {
            this._garbageTimer = setTimeout(() => this._addSurvivalGarbage(), 50);
            return;
        }

        const count = rollSurvivalGarbageCount(this.modeDef, this.random);
        const {toppedOut} = this.board.addGarbageLines(count);
        this._sendBoard();
        if (toppedOut) {
            this._topOut();
            return;
        }
        this._scheduleSurvivalGarbage();
    }

    _scheduleCountdownTick() {
        if (this.finished || this.mode !== "countdown") return;
        const stepMs = 200;
        this._countdownTimer = setTimeout(() => {
            this.countdownRemainingMs -= stepMs;
            if (this.countdownRemainingMs <= 0) {
                this.finish();
                return;
            }
            this._scheduleCountdownTick();
        }, stepMs);
    }

    _intervalForLevel() {
        const {placeIntervalMs, minIntervalMs} = this.profile;
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

    _animateDrop(placement, colorIndex, onDone) {
        this._pieceInFlight = true;
        const def = KLOCKOMINOS[this.current];
        const spawnX = Math.floor((this.cols - def.width) / 2);

        this._sendPiece({
            x: spawnX, y: 0, mask: def.states[0],
            width: placement.width, height: placement.height, colorIndex,
            pivotX: this.current === "I" ? 1.5 : this.current === "O" ? 0.5 : 1,
            pivotY: this.current === "I" ? 1.5 : this.current === "O" ? 0.5 : 1,
            rotationAngle: 0,
        });
        this._dropTimer = setTimeout(
            () => this._rotateThenSlide(placement, colorIndex, spawnX, onDone),
            this.profile.reactionMs,
        );
    }

    _rotateThenSlide(placement, colorIndex, spawnX, onDone) {
        const stepMs = 100;
        const def = KLOCKOMINOS[this.current];
        const startSlide = () => this._animateSlide(placement, colorIndex, spawnX, onDone);

        if (placement.rotationState === 0) {
            startSlide();
            return;
        }

        let state = 0;
        const rotateTick = () => {
            if (this.finished) return;
            const nextState = state + 1;
            this._sendPiece({
                x: spawnX, y: 0, mask: def.states[nextState],
                width: placement.width, height: placement.height, colorIndex,
                pivotX: this.current === "I" ? 1.5 : this.current === "O" ? 0.5 : 1,
                pivotY: this.current === "I" ? 1.5 : this.current === "O" ? 0.5 : 1,
                rotationAngle: 90,
            });
            state = nextState;
            if (state >= placement.rotationState) {
                this._dropTimer = setTimeout(startSlide, stepMs);
                return;
            }
            this._dropTimer = setTimeout(rotateTick, stepMs);
        };
        rotateTick();
    }

    _animateSlide(placement, colorIndex, spawnX, onDone) {
        const startFall = () => this._animateFall(placement, colorIndex, onDone);

        if (spawnX === placement.x) {
            startFall();
            return;
        }

        const dx = placement.x > spawnX ? 1 : -1;
        const slideStepMs = Math.max(18, Math.round(this.profile.reactionMs / 4));

        let x = spawnX;
        const tick = () => {
            if (this.finished) return;
            x += dx;
            this._sendPiece({
                x, y: 0, mask: placement.mask,
                width: placement.width, height: placement.height, colorIndex,
            });
            if (x === placement.x) {
                this._dropTimer = setTimeout(startFall, slideStepMs);
                return;
            }
            this._dropTimer = setTimeout(tick, slideStepMs);
        };
        tick();
    }

    _animateFall(placement, colorIndex, onDone) {
        const startY = 0;
        const distance = Math.max(0, placement.y - startY);

        if (this.random() < this.profile.hardDropChance) {
            this._lastPlacementWasHardDrop = true;
            this._sendHardDropTrail(placement, distance);
            this._sendPiece({
                x: placement.x, y: placement.y, mask: placement.mask,
                width: placement.width, height: placement.height, colorIndex,
            });
            this._dropTimer = setTimeout(onDone, HARD_DROP_COMMIT_MS);
            return;
        }

        this._lastPlacementWasHardDrop = false;
        const totalMs = Math.min(FREE_FALL_MAX_MS, Math.max(FREE_FALL_MIN_MS, distance * FREE_FALL_MS_PER_ROW));
        const steps = Math.max(1, Math.round(totalMs / FREE_FALL_STEP_MS));

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
            this._dropTimer = setTimeout(tick, FREE_FALL_STEP_MS);
        };
        tick();
    }

    _commitPlacement(placement, colorIndex) {
        this._pieceInFlight = false;
        const piece = {
            type: this.current,
            colorIndex,
            mask: placement.mask,
            width: placement.width,
            height: placement.height,
            x: placement.x,
            y: placement.y,
        };

        if (this._lastPlacementWasHardDrop !== true) {
            this._sendLockImpactFlash(piece);
        }
        this.board.lockPiece(piece);

        const fullRows = this.board.getFullLineIndices();
        if (fullRows.length === 0) {
            this._finishClear();
            return;
        }

        this.dispatchEvent(new CustomEvent("message", {
            detail: {
                kind: MESSAGE_KIND.CLEARING,
                cells: Array.from(this.board.colors),
                lines: fullRows,
                dropRows: buildDropRows(fullRows, this.rows),
                duration: LINE_CLEAR_ANIMATION_DURATION_MS,
            },
        }));

        this._pendingClear = fullRows;
        this._clearTimer = setTimeout(() => {
            this._clearTimer = null;
            this._pendingClear = null;
            this._finishClear();
        }, LINE_CLEAR_ANIMATION_DURATION_MS);
    }

    _finishClear() {
        const cleared = this.board.clearFullLines();

        if (cleared > 0) {
            this.clearCounts[cleared] = (this.clearCounts[cleared] ?? 0) + 1;
            this.burn = cleared === 4 ? 0 : this.burn + cleared;
            this.score += pointsForLineClear(cleared, this.level);
            this.lines += cleared;
            this.level = levelForLines(this.lines, this.startLevel);
            ++this.currentCombo;
            this.maxCombo = Math.max(this.maxCombo, this.currentCombo);

            if (this.mode === "countdown" && this.modeDef.countdownBonusMs) {
                const bonusMs = this.modeDef.countdownBonusMs[Math.min(cleared, this.modeDef.countdownBonusMs.length - 1)];
                this.countdownRemainingMs += bonusMs;
            }

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

        this._sendBoard();
        this._sendStats();

        if (this._objectiveComplete()) {
            this.finish();
            return;
        }

        this.current = this.pending;
        this.pending = this.bag.next();
        this._registerPieceSpawn(this.current);

        const def = KLOCKOMINOS[this.current];
        const spawnX = Math.floor((this.cols - def.width) / 2);
        if (collidesAt(this.board.occupancy, this.cols, this.rows, def.states[0], def.width, def.height, spawnX, 0)) {
            this._topOut();
            return;
        }

        this._scheduleNext();
    }

    _objectiveText() {
        const def = this.modeDef;
        if (this.mode === "sprint") return `${this.lines} / ${def.sprintTarget}`;
        if (this.mode === "cheeseRace") return `${this.lines} / ${def.cheeseRows}`;
        if (this.mode === "digSurvival") return `${this.lines} / ${def.digTarget}`;
        if (this.mode === "ultra") {
            const now = this._finishedAt ?? Date.now();
            const elapsedMs = this._startedAt ? now - this._startedAt : 0;
            return formatDuration(Math.max(0, (def.timeLimitMs ?? 0) - elapsedMs));
        }
        if (this.mode === "countdown") return formatDuration(Math.max(0, this.countdownRemainingMs ?? 0));
        if (this.mode === "zen") return `${this._zenHeight()}`;
        return null;
    }

    _zenHeight() {
        const board = this.board;
        let highestFilledRow = board.rows;
        for (let y = 0; y < board.rows; y++) {
            if (board.occupancy[y] !== 0) {
                highestFilledRow = y;
                break;
            }
        }
        return board.rows - highestFilledRow;
    }

    _objectivePercent() {
        const def = this.modeDef;
        if (this.mode === "sprint") return Math.min(100, (this.lines / def.sprintTarget) * 100);
        if (this.mode === "cheeseRace") return Math.min(100, (this.lines / def.cheeseRows) * 100);
        if (this.mode === "digSurvival") return Math.min(100, (this.lines / def.digTarget) * 100);
        if (this.mode === "ultra") {
            const now = this._finishedAt ?? Date.now();
            const elapsedMs = this._startedAt ? now - this._startedAt : 0;
            return Math.min(100, (elapsedMs / (def.timeLimitMs ?? 1)) * 100);
        }
        if (this.mode === "countdown") return Math.min(100, ((this.countdownRemainingMs ?? 0) / (def.countdownStartMs ?? 1)) * 100);
        return null;
    }

    _objectiveUrgency() {
        const def = this.modeDef;
        let remainingMs;
        if (this.mode === "ultra") {
            const now = this._finishedAt ?? Date.now();
            const elapsedMs = this._startedAt ? now - this._startedAt : 0;
            remainingMs = (def.timeLimitMs ?? 0) - elapsedMs;
        } else if (this.mode === "countdown") {
            remainingMs = this.countdownRemainingMs ?? 0;
        } else {
            return null;
        }

        if (remainingMs <= 5000) return "danger";
        if (remainingMs <= 10000) return "warning";
        return null;
    }

    _objectiveColorMode() {
        if (["sprint", "cheeseRace", "digSurvival"].includes(this.mode)) return "ramp";
        if (["ultra", "countdown"].includes(this.mode)) return "urgency";
        return null;
    }

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

    finish() {
        if (this.finished) return;
        this.finished = true;
        this._finishedAt = Date.now();
        this.stop();
        this.dispatchEvent(new CustomEvent("message", {detail: {kind: MESSAGE_KIND.FINAL, ...this._statsSnapshot()}}));
    }

    _sendPiece(piece) {
        this.dispatchEvent(new CustomEvent("message", {
            detail: {kind: MESSAGE_KIND.PIECE, pieceIndex: this.piecesSpawned, ...piece},
        }));
    }

    _sendLockImpactFlash(piece) {
        this.dispatchEvent(new CustomEvent("message", {
            detail: {
                kind: MESSAGE_KIND.HARD_DROP_TRAIL,
                entries: [],
                duration: 0,
                flashEntry: {
                    x: piece.x,
                    y: piece.y,
                    mask: piece.mask,
                    width: piece.width,
                    height: piece.height,
                },
                flashDuration: HARD_DROP_IMPACT_FLASH_DURATION_MS,
            },
        }));
    }

    _sendHardDropTrail(placement, cellsDropped) {
        if (cellsDropped <= 0) return;

        const count = Math.min(HARD_DROP_TRAIL_ALPHAS.length, Math.floor(cellsDropped) + 1);
        const step = count > 1 ? cellsDropped / (count - 1) : 0;
        const color = KLOCKOMINOS[this.current].color;

        const entries = [];
        for (let i = 0; i < count; i++) {
            entries.push({
                x: placement.x, y: placement.y - i * step,
                mask: placement.mask, width: placement.width, height: placement.height,
                color,
            });
        }

        this.dispatchEvent(new CustomEvent("message", {
            detail: {
                kind: MESSAGE_KIND.HARD_DROP_TRAIL,
                entries,
                duration: HARD_DROP_TRAIL_DURATION_MS,
                flashEntry: {
                    x: placement.x,
                    y: placement.y,
                    mask: placement.mask,
                    width: placement.width,
                    height: placement.height,
                },
                flashDuration: HARD_DROP_IMPACT_FLASH_DURATION_MS,
            },
        }));
    }

    _sendStats() {
        this.dispatchEvent(new CustomEvent("message", {detail: {kind: MESSAGE_KIND.STATS, ...this._statsSnapshot()}}));
    }

    _statsSnapshot() {
        const totalClears = Object.values(this.clearCounts).reduce((sum, n) => sum + n, 0);
        const tetrisRatePercent = totalClears ? (this.clearCounts[4] / totalClears) * 100 : 0;
        const now = this._finishedAt ?? Date.now();
        const elapsedMs = this._startedAt ? now - this._startedAt : 0;
        const elapsedSeconds = elapsedMs / 1000;
        const pps = elapsedSeconds >= 1 ? this.piecesSpawned / elapsedSeconds : 0;
        const efficiencyValue = this.lines > 0 ? this.score / this.lines : 0;
        const droughtAvgValue = this.droughtCount > 0 ? this.droughtTotal / this.droughtCount : 0;

        return {
            score: this.score,
            lines: this.lines,
            elapsedMs,
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
            isTimedRaceMode: this.mode === "sprint" || this.mode === "cheeseRace",
            objective: this._objectiveText(),
            objectiveLabelKey: this.mode === "zen" ? "sidebar.height" : "sidebar.objective",
            objectivePercent: this._objectivePercent(),
            objectiveUrgency: this._objectiveUrgency(),
            objectiveColorMode: this._objectiveColorMode(),
            hasLevelProgress: this.modeDef.noLevelBar !== true,
            difficultyTier: tierForLevel(this.level, DIFFICULTIES),
            difficultyLevel: this.level,
            difficultyPercent: SCORING.LINES_PER_LEVEL
                ? Math.floor(((this.lines % SCORING.LINES_PER_LEVEL) / SCORING.LINES_PER_LEVEL) * 100)
                : 0,
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
        this.dispatchEvent(new CustomEvent("message", {
            detail: {
                kind: MESSAGE_KIND.BOARD,
                cells: Array.from(this.board.colors)
            }
        }));
    }
}
