// @ts-nocheck
import type {Board} from "./board.js";
import {GameEngine} from "../../../engine/simulation/game-engine.js";
import {DIFFICULTIES, GAME_MODES, KLOCKOMINOS, LINE_CLEAR_SOUND_PLAYBACK_RATE, SCORING} from "../shared/config.js";
import type {PieceBag} from "./piece-bag.js";
import type {Renderer} from "../rendering/renderer.js";
import type {HUD} from "../ui/hud.js";
import type {SoundManager} from "../services/sound-manager.js";
import type {Leaderboard} from "../ui/leaderboard.js";
import {Screens} from "../ui/screens.js";
import type {I18n} from "../services/i18n.js";
import {nowMs, smoothedInterval} from "../shared/utils.js";
import {
    HARD_DROP_IMPACT_FLASH_DURATION_MS,
    HARD_DROP_TRAIL_ALPHAS,
    HARD_DROP_TRAIL_DURATION_MS,
    ZEN_SHIFT_ANIMATION_DURATION_MS
} from "./game-constants.js";
import {GAME_STATE_KEYS, GameState} from "./game-state.js";
import {InputController} from "../controllers/input-controller.js";
import {PieceController} from "../controllers/piece-controller.js";
import {StatsTracker} from "../controllers/stats-tracker.js";
import {type GameSettings, SettingsController} from "../controllers/settings-controller.js";
import {ThemeOverlay} from "../controllers/theme-overlay.js";
import {DifficultyController} from "../controllers/difficulty-controller.js";
import {ModeController} from "../controllers/mode-controller.js";
import {GameFlowController} from "../controllers/game-flow-controller.js";
import {CreditsController} from "../controllers/credits-controller.js";
import {MusicDirector} from "../services/music-director.js";
import {ShareService} from "../services/share-service.js";
import {ConfirmDialog} from "../services/confirm-dialog.js";
import {BenchmarkController} from "../controllers/benchmark-controller.js";
import {GameRuntime} from "./game-runtime.js";
import {initializeGameDomainServices} from "./game-factory.js";
import type {GameEventBus} from "./game-events.js";
import type {GameProgressionService} from "./game-progression-service.js";
import type {GameScoringService} from "./game-scoring-service.js";
import type {SteeringArbiter} from "../controllers/input/steering-arbiter.js";
import type {MultiplayerController} from "../controllers/multiplayer-controller.js";
import {createGameSnapshot, type GameSnapshot, restoreGameSnapshot} from "./game-snapshot.js";

"use strict";

function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Game {

    board: Board;
    bag: PieceBag;
    renderer: Renderer;
    hud: HUD;
    soundManager: SoundManager;
    leaderboard: Leaderboard;
    screens: typeof Screens;
    difficulties: typeof DIFFICULTIES;
    gameModes: typeof GAME_MODES;
    scoring: typeof SCORING;
    levelUpBannerDuration: number;
    comboBannerDuration: number;
    lineClearAnimationDuration: number;
    cascadeFallDuration: number;
    countdownStepDuration: number;
    settingsStore: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; };
    dom: Document | null;
    i18n: I18n;
    gameState: GameState;
    statsTracker: StatsTracker;
    pieceController: PieceController;
    settingsController: SettingsController;
    themeOverlay: ThemeOverlay;
    difficultyController: DifficultyController;
    modeController: ModeController;
    screenFlow: GameFlowController;
    inputController: InputController;
    creditsController: CreditsController;
    musicDirector: MusicDirector;
    shareService: ShareService;
    confirmDialog: ConfirmDialog;
    benchmarkController: BenchmarkController;
    steeringArbiter: SteeringArbiter | null;
    multiplayerController: MultiplayerController | null;
    readonly runtime: GameRuntime;
    readonly engine: GameEngine<keyof typeof KLOCKOMINOS>;
    readonly events!: GameEventBus;
    readonly progressionService!: GameProgressionService;
    readonly scoringService!: GameScoringService;
    settings: GameSettings;
    declare activeTheme: GameState["activeTheme"];
    declare previousStateBeforeOptions: GameState["previousStateBeforeOptions"];
    declare isPlayingSession: GameState["isPlayingSession"];
    declare multiplayerOptionsOverlayOpen: GameState["multiplayerOptionsOverlayOpen"];
    declare state: GameState["state"];
    declare menuSelector: GameState["menuSelector"];
    declare countdownIndex: GameState["countdownIndex"];
    declare countdownTimer: GameState["countdownTimer"];
    declare playerName: GameState["playerName"];
    declare currentIdleList: GameState["currentIdleList"];
    declare currentGameOverEntry: GameState["currentGameOverEntry"];
    declare pointerClientX: GameState["pointerClientX"];
    declare pointerClientY: GameState["pointerClientY"];
    declare difficulty: GameState["difficulty"];
    declare mode: GameState["mode"];
    declare modeState: GameState["modeState"];
    declare current: GameState["current"];
    declare nextQueue: GameState["nextQueue"];
    declare rotationAnim: GameState["rotationAnim"];
    declare shiftAnim: GameState["shiftAnim"];
    declare dropCounter: GameState["dropCounter"];
    declare dropInterval: GameState["dropInterval"];
    declare lockDelayTimer: GameState["lockDelayTimer"];
    declare lockDelayResets: GameState["lockDelayResets"];
    declare groundedTime: GameState["groundedTime"];
    declare hardDropUsed: GameState["hardDropUsed"];
    declare isGrounded: GameState["isGrounded"];
    declare rawGrounded: GameState["rawGrounded"];
    declare groundedSoundId: GameState["groundedSoundId"];
    declare groundedGraceTimer: GameState["groundedGraceTimer"];
    declare groundedSoundRate: GameState["groundedSoundRate"];
    declare fallingSoundId: GameState["fallingSoundId"];
    declare lastAction: GameState["lastAction"];
    declare pendingSpin: GameState["pendingSpin"];
    declare clearingLines: GameState["clearingLines"];
    declare clearingFragments: GameState["clearingFragments"];
    declare clearingDropRows: GameState["clearingDropRows"];
    declare clearingDropGrid: GameState["clearingDropGrid"];
    declare clearingTimer: GameState["clearingTimer"];
    declare fallTrail: GameState["fallTrail"];
    declare fallTrailHead: GameState["fallTrailHead"];
    declare fallTrailCount: GameState["fallTrailCount"];
    declare _trailPieceRef: GameState["_trailPieceRef"];
    declare hardDropTrail: GameState["hardDropTrail"];
    declare hardDropImpactFlash: GameState["hardDropImpactFlash"];
    declare lockImpactFlash: GameState["lockImpactFlash"];
    declare zenShiftAnim: GameState["zenShiftAnim"];
    declare lastRowStepTime: GameState["lastRowStepTime"];
    declare effectiveDropIntervalMs: GameState["effectiveDropIntervalMs"];
    declare lastColStepTime: GameState["lastColStepTime"];
    declare effectiveShiftIntervalMs: GameState["effectiveShiftIntervalMs"];
    declare startLevel: GameState["startLevel"];
    declare level: GameState["level"];
    declare levelTier: GameState["levelTier"];
    declare levelUpTimer: GameState["levelUpTimer"];
    declare levelUpLevel: GameState["levelUpLevel"];
    declare comboBannerTimer: GameState["comboBannerTimer"];
    declare comboBannerCombo: GameState["comboBannerCombo"];
    declare score: GameState["score"];
    declare lines: GameState["lines"];
    declare elapsedMs: GameState["elapsedMs"];
    declare idleMusicId: GameState["idleMusicId"];
    declare idleMusicWasPlayingBeforeOptions: GameState["idleMusicWasPlayingBeforeOptions"];
    declare drought: GameState["drought"];
    declare maxDrought: GameState["maxDrought"];
    declare droughtTotal: GameState["droughtTotal"];
    declare droughtCount: GameState["droughtCount"];
    declare burn: GameState["burn"];
    declare transitionScore: GameState["transitionScore"];
    declare clearCounts: GameState["clearCounts"];
    declare piecesSpawned: GameState["piecesSpawned"];
    declare spinCounts: GameState["spinCounts"];
    declare currentCombo: GameState["currentCombo"];
    declare maxCombo: GameState["maxCombo"];
    declare cascadeChain: GameState["cascadeChain"];
    declare cascadeFalling: GameState["cascadeFalling"];
    declare cascadeStepCleared: GameState["cascadeStepCleared"];
    declare _hudUpdateAcc: GameState["_hudUpdateAcc"];
    declare multiplayerConnected: boolean;
    declare multiplayerVsBot: boolean;
    hardcoreMaskTargetRow: number | null;
    hardcoreMaskDisplayRow: number | null;
    hardcoreMaskAnim: { fromRow: number; toRow: number; elapsed: number; duration: number } | null;

    constructor({
                    board,
                    bag,
                    renderer,
                    hud,
                    soundManager,
                    leaderboard,
                    screens,
                    difficulties,
                    defaultDifficulty,
                    gameModes,
                    defaultMode,
                    scoring,
                    levelUpBannerDuration,
                    comboBannerDuration,
                    lineClearAnimationDuration,
                    cascadeFallDuration = 180,
                    countdownStepDuration = 500,
                    settingsStore = null,
                    themeCanvas = null,
                    themeCtx = null,
                    dom = globalThis.document ?? null,
                    i18n,
                }: {
        board: Board;
        bag: PieceBag;
        renderer: Renderer;
        hud: HUD;
        soundManager: SoundManager;
        leaderboard: Leaderboard;
        screens: typeof Screens;
        difficulties: typeof DIFFICULTIES;
        defaultDifficulty: string;
        gameModes: typeof GAME_MODES;
        defaultMode: string;
        scoring: typeof SCORING;
        levelUpBannerDuration: number;
        comboBannerDuration?: number;
        lineClearAnimationDuration: number;
        cascadeFallDuration?: number;
        countdownStepDuration?: number;
        settingsStore?: {
            get(key: string): Promise<string | null>;
            set(key: string, value: string): Promise<void>
        } | null;
        themeCanvas?: HTMLCanvasElement | null;
        themeCtx?: CanvasRenderingContext2D | null;
        dom?: Document | null;
        i18n: I18n;
    }) {
        this.board = board;
        this.bag = bag;
        this.renderer = renderer;
        this.hud = hud;
        this.soundManager = soundManager;
        this.leaderboard = leaderboard;
        this.screens = screens;
        this.difficulties = difficulties;
        this.gameModes = gameModes;
        this.scoring = scoring;
        this.levelUpBannerDuration = levelUpBannerDuration;
        this.comboBannerDuration = comboBannerDuration ?? levelUpBannerDuration;
        this.lineClearAnimationDuration = lineClearAnimationDuration;
        this.cascadeFallDuration = cascadeFallDuration;
        this.countdownStepDuration = countdownStepDuration;
        this.settingsStore = settingsStore ?? leaderboard.store;
        this.dom = dom ?? globalThis.document ?? null;
        this.i18n = i18n;
        this.gameState = new GameState({defaultDifficulty, defaultMode});
        this.engine = new GameEngine({
            board,
            bag,
            definitions: KLOCKOMINOS,
            state: this.gameState as any,
            lockDelayMs: scoring.LOCK_DELAY,
            maxLockDelayResets: scoring.LOCK_DELAY_MAX_RESETS,
        });
        initializeGameDomainServices(this);
        (this as any).events = this.engine.events;
        for (const key of GAME_STATE_KEYS) {
            Object.defineProperty(this, key, {
                get() {
                    return this.gameState[key];
                },
                set(value) {
                    this.gameState[key] = value;
                },
                enumerable: true,
                configurable: true,
            });
        }

        Object.defineProperty(this, "state", {
            get: () => this.gameState.state,
            set: (value: GameState["state"]) => {
                this.gameState.state = value;
                const phaseMap: Record<string, GameState["phase"]> = {
                    countdown: "countdown",
                    running: "running",
                    clearing: "clearing",
                    paused: "paused",
                    gameOver: "gameOver",
                };
                this.engine.state.phase = phaseMap[value] ?? (value === "idle" ? "idle" : this.engine.state.phase);
            },
            enumerable: true,
            configurable: true,
        });

        this.dom?.addEventListener("visibilitychange", () => {
            if ((this.dom as Document).hidden) {
                if (this.multiplayerConnected) this.runtime.startBackgroundTicker();
            } else {
                this.runtime.stopBackgroundTicker();
            }
        });

        this.statsTracker = new StatsTracker(this);
        this.pieceController = new PieceController(this);
        this.settingsController = new SettingsController(this);
        this.themeOverlay = new ThemeOverlay(this, {canvas: themeCanvas ?? undefined, ctx: themeCtx ?? undefined});
        this.difficultyController = new DifficultyController(this);
        this.modeController = new ModeController(this);
        this.screenFlow = new GameFlowController(this);
        this.inputController = new InputController(this);
        this.creditsController = new CreditsController(this);
        this.musicDirector = new MusicDirector(this.soundManager);
        this.shareService = new ShareService(this);
        this.confirmDialog = new ConfirmDialog(this.dom);
        this.confirmDialog.bind();
        this.benchmarkController = new BenchmarkController(this);
        this.steeringArbiter = null;
        this.multiplayerController = null;
        this.runtime = new GameRuntime(this);

        this.settings = this.settingsController.defaultSettings();

        this.hardcoreMaskTargetRow = null;
        this.hardcoreMaskDisplayRow = null;
        this.hardcoreMaskAnim = null;
    }

    get stats() {
        return this.statsTracker.stats;
    }

    getMaxGroundedTime() {
        return (this.levelTier ? this.difficulties[this.levelTier]?.groundedTime : undefined) ?? this.scoring.MAX_GROUNDED_TIME;
    }

    getFallingSoundRate() {
        return (this.levelTier ? this.difficulties[this.levelTier]?.fallingSoundRate : undefined) ?? this.scoring.DEFAULT_FALLING_SOUND_RATE;
    }

    previewPlaybackRateFor(key: string): number {
        if (key === "falling") return this.getFallingSoundRate();
        if (key === "grounded") return this.pieceController.groundedSoundPlaybackRate();
        if (key.startsWith("lineClear")) return LINE_CLEAR_SOUND_PLAYBACK_RATE;
        return 1;
    }

    async init({onStep = null, onAudioProgress = null, minStepMs = 200}: {
        onStep?: ((name: "settings" | "sprites" | "audio" | "finalize") => void) | null;
        onAudioProgress?: ((loaded: number, total: number) => void) | null;
        minStepMs?: number
    } = {}): Promise<void> {
        const runStep = async (name: "settings" | "sprites" | "audio", work: () => void | Promise<void>): Promise<void> => {
            onStep?.(name);
            await nextPaint();
            const start = Date.now();
            await work();
            const elapsed = Date.now() - start;
            if (elapsed < minStepMs) await wait(minStepMs - elapsed);
        };

        await runStep("settings", () => this.settingsController.loadSettings());
        await runStep("audio", () => this.soundManager.initSfx(onAudioProgress));
        await runStep("sprites", () => this.renderer.warmSpriteCache());

        onStep?.("finalize");
        await nextPaint();
        this.prepareNewRound();
        void this.soundManager.initVoices().then(() => this.soundManager.initMusic());
        this.screenFlow.showIdleScreen().then();
        this.inputController.bindControls();
        this.inputController.bindTouchControls();
        this.inputController.bindMouseControls();
        this.creditsController.bind();
        requestAnimationFrame(this.runtime.loop.bind(this.runtime));
        if (minStepMs > 0) await wait(minStepMs / 2);
    }

    prepareNewRound() {
        const startLevel = this.difficulties[this.difficulty].startLevel;

        this.board.reset();
        this.modeController.setupBoard();

        this.hardcoreMaskTargetRow = null;
        this.hardcoreMaskDisplayRow = null;
        this.hardcoreMaskAnim = null;

        this.progressionService.reset(startLevel);

        this.scoringService.reset();
        this.events.emit({type: "roundReset", startLevel});
        this.pieceController.reset();
        this.modeController.reset();

        this.hud.update(this.stats);
    }

    resetFallTrail() {
        this.fallTrailCount = 0;
        this.fallTrailHead = 0;
        this._trailPieceRef = null;
        this.lastRowStepTime = 0;
        this.lastColStepTime = 0;
        this.effectiveDropIntervalMs = this.dropInterval || Infinity;
        this.effectiveShiftIntervalMs = Infinity;
    }

    beginHardDropTrail(piece: import("./piece.js").Piece, cellsDropped: number): void {
        if (!this.settings.fallTrail || cellsDropped <= 0) {
            this.hardDropTrail = null;
            return;
        }

        const count = Math.min(HARD_DROP_TRAIL_ALPHAS.length, Math.floor(cellsDropped) + 1);
        const step = count > 1 ? cellsDropped / (count - 1) : 0;

        const entries = [];
        for (let i = 1; i < count; i++) {
            const y = piece.y - i * step;
            entries.push({
                x: piece.x,
                y,
                mask: piece.mask,
                width: piece.width,
                height: piece.height,
                color: piece.color,
            });
        }

        this.hardDropTrail = entries.length > 0
            ? {entries, elapsed: 0, duration: HARD_DROP_TRAIL_DURATION_MS}
            : null;
    }

    beginHardDropImpactFlash(piece: import("./piece.js").Piece | null): void {
        if (!this.settings.hardDropFlash || !piece?.mask) {
            this.hardDropImpactFlash = null;
            return;
        }

        this.hardDropImpactFlash = {
            entry: {
                x: piece.x,
                y: piece.y,
                mask: piece.mask,
                width: piece.width,
                height: piece.height,
            },
            elapsed: 0,
            duration: HARD_DROP_IMPACT_FLASH_DURATION_MS,
        };
    }

    beginLockImpactFlash(piece: import("./piece.js").Piece | null): void {
        if (!this.settings.hardDropFlash || !piece?.mask) {
            this.lockImpactFlash = null;
            return;
        }

        this.lockImpactFlash = {
            entry: {
                x: piece.x,
                y: piece.y,
                mask: piece.mask,
                width: piece.width,
                height: piece.height,
            },
            elapsed: 0,
            duration: HARD_DROP_IMPACT_FLASH_DURATION_MS,
        };
    }

    startZenShiftAnimation(rowDelta: number): void {
        if (!rowDelta) return;
        this.zenShiftAnim = {rowDelta, elapsed: 0, duration: ZEN_SHIFT_ANIMATION_DURATION_MS};
    }

    noteRowStep() {
        ({lastTime: this.lastRowStepTime, effectiveMs: this.effectiveDropIntervalMs} =
            smoothedInterval(this.lastRowStepTime, this.effectiveDropIntervalMs, nowMs()));
    }

    noteColStep() {
        ({lastTime: this.lastColStepTime, effectiveMs: this.effectiveShiftIntervalMs} =
            smoothedInterval(this.lastColStepTime, this.effectiveShiftIntervalMs, nowMs()));
    }

    _forceCursorRepaint() {
        if (!globalThis.window || this.pointerClientX == null || this.pointerClientY == null) return;
        const target = this.dom?.body ?? globalThis.document?.body;
        if (!target) return;

        target.dispatchEvent(new MouseEvent("mousemove", {
            clientX: this.pointerClientX,
            clientY: this.pointerClientY,
            bubbles: true,
            cancelable: true,
        }));
    }

    getShiftDisplayX(): number {
        if (!this.shiftAnim) return this.current?.x ?? 0;
        const animation = this.shiftAnim as { fromX: number; toX: number; elapsed: number; duration: number };
        const t = Math.min(1, animation.elapsed / animation.duration);
        return animation.fromX + (animation.toX - animation.fromX) * t;
    }


    createSnapshot(): GameSnapshot {
        return createGameSnapshot(this);
    }

    restoreSnapshot(snapshot: GameSnapshot): void {
        restoreGameSnapshot(this, snapshot);
        this.hud.update(this.stats);
        this.render();
    }

    render() {
        this.runtime.render();
    }


}
