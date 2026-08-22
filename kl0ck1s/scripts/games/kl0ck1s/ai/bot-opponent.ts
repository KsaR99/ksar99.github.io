// @ts-nocheck
import type {KlockominoType} from "../game/piece.js";
import {buildDropRows, choosePlacement, collidesAt} from "./bot-placement.js";
import {BotObjective, type BotObjectiveDefinition} from "./bot-objective.js";
import {DIFFICULTIES, KLOCKOMINOS, LINE_CLEAR_ANIMATION_DURATION_MS, SCORING} from "../shared/config.js";
import {MESSAGE_KIND} from "../../../engine/net/net-constants.js";
import {Board} from "../game/board.js";
import {deepestReachableRow} from "../game/modes/marathon-hardcore-mode.js";
import {
    HARD_DROP_IMPACT_FLASH_DURATION_MS,
    HARD_DROP_TRAIL_ALPHAS,
    HARD_DROP_TRAIL_DURATION_MS
} from "../game/game-constants.js";
import {PieceBag} from "../game/piece-bag.js";
import {levelForLines, pointsForLineClear} from "../game/scoring.js";
import {mulberry32} from "../../../engine/random/seeded-random.js";
import {formatNumber, rollSurvivalGarbageCount, tierForLevel} from "../shared/utils.js";

"use strict";

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

export class BotOpponent extends EventTarget {

    types: KlockominoType[];
    cols: number;
    rows: number;
    difficultyKey: string;
    profile: {
        startLevel: number;
        placeIntervalMs: number;
        minIntervalMs: number;
        mistakeChance: number;
        lookahead: boolean;
        reactionMs: number;
        hardDropChance: number;
    };
    startLevel: number;
    mode: string;
    modeDef: BotObjectiveDefinition;
    objective: BotObjective;
    board: Board;
    bag: PieceBag;
    random: () => number;
    current: KlockominoType;
    pending: KlockominoType;
    level: number;
    lines: 0;
    score: 0;
    finished: false | true;
    _garbageTimer: null | number;
    countdownRemainingMs: number;
    _countdownTimer: null | number;
    clearCounts: { 1: number; 2: number; 3: number; 4: number; };
    piecesSpawned: 0;
    drought: 0;
    maxDrought: 0 | number;
    droughtTotal: 0;
    droughtCount: 0;
    burn: 0;
    currentCombo: 0;
    maxCombo: 0 | number;
    _startedAt: null | number;
    _finishedAt: null | number;
    _timer: null | number;
    _startDelayTimer: null | number;
    _dropTimer: null | number;
    _clearTimer: null | number;
    _pendingClear: null;
    _pieceInFlight: false | true;
    _paused: false | true;
    _lastPlacementWasHardDrop: true | false;

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
        this.objective = new BotObjective(this.mode, this.modeDef);

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
        this._startDelayTimer = null;
        this._dropTimer = null;
        this._clearTimer = null;
        this._pendingClear = null;
        this._pieceInFlight = false;
        this._paused = false;
    }

    start(delayMs = 0) {
        if (this._timer || this._startDelayTimer) return;

        const activate = () => {
            this._startDelayTimer = null;
            if (this.finished) return;
            this._startedAt = Date.now();
            this._registerPieceSpawn(this.current);
            this._sendBoard();
            this._sendStats();
            this._scheduleNext();
            this._scheduleSurvivalGarbage();
            this._scheduleCountdownTick();
        };

        if (delayMs > 0) {
            this._startDelayTimer = setTimeout(activate, delayMs);
        } else {
            activate();
        }
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
        if (this._startDelayTimer) clearTimeout(this._startDelayTimer);
        this._startDelayTimer = null;
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

    _objectiveSnapshot() {
        return {
            mode: this.mode,
            lines: this.lines,
            boardRows: this.board.rows,
            boardOccupancy: this.board.occupancy,
            startedAt: this._startedAt,
            finishedAt: this._finishedAt,
            countdownRemainingMs: this.countdownRemainingMs,
        };
    }

    _objectiveText() {
        return this.objective.text(this._objectiveSnapshot());
    }

    _objectivePercent() {
        return this.objective.percent(this._objectiveSnapshot());
    }

    _objectiveUrgency() {
        return this.objective.urgency(this._objectiveSnapshot());
    }

    _objectiveColorMode() {
        return this.objective.colorMode();
    }

    _objectiveComplete() {
        return this.objective.isComplete(this.lines);
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
        let ghostY = piece.y;
        try {
            while (!collidesAt(this.board.occupancy, this.cols, this.rows, piece.mask, piece.width, piece.height, piece.x, ghostY + 1)) ghostY++;
        } catch {
        }
        this.dispatchEvent(new CustomEvent("message", {
            detail: {
                kind: MESSAGE_KIND.PIECE,
                pieceIndex: this.piecesSpawned,
                pieceType: this.current,
                ghostY,
                ...piece,
            },
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
            hardcoreMaskRow: this.modeDef.hardcoreMask ? deepestReachableRow(this.board, this.current) : null,
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
