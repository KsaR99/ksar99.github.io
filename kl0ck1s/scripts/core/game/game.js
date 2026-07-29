"use strict";

import {dropIntervalForLevel, tierForLevel} from "../shared/utils.js";
import {COUNTDOWN_STEPS, FALL_TRAIL_MAX_LENGTH, fallTrailLengthForInterval} from "./game-constants.js";
import {InputController} from "../controllers/input-controller.js";
import {PieceController} from "../controllers/piece-controller.js";
import {StatsTracker} from "../controllers/stats-tracker.js";
import {SettingsController} from "../controllers/settings-controller.js";
import {EffectOverlay} from "../controllers/effect-overlay.js";
import {DifficultyController} from "../controllers/difficulty-controller.js";
import {ScreenFlow} from "../controllers/screen-flow.js";

/**
 * Central game state + the update/render loop. Gameplay, controls, screens,
 * settings, effects, difficulty and stats each live in their own controller
 * (see the imports above); Game wires them together and owns the fields they
 * share (state, board, current piece, ...). Add new controllers the same way
 * to extend the game without growing this file.
 */
export class Game {
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
                    boardBackgrounds,
                    scoring,
                    levelUpBannerDuration,
                    lineClearAnimationDuration,
                    countdownStepDuration = 500,
                    settingsStore = null,
                    effectCanvas = null,
                    effectCtx = null,
                    dom = globalThis.document ?? null,
                    i18n,
                }) {
        this.board = board;
        this.bag = bag;
        this.renderer = renderer;
        this.hud = hud;
        this.soundManager = soundManager;
        this.leaderboard = leaderboard;
        this.screens = screens;
        this.difficulties = difficulties;
        this.difficulty = defaultDifficulty;
        this.boardBackgrounds = boardBackgrounds;
        this.scoring = scoring;
        this.levelUpBannerDuration = levelUpBannerDuration;
        this.lineClearAnimationDuration = lineClearAnimationDuration;
        this.countdownStepDuration = countdownStepDuration;
        this.settingsStore = settingsStore ?? leaderboard.store;
        this.dom = dom;
        this.i18n = i18n;
        this.lastTime = 0;
        this.activeEffect = "none";
        this.previousStateBeforeOptions = null;
        this.isPlayingSession = false;

        // Screen/flow state (owned/mutated by ScreenFlow, read here in update()/render()).
        this.state = "idle";
        this.countdownIndex = 0;
        this.countdownTimer = 0;
        this.playerName = "";
        this.currentIdleList = null;
        this.currentGameOverEntry = null;
        this.currentGameOverSaved = null;
        this.pointerClientX = null;

        // Current piece / round state (owned/mutated by PieceController).
        this.current = null;
        this.next = null;
        this.rotationAnim = null;
        this.dropCounter = 0;
        this.dropInterval = 0;
        this.lockDelayTimer = 0;
        this.lockDelayResets = 0;
        this.groundedTime = 0;
        this.hardDropUsed = false;
        this.lastAction = null;
        this.pendingSpin = null;
        this.clearingLines = [];
        this.clearingTimer = 0;

        // Fall-trail ("echo") state: a fixed-size ring buffer of preallocated
        // snapshot slots, reused every frame - no per-frame allocations.
        // Purely a vertical smoothing effect (see game-constants.js), so each
        // slot only needs the piece's shape/color/y at that moment; x is
        // always read from the current piece when drawing.
        this.fallTrail = Array.from({length: FALL_TRAIL_MAX_LENGTH}, () => ({
            y: 0, mask: null, width: 0, height: 0, color: null,
        }));
        this.fallTrailHead = 0;
        this.fallTrailCount = 0;
        this._trailPieceRef = null;

        // Real-world measured time between successive one-row drops, used
        // (instead of dropInterval) to size the fall trail. dropInterval only
        // reflects gravity from the current level - softDrop() moves the
        // piece down a row directly without touching dropInterval, so a
        // held-down soft drop at level 1 would otherwise never trigger a
        // trail even though the piece is visibly moving just as fast as a
        // high-level gravity drop. Measuring actual elapsed time between row
        // steps (see noteRowStep()) catches both cases the same way.
        this.lastRowStepTime = 0;
        this.effectiveDropIntervalMs = Infinity;

        // Level/stats state (owned/mutated by StatsTracker).
        this.startLevel = 0;
        this.level = 0;
        this.levelTier = null;
        this.levelUpTimer = 0;
        this.levelUpLevel = null;
        this.score = 0;
        this.lines = 0;
        this.elapsedMs = 0;
        this.drought = 0;
        this.maxDrought = 0;
        this.droughtTotal = 0;
        this.droughtCount = 0;
        this.burn = 0;
        this.transitionScore = null;
        this.clearCounts = {1: 0, 2: 0, 3: 0, 4: 0};
        this.piecesSpawned = 0;
        this.spinCounts = {t: 0, tMini: 0, other: 0};
        this.currentCombo = 0;
        this.maxCombo = 0;

        this.statsTracker = new StatsTracker(this);
        this.pieceController = new PieceController(this);
        this.settingsController = new SettingsController(this);
        this.effectOverlay = new EffectOverlay(this, {canvas: effectCanvas, ctx: effectCtx});
        this.difficultyController = new DifficultyController(this);
        this.screenFlow = new ScreenFlow(this);
        this.inputController = new InputController(this);

        this.settings = this.settingsController.defaultSettings();
    }

    /** Aggregated stats consumed by the HUD; see StatsTracker for the fields. */
    get stats() {
        return this.statsTracker.stats;
    }

    async init() {
        this.soundManager.init();
        await this.settingsController.loadSettings();
        this.difficultyController.applyDifficultyTheme();
        this.prepareNewRound();
        this.screenFlow.showIdleScreen().then();
        this.inputController.bindControls();
        this.inputController.bindTouchControls();
        this.inputController.bindControlsToggle();
        this.inputController.bindMouseControls();
        requestAnimationFrame(this.loop.bind(this));
    }

    prepareNewRound() {
        const startLevel = this.difficulties[this.difficulty].startLevel;

        this.board.reset();
        this.startLevel = startLevel;
        this.level = startLevel;
        this.levelTier = tierForLevel(this.level, this.difficulties);
        this.dropInterval = dropIntervalForLevel(startLevel, this.scoring);

        this.statsTracker.reset();
        this.pieceController.reset();

        this.difficultyController.applyLevelTheme();
        this.hud.update(this.stats);
    }

    /** Clears the fall-trail ring buffer and speed measurement, e.g. on spawn/lock/round reset so old echoes/timing don't leak into the next piece. */
    resetFallTrail() {
        this.fallTrailCount = 0;
        this.fallTrailHead = 0;
        this._trailPieceRef = null;
        this.lastRowStepTime = 0;
        this.effectiveDropIntervalMs = Infinity;
    }

    /**
     * Call whenever the current piece moves down exactly one row - from
     * automatic gravity (update()) or from a manual soft drop
     * (PieceController.softDrop()). Tracks the real elapsed time between
     * successive calls (smoothed a little to avoid single-sample jitter) as
     * `effectiveDropIntervalMs`, which is what actually drives the fall
     * trail's length - see fallTrailLengthForInterval in game-constants.js.
     */
    noteRowStep() {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();

        if (this.lastRowStepTime > 0) {
            const interval = now - this.lastRowStepTime;
            this.effectiveDropIntervalMs = this.effectiveDropIntervalMs === Infinity
                ? interval
                : this.effectiveDropIntervalMs * 0.7 + interval * 0.3;
        }

        this.lastRowStepTime = now;
    }

    update(delta) {
        if (this.rotationAnim) {
            this.rotationAnim.elapsed += delta;
            if (this.rotationAnim.elapsed >= this.rotationAnim.duration) {
                this.rotationAnim = null;
            }
        }

        if (this.levelUpTimer > 0) {
            this.levelUpTimer = Math.max(0, this.levelUpTimer - delta);
        }

        if (this.state === "running" || this.state === "clearing") {
            this.elapsedMs += delta;
            this.hud.update(this.stats);
        }

        if (this.state === "countdown") {
            this.countdownTimer += delta;
            if (this.countdownTimer >= this.countdownStepDuration) {
                this.countdownTimer = 0;
                ++this.countdownIndex;
                if (this.countdownIndex >= COUNTDOWN_STEPS.length) {
                    this.screenFlow.start();
                } else {
                    this.screenFlow.advanceCountdownStep();
                }
            }
            return;
        }

        if (this.state === "clearing") {
            this.clearingTimer += delta;
            if (this.clearingTimer >= this.lineClearAnimationDuration) {
                this.pieceController.finishLineClear();
            }
            return;
        }

        if (this.state !== "running") return;

        const resting = this.board.collides(this.current, 0, 1);

        if (resting) {
            this.lockDelayTimer += delta;
            this.groundedTime += delta;
            const maxGroundedTime = this.difficulties[this.levelTier]?.groundedTime ?? this.scoring.MAX_GROUNDED_TIME;
            if (this.lockDelayTimer >= this.scoring.LOCK_DELAY || this.groundedTime >= maxGroundedTime) {
                this.pieceController.lockCurrentPiece();
            }
            return;
        }

        this.lockDelayTimer = 0;
        this.dropCounter += delta;
        if (this.dropCounter > this.dropInterval) {
            ++this.current.y;
            this.dropCounter = 0;
            this.noteRowStep();
        }
    }

    /**
     * Returns the piece as it should be drawn this frame. This is where the
     * *visual* position can differ from the logical grid position in
     * `this.current` - during a rotation animation (existing tween), and
     * while falling (fractional y based on how far we are into the current
     * drop step). The latter is what keeps falling pieces looking smooth at
     * high levels, where dropInterval gets short enough that whole-cell
     * steps would otherwise read as stutter.
     */
    getRenderedPiece() {
        const base = this.current;
        if (!base) return base;

        let x = base.x;
        let y = base.y;

        if (this.rotationAnim) {
            const t = Math.min(1, this.rotationAnim.elapsed / this.rotationAnim.duration);
            const {fromX, fromY, toX, toY} = this.rotationAnim;
            x = fromX + (toX - fromX) * t;
            y = fromY + (toY - fromY) * t;
        } else if (this.state === "running" && this.dropInterval > 0 && !this.board.collides(base, 0, 1)) {
            y = base.y + Math.min(1, this.dropCounter / this.dropInterval);
        }

        if (x === base.x && y === base.y) return base;

        const rendered = Object.create(Object.getPrototypeOf(base));
        Object.assign(rendered, base, {x, y});
        return rendered;
    }

    /**
     * Pushes the current frame's falling position into the fall-trail ring
     * buffer, sized per the current *measured* fall speed (see
     * effectiveDropIntervalMs / fallTrailLengthForInterval) - so soft-drop at
     * level 1 gets the same trail as reaching that same speed naturally at a
     * high level.
     * Reuses preallocated slot objects - no allocation on the hot path.
     */
    updateFallTrail(renderedPiece) {
        const trailLength = fallTrailLengthForInterval(this.effectiveDropIntervalMs);

        if (trailLength === 0) {
            this.fallTrailCount = 0;
            return;
        }

        if (this._trailPieceRef !== this.current) {
            this.fallTrailCount = 0;
            this._trailPieceRef = this.current;
        }

        const slot = this.fallTrail[this.fallTrailHead];
        slot.y = renderedPiece.y;
        slot.mask = renderedPiece.mask;
        slot.width = renderedPiece.width;
        slot.height = renderedPiece.height;
        slot.color = renderedPiece.color;

        this.fallTrailHead = (this.fallTrailHead + 1) % FALL_TRAIL_MAX_LENGTH;
        this.fallTrailCount = Math.min(trailLength, this.fallTrailCount + 1);
    }

    render() {
        this.effectOverlay.update();
        this.renderer.drawBoard(this.board);

        const showPieceBehindOptions = this.state === "options"
            && ["running", "paused"].includes(this.previousStateBeforeOptions);

        if (this.state === "running" || this.state === "paused" || showPieceBehindOptions) {
            const renderedPiece = this.getRenderedPiece();

            if (this.state === "running") {
                this.renderer.drawGhost(this.current, this.board);
                this.updateFallTrail(renderedPiece);
                this.renderer.drawFallTrail(this.fallTrail, this.fallTrailHead, this.fallTrailCount, this.current.x);
            } else {
                this.fallTrailCount = 0;
            }

            this.renderer.drawPiece(renderedPiece);
        } else if (this.state === "clearing") {
            const progress = Math.min(1, this.clearingTimer / this.lineClearAnimationDuration);
            this.renderer.drawClearingLines(this.clearingLines, progress);
        }

        if (this.levelUpTimer > 0) {
            this.renderer.drawLevelUpBanner(this.levelUpLevel);
        }
    }

    loop(time = 0) {
        const delta = Math.min(time - this.lastTime, 100);
        this.lastTime = time;

        this.update(delta);
        this.render();

        requestAnimationFrame(this.loop.bind(this));
    }
}
