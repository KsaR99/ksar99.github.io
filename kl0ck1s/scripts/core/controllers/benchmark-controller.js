"use strict";

import {Board} from "../game/board.js";
import {Piece} from "../game/piece.js";
import {PieceBag} from "../game/piece-bag.js";
import {Renderer} from "../rendering/renderer.js";
import {PieceController} from "./piece-controller.js";
import {ModeController} from "./mode-controller.js";
import {StatsTracker} from "./stats-tracker.js";
import {pointsForHardDrop, pointsForLineClear} from "../game/scoring.js";
import {dropIntervalForLevel, nowMs, smoothedInterval, tierForLevel} from "../shared/utils.js";
import {HARD_DROP_TRAIL_DURATION_MS} from "../game/game-constants.js";

const CATEGORY_KEYS = [
    "pieceGeneration", "movement", "rotation",
    "dropOffset", "lockPiece", "lineClearDetect", "lineClearApply", "scoring",
    "renderBackgroundRebuild", "renderBlit", "renderDrawPiece", "renderDrawGhost",
    "audioPlay", "audioStop",
];

function emptyTimings() {
    return Object.fromEntries(CATEGORY_KEYS.map((key) => [key, {ms: 0, ops: 0}]));
}

/**
 * Picks an x for the falling piece to steer toward before it drops. Mostly aims at
 * one of the flattest landing spots on the board (lowest combined stack height under
 * the piece's width) so pieces actually interlock and rows complete sometimes -
 * pure Math.random() x placement almost never finishes a line on a board wider than
 * a couple of cells, which is why lineClearDetect/lineClearApply used to sit at 0 ops
 * for an entire benchmark run. The rest of the time it ignores the board and picks a
 * fully random spot anyway, so the benchmark still covers "bad" random placement,
 * near-full boards, etc. - not just an idealized flat-stacking bot.
 */
function pickTargetX(board, piece, {randomChance = 0.25} = {}) {
    const {cols, rows, occupancy} = board;
    const maxX = cols - piece.width;
    if (maxX <= 0) return 0;
    if (Math.random() < randomChance) return Math.floor(Math.random() * (maxX + 1));

    const heights = new Array(cols);
    for (let c = 0; c < cols; c++) {
        let top = rows;
        for (let y = 0; y < rows; y++) {
            if (occupancy[y] & (1 << c)) {
                top = y;
                break;
            }
        }
        heights[c] = rows - top;
    }

    let candidates = [];
    let bestSum = Infinity;
    for (let x = 0; x <= maxX; x++) {
        let sum = 0;
        for (let c = x; c < x + piece.width; c++) sum += heights[c];
        if (sum < bestSum) {
            bestSum = sum;
            candidates = [x];
        } else if (sum === bestSum) {
            candidates.push(x);
        }
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Minimal stand-in for Game that exposes only the handful of small, DOM-free helper
 * methods PieceController/StatsTracker actually call on their `game` reference
 * (shift-anim interpolation, drop/shift smoothing, fall-trail bookkeeping). Copied
 * verbatim from Game rather than reused via prototype so this file doesn't have to
 * pull in Game's DOM/render-loop/init machinery just to borrow four helpers.
 */
class BenchmarkShadowGame {
    constructor() {
        this.current = null;
        this.lastRowStepTime = 0;
        this.effectiveDropIntervalMs = Infinity;
        this.lastColStepTime = 0;
        this.effectiveShiftIntervalMs = Infinity;
        this.shiftAnim = null;
        this.hardDropTrail = null;
    }

    get stats() {
        return this.statsTracker.stats;
    }

    getShiftDisplayX() {
        if (!this.shiftAnim) return this.current?.x;
        const t = Math.min(1, this.shiftAnim.elapsed / this.shiftAnim.duration);
        const {fromX, toX} = this.shiftAnim;
        return fromX + (toX - fromX) * t;
    }

    noteRowStep() {
        ({lastTime: this.lastRowStepTime, effectiveMs: this.effectiveDropIntervalMs} =
            smoothedInterval(this.lastRowStepTime, this.effectiveDropIntervalMs, nowMs()));
    }

    noteColStep() {
        ({lastTime: this.lastColStepTime, effectiveMs: this.effectiveShiftIntervalMs} =
            smoothedInterval(this.lastColStepTime, this.effectiveShiftIntervalMs, nowMs()));
    }

    resetFallTrail() {
        this.lastRowStepTime = 0;
        this.effectiveDropIntervalMs = Infinity;
        this.lastColStepTime = 0;
        this.effectiveShiftIntervalMs = Infinity;
    }

    beginHardDropTrail(piece, cellsDropped) {
        if (!this.settings.fallTrail || cellsDropped <= 0) {
            this.hardDropTrail = null;
            return;
        }

        const entries = [];
        for (let step = 0; step <= cellsDropped; step++) {
            entries.push({
                x: piece.x, y: piece.y - step, mask: piece.mask,
                width: piece.width, height: piece.height, color: piece.color,
            });
        }

        this.hardDropTrail = {entries, elapsed: 0, duration: HARD_DROP_TRAIL_DURATION_MS};
    }
}

/**
 * Developer-mode tool: plays out `pieceCount` piece placements (rotated and steered
 * toward a landing column - see pickTargetX() - with some pure randomness mixed in,
 * so full rows actually complete sometimes instead of never) through the
 * *real* gameplay methods (PieceController.moveHorizontal/rotate/hardDrop/
 * finishLineClear, Board.lockPiece/getFullLineIndices/clearFullLines, the real
 * Renderer and SoundManager, ...) against a throwaway board/bag/stats set - the
 * live game's own board and score are never touched - and times where the
 * engine's time actually goes, so slow parts are easy to spot without profiling
 * tools. Because it drives the same code a real game does, it also plays out as
 * a (silent, fast-forwarded) real round on the preview canvas while it runs.
 */
export class BenchmarkController {
    constructor(game) {
        this.game = game;
        this._offscreenRenderer = null;
    }

    /** Builds (once) a Renderer that draws to the benchmark's preview canvas (or a
     * detached one if that markup isn't present), reusing the real, already-warmed
     * sprite cache and the real board's cell size so render timings stay realistic. */
    _getOffscreenRenderer() {
        if (this._offscreenRenderer) return this._offscreenRenderer;

        const game = this.game;
        const liveRenderer = game.renderer;
        const size = liveRenderer.boardConfig.CELL_SIZE;

        const boardCanvas = game.dom?.querySelector('[data-role="benchmark-preview-canvas"]')
            ?? document.createElement("canvas");
        boardCanvas.width = game.board.cols * size;
        boardCanvas.height = game.board.rows * size;
        const ctx = boardCanvas.getContext("2d");

        const nextCanvas = document.createElement("canvas");
        const nextCtx = nextCanvas.getContext("2d");

        this._offscreenRenderer = new Renderer({
            bodyEl: document.body,
            boardEl: null,
            ctx,
            boardCanvas,
            nextCtx,
            nextCanvas,
            spriteCache: liveRenderer.spriteCache,
            nextSpriteCache: liveRenderer.nextSpriteCache,
            boardConfig: liveRenderer.boardConfig,
            klockominos: liveRenderer.klockominos,
            colorPalette: liveRenderer.colorPalette,
            nextPreviewCellSize: liveRenderer.nextPreviewCellSize,
        });

        this._offscreenRenderer.setGlowEnabled(liveRenderer.glowEnabled);
        this._offscreenRenderer.setTransparencyEnabled(liveRenderer.transparencyEnabled);
        this._offscreenRenderer.setGhostEnabled(liveRenderer.ghostEnabled);
        this._offscreenRenderer.setGridEnabled(liveRenderer.gridEnabled);
        this._offscreenRenderer.setHeightSaturationEnabled(liveRenderer.heightSaturationEnabled);

        return this._offscreenRenderer;
    }

    /** Inert stand-in for SoundManager used as `shadow.soundManager` inside the
     * simulated gameplay path (PieceController/StatsTracker call `game.soundManager.play/
     * stop/...` as an ordinary part of locking/rotating/clearing). Deliberately does NOT
     * forward to the real SoundManager: play(key, {volume: 0}) still creates a real
     * AudioBufferSourceNode + GainNode and calls source.start(0) - genuine Web Audio
     * graph work - which would get silently absorbed into whichever benchmark category
     * happens to call it (e.g. every lockCurrentPiece() -> "Blokowanie klocka na
     * planszy"), mislabeling real audio-API cost as engine/render cost. The benchmark
     * already measures actual WebAudio play/stop cost explicitly and separately (see the
     * dedicated audioPlay/audioStop timings below, using the real liveGame.soundManager),
     * so this stub only needs to satisfy the call sites without doing real audio work. */
    _mutedSoundManager() {
        return {
            play: () => null,
            playSequence: () => null,
            stop: () => {
            },
            stopCategory: () => {
            },
            pause: () => {
            },
            resume: () => {
            },
            setPlaybackRate: () => {
            },
            getDuration: (...args) => this.game.soundManager.getDuration(...args),
        };
    }

    /**
     * @param {object} [opts]
     * @param {number} [opts.pieceCount=500]
     * @param {(done: number, total: number) => void} [opts.onProgress]
     * @returns {Promise<{results: Array<{key: string, totalMs: number, avgMs: number, opsCount: number, percent: number}>, totalMs: number, pieceCount: number}>}
     */
    async run({pieceCount = 500, onProgress = null} = {}) {
        const liveGame = this.game;
        const cols = liveGame.board.cols;
        const rows = liveGame.board.rows;

        const shadow = new BenchmarkShadowGame();
        shadow.board = new Board(cols, rows);
        shadow.bag = new PieceBag(liveGame.bag.types);
        shadow.renderer = this._getOffscreenRenderer();
        shadow.settings = liveGame.settings;
        shadow.scoring = liveGame.scoring;
        shadow.difficulties = liveGame.difficulties;
        shadow.difficulty = liveGame.difficulty;
        shadow.gameModes = liveGame.gameModes;
        shadow.mode = "marathon";
        shadow.i18n = liveGame.i18n;
        shadow.leaderboard = liveGame.leaderboard;
        shadow.hud = {
            update() {
            }
        };
        shadow.soundManager = this._mutedSoundManager();
        shadow.sensitivityCalibrationController = null;
        shadow.steeringArbiter = null;
        shadow.pointerClientX = null;
        shadow.state = "running";
        shadow.lastAction = null;
        shadow.rotationAnim = null;
        shadow.hardDropUsed = false;
        shadow.dropCounter = 0;
        shadow.lockDelayTimer = 0;
        shadow.lockDelayResets = 0;
        shadow.groundedTime = 0;
        shadow.isGrounded = false;
        shadow.groundedGraceTimer = 0;
        shadow.groundedSoundRate = 1;
        shadow.groundedSoundId = null;
        shadow.fallingSoundId = null;
        shadow.pendingSpin = null;
        shadow.clearingLines = [];
        shadow.clearingFragments = [];
        shadow.clearingDropRows = [];
        shadow.clearingTimer = 0;
        shadow.currentCombo = 0;
        shadow.maxCombo = 0;
        shadow.levelUpBannerDuration = liveGame.levelUpBannerDuration;
        shadow.transitionScore = null;

        shadow.statsTracker = new StatsTracker(shadow);
        shadow.modeController = new ModeController(shadow);
        shadow.pieceController = new PieceController(shadow);

        const startNewRound = () => {
            shadow.board.reset();
            shadow.modeController.setupBoard();
            const startLevel = shadow.difficulties[shadow.difficulty].startLevel;
            shadow.startLevel = startLevel;
            shadow.level = startLevel;
            shadow.levelTier = tierForLevel(startLevel, shadow.difficulties);
            shadow.dropInterval = dropIntervalForLevel(startLevel, shadow.scoring);
            shadow.statsTracker.reset();
            shadow.modeController.reset();
            shadow.pieceController.reset();
        };

        shadow.screenFlow = {
            gameOver: async () => startNewRound(),
        };

        startNewRound();

        const measurementBag = new PieceBag(shadow.bag.types);

        const timings = emptyTimings();
        const mark = () => performance.now();

        const previewCanvas = liveGame.dom?.querySelector('[data-role="benchmark-preview-canvas"]');
        if (previewCanvas) previewCanvas.hidden = false;

        try {
            for (let i = 0; i < pieceCount; i++) {
                let t0 = mark();
                const genType = measurementBag.next();
                new Piece(genType, {cols});
                timings.pieceGeneration.ms += mark() - t0;
                timings.pieceGeneration.ops++;

                const rotateAttempts = Math.floor(Math.random() * 3);
                for (let r = 0; r < rotateAttempts; r++) {
                    const dir = Math.random() < 0.5 ? 1 : -1;
                    t0 = mark();
                    shadow.pieceController.rotate(dir);
                    timings.rotation.ms += mark() - t0;
                    timings.rotation.ops++;
                }

                const targetX = pickTargetX(shadow.board, shadow.current);
                let steerGuard = cols;
                while (shadow.current.x !== targetX && steerGuard-- > 0) {
                    const dir = shadow.current.x < targetX ? 1 : -1;
                    t0 = mark();
                    shadow.pieceController.moveHorizontal(dir);
                    timings.movement.ms += mark() - t0;
                    timings.movement.ops++;
                    if (shadow.current.x === targetX) break;
                }

                const jitterSteps = Math.random() < 0.3 ? 1 + Math.floor(Math.random() * 2) : 0;
                for (let j = 0; j < jitterSteps; j++) {
                    const dir = Math.random() < 0.5 ? 1 : -1;
                    t0 = mark();
                    shadow.pieceController.moveHorizontal(dir);
                    timings.movement.ms += mark() - t0;
                    timings.movement.ops++;
                }

                t0 = mark();
                const cellsDropped = shadow.board.getDropOffset(shadow.current);
                timings.dropOffset.ms += mark() - t0;
                timings.dropOffset.ops++;

                t0 = mark();
                pointsForHardDrop(cellsDropped, shadow.scoring);
                timings.scoring.ms += mark() - t0;
                timings.scoring.ops++;

                t0 = mark();
                shadow.pieceController.hardDrop();
                timings.lockPiece.ms += mark() - t0;
                timings.lockPiece.ops++;

                t0 = mark();
                const fullRows = shadow.board.getFullLineIndices();
                timings.lineClearDetect.ms += mark() - t0;
                timings.lineClearDetect.ops++;

                if (shadow.state === "clearing") {
                    const clearedCount = Math.min(fullRows.length, 4);
                    t0 = mark();
                    pointsForLineClear(clearedCount, shadow.level, shadow.scoring);
                    timings.scoring.ms += mark() - t0;
                    timings.scoring.ops++;

                    t0 = mark();
                    shadow.pieceController.finishLineClear();
                    timings.lineClearApply.ms += mark() - t0;
                    timings.lineClearApply.ops++;
                }

                const piece = shadow.current;
                const size = shadow.renderer.boardConfig.CELL_SIZE;

                t0 = mark();
                shadow.renderer.updateBoardBackground(shadow.board, size);
                timings.renderBackgroundRebuild.ms += mark() - t0;
                timings.renderBackgroundRebuild.ops++;

                t0 = mark();
                shadow.renderer.ctx.clearRect(0, 0, shadow.renderer.boardCanvas.width, shadow.renderer.boardCanvas.height);
                shadow.renderer.ctx.drawImage(shadow.renderer.backgroundCanvas, 0, 0);
                timings.renderBlit.ms += mark() - t0;
                timings.renderBlit.ops++;

                t0 = mark();
                shadow.renderer.drawPiece(piece, shadow.board);
                timings.renderDrawPiece.ms += mark() - t0;
                timings.renderDrawPiece.ops++;

                t0 = mark();
                shadow.renderer.drawGhost(piece, shadow.board);
                timings.renderDrawGhost.ms += mark() - t0;
                timings.renderDrawGhost.ops++;

                t0 = mark();
                let playedId = null;
                try {
                    playedId = liveGame.soundManager.play("drop", {volume: 0});
                } catch {
                    // Audio engine unavailable - timing still reflects the (fast) no-op cost.
                }
                timings.audioPlay.ms += mark() - t0;
                timings.audioPlay.ops++;

                t0 = mark();
                try {
                    if (playedId != null) liveGame.soundManager.stop(playedId);
                } catch {
                    // ignore
                }
                timings.audioStop.ms += mark() - t0;
                timings.audioStop.ops++;

                onProgress?.(i + 1, pieceCount);

                // Yield often enough that the preview canvas actually paints, giving a
                // visible (silent, fast-forwarded) sped-up round while the benchmark runs.
                if (i % 5 === 4) {
                    await new Promise((resolve) => requestAnimationFrame(resolve));
                }
            }
        } finally {
            if (previewCanvas) previewCanvas.hidden = true;
        }

        const totalMs = CATEGORY_KEYS.reduce((sum, key) => sum + timings[key].ms, 0);
        const results = CATEGORY_KEYS
            .map((key) => ({
                key,
                totalMs: timings[key].ms,
                avgMs: timings[key].ops ? timings[key].ms / timings[key].ops : 0,
                opsCount: timings[key].ops,
                percent: totalMs > 0 ? (timings[key].ms / totalMs) * 100 : 0,
            }))
            .sort((a, b) => b.totalMs - a.totalMs);

        return {results, totalMs, pieceCount};
    }
}
