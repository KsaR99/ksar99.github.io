// @ts-nocheck
import type {Game} from "../game/game.js";
import type {Renderer} from "../rendering/renderer.js";
import type {HUD} from "../ui/hud.js";
import type {I18n} from "../services/i18n.js";
import type {Leaderboard} from "../ui/leaderboard.js";
import type {SoundManager} from "../services/sound-manager.js";
import type {Piece as PieceType} from "../game/piece.js";
import {Piece} from "../game/piece.js";
import type {GameSettings} from "../game/game-state.js";
import {KLOCKOMINOS, SCORING} from "../shared/config.js";
import {Board} from "../game/board.js";
import {WebGLBoardRenderer} from "../rendering/webgl-board-renderer.js";
import {BoardRenderer} from "../rendering/board-renderer.js";
import {PieceRenderer} from "../rendering/piece-renderer.js";
import {EffectRenderer} from "../rendering/effect-renderer.js";
import {BannerRenderer} from "../rendering/banner-renderer.js";
import {PieceBag} from "../game/piece-bag.js";
import {PieceController} from "./piece-controller.js";
import {ModeController} from "./mode-controller.js";
import {StatsTracker} from "./stats-tracker.js";
import {MusicDirector} from "../services/music-director.js";
import {VHS} from "../ui/themes/vhs.js";
import {Matrix} from "../ui/themes/matrix.js";
import {Rain} from "../ui/themes/rain.js";
import {Snow} from "../ui/themes/snow.js";
import {Volcano} from "../ui/themes/volcano.js";
import {pointsForHardDrop, pointsForLineClear} from "../game/scoring.js";
import {initializeGameDomainServices} from "../game/game-factory.js";
import {dropIntervalForLevel, nowMs, smoothedInterval, tierForLevel} from "../shared/utils.js";
import {getColumnHeights} from "../game/board-analysis.js";
import {GameEngine} from "../../../engine/simulation/game-engine.js";
import {
    FALL_TRAIL_MAX_LENGTH,
    fallTrailLengthForInterval,
    HARD_DROP_TRAIL_ALPHAS,
    HARD_DROP_TRAIL_DURATION_MS,
} from "../game/game-constants.js";

"use strict";

const CATEGORY_KEYS = [
    "pieceGeneration", "movement", "rotation",
    "dropOffset", "lockPiece", "lineClearDetect", "lineClearApply", "scoring",
    "renderWebGL", "renderBlit", "renderDrawPiece", "renderDrawGhost", "renderWebGLFlush",
    "renderFallTrail", "renderHardDropTrail", "renderClearingFrame",
    "boardShake", "themeEffectDraw", "musicDirectorUpdate",
    "audioPlay", "audioStop",
];

type Timing = { ms: number; ops: number };
type Timings = Record<string, Timing>;
type RenderedPiece = PieceType;
type BenchmarkSoundManager = {
    play: SoundManager["play"];
    playSequence: SoundManager["playSequence"];
    stop: SoundManager["stop"];
    stopCategory: SoundManager["stopCategory"];
    pause: SoundManager["pause"];
    resume: SoundManager["resume"];
    setPlaybackRate: SoundManager["setPlaybackRate"];
    fadeInstanceVolume: SoundManager["fadeInstanceVolume"];
    setInstanceVolume: SoundManager["setInstanceVolume"];
    setDetune: SoundManager["setDetune"];
    rampInstanceDetune: SoundManager["rampInstanceDetune"];
    getDuration: SoundManager["getDuration"];
};

function emptyTimings(): Timings {
    return Object.fromEntries(CATEGORY_KEYS.map((key) => [key, {ms: 0, ops: 0}]));
}

function pickTargetX(board: Board, piece: PieceType, {randomChance = 0.25}: { randomChance?: number } = {}): number {
    const {cols, rows, occupancy} = board;
    const maxX = cols - piece.width;
    if (maxX <= 0) return 0;
    if (Math.random() < randomChance) return Math.floor(Math.random() * (maxX + 1));

    const heights = getColumnHeights(occupancy, cols, rows);

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

class BenchmarkShadowGame {

    engine!: GameEngine<keyof typeof KLOCKOMINOS>;
    lastRowStepTime: 0;
    effectiveDropIntervalMs: number;
    lastColStepTime: 0;
    effectiveShiftIntervalMs: number;
    shiftAnim: { fromX: number; toX: number; elapsed: number; duration: number } | null;
    hardDropTrail: {
        entries: Array<{ x: number; y: number; mask: number; width: number; height: number; color: string }>;
        elapsed: number;
        duration: number
    } | null;
    fallTrail: Array<{
        x: number;
        y: number;
        alpha: number;
        mask: number | null;
        width: number;
        height: number;
        color: string | null
    }>;
    fallTrailHead: number;
    fallTrailCount: number;
    _trailPieceRef: PieceType | null;
    board!: Board;
    bag!: PieceBag;
    renderer!: Renderer;
    settings!: GameSettings;
    scoring!: typeof SCORING;
    difficulties!: Game["difficulties"];
    difficulty!: string;
    gameModes!: Game["gameModes"];
    mode!: string;
    i18n!: I18n;
    leaderboard!: Leaderboard;
    hud!: Pick<HUD, "update">;
    soundManager!: BenchmarkSoundManager;
    musicDirector!: MusicDirector;
    statsTracker!: StatsTracker;
    modeController!: ModeController;
    pieceController!: PieceController;
    screenFlow!: { gameOver: () => Promise<void> };
    steeringArbiter: unknown;
    pointerClientX: number | null;
    state!: string;
    lastAction: string | null;
    rotationAnim: unknown;
    hardDropUsed: boolean;
    dropCounter: number;
    lockDelayTimer: number;
    lockDelayResets: number;
    groundedTime: number;
    isGrounded: boolean;
    rawGrounded: boolean;
    groundedGraceTimer: number;
    groundedSoundRate: number;
    groundedSoundId: string | null;
    fallingSoundId: string | null;
    pendingSpin: string | null;
    clearingLines: number[];
    clearingFragments: Array<{ x: number; y: number; alpha: number }>;
    clearingDropRows: Uint8Array | number[];
    clearingTimer: number;
    currentCombo: number;
    maxCombo: number;
    level: number;
    levelTier: string | null;
    startLevel: number;
    dropInterval: number;
    transitionScore: number | null;
    levelUpBannerDuration: number;
    comboBannerDuration: number;
    beginHardDropImpactFlash!: () => void;
    beginLockImpactFlash!: () => void;

    constructor() {
        this.lastRowStepTime = 0;
        this.effectiveDropIntervalMs = Infinity;
        this.lastColStepTime = 0;
        this.effectiveShiftIntervalMs = Infinity;
        this.shiftAnim = null;
        this.hardDropTrail = null;

        this.fallTrail = Array.from({length: FALL_TRAIL_MAX_LENGTH}, () => ({
            x: 0, y: 0, mask: null, width: 0, height: 0, color: null,
        }));
        this.fallTrailHead = 0;
        this.fallTrailCount = 0;
        this._trailPieceRef = null;
    }

    get current(): PieceType | null {
        return this.engine?.state.current as PieceType | null ?? null;
    }

    set current(value: PieceType | null) {
        if (this.engine) {
            this.engine.state.current = value as any;
        }
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

        const count = Math.min(HARD_DROP_TRAIL_ALPHAS.length, Math.floor(cellsDropped) + 1);
        const step = count > 1 ? cellsDropped / (count - 1) : 0;

        const entries = [];
        for (let i = 0; i < count; i++) {
            const y = piece.y - i * step;
            entries.push({
                x: piece.x, y, mask: piece.mask,
                width: piece.width, height: piece.height, color: piece.color,
            });
        }

        this.hardDropTrail = {entries, elapsed: 0, duration: HARD_DROP_TRAIL_DURATION_MS};
    }

    updateFallTrail(renderedPiece) {
        const moveIntervalMs = Math.min(this.effectiveDropIntervalMs, this.effectiveShiftIntervalMs);
        const trailLength = fallTrailLengthForInterval(moveIntervalMs);

        if (trailLength === 0) {
            this.fallTrailCount = 0;
            return;
        }

        if (this._trailPieceRef !== this.current) {
            this._trailPieceRef = this.current;
            for (let i = 0; i < trailLength; i++) {
                const slot = this.fallTrail[i];
                slot.x = renderedPiece.x;
                slot.y = renderedPiece.y;
                slot.mask = renderedPiece.mask;
                slot.width = renderedPiece.width;
                slot.height = renderedPiece.height;
                slot.color = renderedPiece.color;
            }
            this.fallTrailHead = trailLength % FALL_TRAIL_MAX_LENGTH;
            this.fallTrailCount = trailLength;
            return;
        }

        const slot = this.fallTrail[this.fallTrailHead];
        slot.x = renderedPiece.x;
        slot.y = renderedPiece.y;
        slot.mask = renderedPiece.mask;
        slot.width = renderedPiece.width;
        slot.height = renderedPiece.height;
        slot.color = renderedPiece.color;

        this.fallTrailHead = (this.fallTrailHead + 1) % FALL_TRAIL_MAX_LENGTH;
        this.fallTrailCount = Math.min(trailLength, this.fallTrailCount + 1);
    }
}

export class BenchmarkController {

    game: Game;
    _offscreenRenderer: Renderer | null;
    _offscreenThemeEffects: { vhs: VHS; matrix: Matrix; rain: Rain; snow: Snow; volcano: Volcano; };

    constructor(game: Game) {
        this.game = game;
        this._offscreenRenderer = null;
    }

    _getOffscreenRenderer() {
        const game = this.game;
        const liveGame = game;
        const liveRenderer = game.renderer;
        const size = liveRenderer.boardConfig.CELL_SIZE;
        const width = game.board.cols * size;
        const height = game.board.rows * size;

        const boardCanvas = game.dom?.querySelector<HTMLCanvasElement>('[data-role="benchmark-preview-canvas"]')
            ?? this._offscreenRenderer?.boardCanvas
            ?? document.createElement("canvas");

        if (this._offscreenRenderer && this._offscreenRenderer.boardCanvas === boardCanvas) {
            if (boardCanvas.width !== width) boardCanvas.width = width;
            if (boardCanvas.height !== height) boardCanvas.height = height;
            const {webglCanvas} = this._offscreenRenderer;
            if (webglCanvas && (webglCanvas.width !== width || webglCanvas.height !== height)) {
                webglCanvas.width = width;
                webglCanvas.height = height;
                this._offscreenRenderer.webgl?.resize(width, height);
            }
            return this._offscreenRenderer;
        }

        boardCanvas.width = width;
        boardCanvas.height = height;
        const ctx = boardCanvas.getContext("2d");
        const webglCanvas = document.createElement("canvas");
        webglCanvas.width = width;
        webglCanvas.height = height;

        let webgl = null;
        try {
            if (webglCanvas.getContext("webgl2")) {
                webgl = new WebGLBoardRenderer(webglCanvas, {cols: game.board.cols, rows: game.board.rows});
            }
        } catch {
            webgl = null;
        }

        this._offscreenRenderer = Object.assign(
            Object.create(Object.getPrototypeOf(liveRenderer)),
            liveRenderer.createSurface(ctx, boardCanvas),
            {
                bodyEl: document.body,
                boardEl: document.createElement("div"),
                nextCtxs: [],
                nextCanvases: [],
                spriteCache: liveRenderer.spriteCache,
                nextSpriteCache: liveRenderer.nextSpriteCache,
                boardConfig: liveRenderer.boardConfig,
                klockominos: liveRenderer.klockominos,
                colorPalette: liveRenderer.colorPalette,
                nextPreviewCellSize: liveRenderer.nextPreviewCellSize,
                i18n: liveRenderer.i18n,
                webglCanvas,
                webgl,
            },
        );

        this._offscreenRenderer.boardRenderer = new BoardRenderer(this._offscreenRenderer);
        this._offscreenRenderer.pieceRenderer = new PieceRenderer(this._offscreenRenderer);
        this._offscreenRenderer.effectRenderer = new EffectRenderer(this._offscreenRenderer);
        this._offscreenRenderer.bannerRenderer = new BannerRenderer(this._offscreenRenderer);

        this._offscreenRenderer.setGlowEnabled?.(liveRenderer.glowEnabled);
        this._offscreenRenderer.setTransparencyEnabled?.(liveRenderer.transparencyEnabled);
        this._offscreenRenderer.setGhostType?.(liveRenderer.ghostType);
        this._offscreenRenderer.setGhostOpacities?.(liveRenderer.ghostOpacities);
        this._offscreenRenderer.setGridEnabled?.(liveRenderer.gridEnabled);
        this._offscreenRenderer.setShakeEnabled?.(liveRenderer.shakeEnabled);
        this._offscreenRenderer.setParticlesEnabled?.(liveRenderer.particlesEnabled);
        this._offscreenRenderer.setHeightSaturationEnabled?.(liveRenderer.heightSaturationEnabled);
        this._offscreenRenderer.setAsciiFallingPiecesEnabled?.(
            liveGame.settings.blockType === "ascii" || Boolean(liveGame.settings.asciiFallingPieces)
        );
        this._offscreenRenderer.setOutlineBlocksEnabled?.(
            liveGame.settings.blockType === "radioactive" || Boolean(liveGame.settings.outlineBlocks)
        );

        return this._offscreenRenderer;
    }

    ensurePreviewCanvasSized() {
        this._getOffscreenRenderer();
    }

    _getOffscreenThemeEffects(width: number, height: number): {
        vhs: VHS;
        matrix: Matrix;
        rain: Rain;
        snow: Snow;
        volcano: Volcano
    } {
        if (this._offscreenThemeEffects) {
            for (const instance of Object.values(this._offscreenThemeEffects)) instance.resize(width, height);
            return this._offscreenThemeEffects;
        }

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        this._offscreenThemeEffects = {
            vhs: new VHS(canvas, ctx),
            matrix: new Matrix(canvas, ctx),
            rain: new Rain(canvas, ctx),
            snow: new Snow(canvas, ctx),
            volcano: new Volcano(canvas, ctx),
        };
        for (const instance of Object.values(this._offscreenThemeEffects)) instance.resize(width, height);
        return this._offscreenThemeEffects;
    }

    _mutedSoundManager(): BenchmarkSoundManager {
        return {
            play: () => null,
            playSequence: () => null,
            stop: () => {
            },
            stopCategory: () => {
            },
            pause: () => false,
            resume: () => false,
            setPlaybackRate: () => {
            },
            fadeInstanceVolume: () => {
            },
            setInstanceVolume: () => {
            },
            setDetune: () => {
            },
            rampInstanceDetune: () => {
            },
            getDuration: (...args) => this.game.soundManager.getDuration(...args),
        };
    }

    async run({pieceCount = 10000, onProgress = null}: {
        pieceCount?: number;
        onProgress?: ((done: number, total: number) => void) | null
    } = {}): Promise<{
        results: Array<{ key: string; totalMs: number; avgMs: number; opsCount: number; percent: number }>;
        totalMs: number;
        pieceCount: number
    }> {
        const liveGame = this.game;
        const cols = liveGame.board.cols;
        const rows = liveGame.board.rows;

        const shadow = new BenchmarkShadowGame();
        shadow.board = new Board(cols, rows);
        shadow.bag = new PieceBag(liveGame.bag.types);
        shadow.engine = new GameEngine({
            board: shadow.board,
            bag: shadow.bag,
            definitions: KLOCKOMINOS,
            lockDelayMs: liveGame.scoring.LOCK_DELAY,
            maxLockDelayResets: liveGame.scoring.LOCK_DELAY_MAX_RESETS,
        });
        shadow.renderer = this._getOffscreenRenderer();
        shadow.renderer.setAsciiFallingPiecesEnabled?.(
            liveGame.settings.blockType === "ascii" || Boolean(liveGame.settings.asciiFallingPieces)
        );
        shadow.renderer.setOutlineBlocksEnabled?.(
            liveGame.settings.blockType === "radioactive" || Boolean(liveGame.settings.outlineBlocks)
        );
        shadow.renderer.setGhostType?.(liveGame.settings.ghostType ?? "white");
        shadow.renderer.setGhostOpacities?.(liveGame.settings.ghostOpacity);
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
        shadow.musicDirector = new MusicDirector(shadow.soundManager);
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
        shadow.rawGrounded = false;
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

        initializeGameDomainServices(shadow);
        shadow.maxCombo = 0;
        shadow.levelUpBannerDuration = liveGame.levelUpBannerDuration;
        shadow.comboBannerDuration = liveGame.comboBannerDuration;
        shadow.transitionScore = null;
        shadow.beginHardDropImpactFlash = () => {
        };
        shadow.beginLockImpactFlash = () => {
        };

        shadow.statsTracker = new StatsTracker(shadow);
        shadow.modeController = new ModeController(shadow);
        shadow.pieceController = new PieceController(shadow);

        const startNewRound = () => {
            shadow.board.reset();
            shadow.modeController.setupBoard();
            const startLevel = shadow.difficulties[shadow.difficulty].startLevel;
            shadow.startLevel = startLevel;
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

        shadow.musicDirector.stop(0);

        const measurementBag = new PieceBag(shadow.bag.types);

        const timings = emptyTimings();
        const mark = () => performance.now();

        const previewCanvas = liveGame.dom?.querySelector<HTMLElement>('[data-role="benchmark-preview-canvas"]');
        if (previewCanvas) previewCanvas.hidden = false;

        const yieldEvery = Math.max(5, Math.round(pieceCount / 100));

        try {
            onProgress?.(0, pieceCount);
            await new Promise((resolve) => requestAnimationFrame(resolve));
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

                    t0 = mark();
                    shadow.renderer.shakeMove(dir);
                    timings.boardShake.ms += mark() - t0;
                    timings.boardShake.ops++;

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

                if (shadow.hardDropTrail) {
                    shadow.renderer.drawHardDropTrail(shadow.hardDropTrail.entries, 0.5);
                    t0 = mark();
                    shadow.renderer.drawHardDropTrail(shadow.hardDropTrail.entries, 0.5);
                    timings.renderHardDropTrail.ms += mark() - t0;
                    timings.renderHardDropTrail.ops++;
                }

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
                    for (const progress of [0.25, 0.5, 0.75, 1]) {
                        shadow.renderer.drawClearingFrame(
                            shadow.board, shadow.clearingLines, shadow.clearingDropRows,
                            shadow.clearingFragments, progress
                        );
                    }
                    timings.renderClearingFrame.ms += mark() - t0;
                    timings.renderClearingFrame.ops++;

                    t0 = mark();
                    shadow.pieceController.finishLineClear();
                    timings.lineClearApply.ms += mark() - t0;
                    timings.lineClearApply.ops++;
                }

                const piece = shadow.current;
                const size = shadow.renderer.boardConfig.CELL_SIZE;

                t0 = mark();
                shadow.renderer.drawBoard(shadow.board);
                timings.renderWebGL.ms += mark() - t0;
                timings.renderWebGL.ops++;

                shadow.renderer.drawGhost(piece, shadow.board);
                t0 = mark();
                shadow.renderer.drawGhost(piece, shadow.board);
                timings.renderDrawGhost.ms += mark() - t0;
                timings.renderDrawGhost.ops++;

                t0 = mark();
                shadow.renderer.drawPiece(piece, shadow.board);
                timings.renderDrawPiece.ms += mark() - t0;
                timings.renderDrawPiece.ops++;

                t0 = mark();
                shadow.renderer.flushWebGL();
                timings.renderWebGLFlush.ms += mark() - t0;
                timings.renderWebGLFlush.ops++;

                if (shadow.renderer.webgl) shadow.renderer.ctx.drawImage(shadow.renderer.webglCanvas, 0, 0);

                if (shadow.settings.fallTrail) {
                    t0 = mark();
                    shadow.updateFallTrail(piece);
                    shadow.renderer.drawFallTrail(shadow.fallTrail, shadow.fallTrailHead, shadow.fallTrailCount);
                    timings.renderFallTrail.ms += mark() - t0;
                    timings.renderFallTrail.ops++;
                }

                const activeTheme = shadow.settings.theme;
                if (activeTheme && activeTheme !== "none") {
                    const themeEffects = this._getOffscreenThemeEffects(
                        shadow.renderer.boardCanvas.width, shadow.renderer.boardCanvas.height
                    );
                    const effect = themeEffects[activeTheme];
                    if (effect) {
                        t0 = mark();
                        effect.drawFrame();
                        timings.themeEffectDraw.ms += mark() - t0;
                        timings.themeEffectDraw.ops++;
                    }
                }

                t0 = mark();
                shadow.musicDirector.update(shadow.board, 16);
                timings.musicDirectorUpdate.ms += mark() - t0;
                timings.musicDirectorUpdate.ops++;

                t0 = mark();
                let playedId = null;
                try {
                    playedId = liveGame.soundManager.play("drop", {volume: 0});
                } catch {
                    // Audio engine unavailable.
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

                if (i % yieldEvery === yieldEvery - 1) {
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
