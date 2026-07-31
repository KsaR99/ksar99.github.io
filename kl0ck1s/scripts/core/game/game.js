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
        this.shiftAnim = null;
        this.dropCounter = 0;
        this.dropInterval = 0;
        this.lockDelayTimer = 0;
        this.lockDelayResets = 0;
        this.groundedTime = 0;
        this.hardDropUsed = false;
        this.isGrounded = false;
        this.groundedSoundId = null;
        this.groundedGraceTimer = 0;
        this.groundedSoundRate = 1;
        this.lastAction = null;
        this.pendingSpin = null;
        this.clearingLines = [];
        this.clearingTimer = 0;

        // Fall-trail ("echo") state: a fixed-size ring buffer of preallocated
        // snapshot slots, reused every frame - no per-frame allocations.
        // Stores the piece's shape/color/x/y at each moment, so the trail can
        // smooth both vertical falls and horizontal moves (DAS, soft-drop
        // while shifting, etc.) instead of only reading x from the current
        // piece when drawing.
        this.fallTrail = Array.from({length: FALL_TRAIL_MAX_LENGTH}, () => ({
            x: 0, y: 0, mask: null, width: 0, height: 0, color: null,
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

        // Same idea as lastRowStepTime/effectiveDropIntervalMs above, but for
        // horizontal moves (tap-move or DAS auto-repeat), so the trail can
        // also echo fast side-to-side movement even while the piece isn't
        // currently falling quickly. See noteColStep().
        this.lastColStepTime = 0;
        this.effectiveShiftIntervalMs = Infinity;

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

    /**
     * Max time (ms) the current difficulty tier allows a piece to sit resting
     * before it's force-locked, regardless of further lock-delay resets from
     * moves/rotations. Falls back to the scoring-wide default for tiers that
     * don't override it (e.g. easy). Shared by update()'s lock check and the
     * "grounded" sound's playback-rate scaling, so both always agree on the
     * same window for the current tier.
     */
    getMaxGroundedTime() {
        return this.difficulties[this.levelTier]?.groundedTime ?? this.scoring.MAX_GROUNDED_TIME;
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
        this.lastColStepTime = 0;
        this.effectiveShiftIntervalMs = Infinity;
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

    /**
     * Call whenever the current piece moves left/right by one column - from
     * a single tap-move or a DAS auto-repeat tick. Mirrors noteRowStep():
     * tracks the real elapsed time between successive horizontal steps as
     * `effectiveShiftIntervalMs`, so fast side-to-side movement can size the
     * fall trail the same way fast falling does (see updateFallTrail()).
     */
    noteColStep() {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();

        if (this.lastColStepTime > 0) {
            const interval = now - this.lastColStepTime;
            this.effectiveShiftIntervalMs = this.effectiveShiftIntervalMs === Infinity
                ? interval
                : this.effectiveShiftIntervalMs * 0.7 + interval * 0.3;
        }

        this.lastColStepTime = now;
    }

    /**
     * Returns the piece's current *visual* x - mid-tween if a shiftAnim is
     * already in progress, otherwise its logical x. Used as the `fromX` when
     * starting a new shift tween, so a horizontal move that lands mid-way
     * through the previous tween (e.g. fast DAS auto-repeat) continues
     * smoothly from where it visually is instead of snapping backward.
     */
    getShiftDisplayX() {
        if (!this.shiftAnim) return this.current.x;
        const t = Math.min(1, this.shiftAnim.elapsed / this.shiftAnim.duration);
        const {fromX, toX} = this.shiftAnim;
        return fromX + (toX - fromX) * t;
    }

    update(delta) {
        if (this.rotationAnim) {
            this.rotationAnim.elapsed += delta;
            if (this.rotationAnim.elapsed >= this.rotationAnim.duration) {
                this.rotationAnim = null;
            }
        }

        if (this.shiftAnim) {
            this.shiftAnim.elapsed += delta;
            if (this.shiftAnim.elapsed >= this.shiftAnim.duration) {
                this.shiftAnim = null;
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
        this.pieceController.updateGrounded(resting, delta);

        // Deliberately reading this.isGrounded here rather than the raw
        // `resting` we just computed: updateGrounded() debounces single-frame
        // collision flicker (a rotation's new footprint/kick briefly not
        // touching anything below) through GROUNDED_GRACE_MS, so isGrounded
        // only flips once that's genuinely persisted. Using raw `resting`
        // here would let repeated rotation flicker silently reset
        // lockDelayTimer every such frame - bypassing LOCK_DELAY_MAX_RESETS
        // entirely - and pause groundedTime's accumulation, letting a piece
        // sit far longer than maxGroundedTime in real elapsed time.
        if (this.isGrounded) {
            this.lockDelayTimer += delta;
            this.groundedTime += delta;
            const maxGroundedTime = this.getMaxGroundedTime();
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
     * `this.current` - during a rotation animation (existing tween), during
     * a horizontal shift animation (shiftAnim, started by PieceController on
     * every successful move so x eases over a few frames instead of jumping
     * a whole column instantly - this is also what gives the fall trail
     * enough distinct in-between x values to actually spread out visually),
     * and while falling (fractional y based on how far we are into the
     * current drop step). The latter is what keeps falling pieces looking
     * smooth at high levels, where dropInterval gets short enough that whole-
     * cell steps would otherwise read as stutter.
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
        } else {
            if (this.shiftAnim) {
                const t = Math.min(1, this.shiftAnim.elapsed / this.shiftAnim.duration);
                const {fromX, toX} = this.shiftAnim;
                x = fromX + (toX - fromX) * t;
            }
            if (this.state === "running" && this.dropInterval > 0 && !this.board.collides(base, 0, 1)) {
                y = base.y + Math.min(1, this.dropCounter / this.dropInterval);
            }
        }

        if (x === base.x && y === base.y) return base;

        const rendered = Object.create(Object.getPrototypeOf(base));
        Object.assign(rendered, base, {x, y});
        return rendered;
    }

    /**
     * Pushes the current frame's position (both x and y) into the fall-trail
     * ring buffer, sized per the current *measured* movement speed - whether
     * that's falling (effectiveDropIntervalMs) or shifting left/right
     * (effectiveShiftIntervalMs), see noteRowStep()/noteColStep(). Whichever
     * axis is currently moving faster (smaller interval) wins, so a piece
     * that's DAS-ing across the board without falling still gets a trail,
     * same as one falling fast without moving sideways. Storing x per-snapshot
     * (rather than reading it live from the current piece at draw time) lets
     * the trail echo horizontal movement, not just falling.
     * Reuses preallocated slot objects - no allocation on the hot path.
     */
    updateFallTrail(renderedPiece) {
        const moveIntervalMs = Math.min(this.effectiveDropIntervalMs, this.effectiveShiftIntervalMs);
        const trailLength = fallTrailLengthForInterval(moveIntervalMs);

        if (trailLength === 0) {
            this.fallTrailCount = 0;
            return;
        }

        if (this._trailPieceRef !== this.current) {
            this.fallTrailCount = 0;
            this._trailPieceRef = this.current;
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

    render() {
        this.effectOverlay.update();
        this.renderer.drawBoard(this.board);

        const showPieceBehindOptions = this.state === "options"
            && ["running", "paused"].includes(this.previousStateBeforeOptions);

        if (this.state === "running" || this.state === "paused" || showPieceBehindOptions) {
            const renderedPiece = this.getRenderedPiece();

            if (this.state === "running") {
                this.renderer.drawGhost(this.current, this.board);
                if (this.settings.fallTrail) {
                    this.updateFallTrail(renderedPiece);
                    this.renderer.drawFallTrail(this.fallTrail, this.fallTrailHead, this.fallTrailCount);
                } else {
                    this.fallTrailCount = 0;
                }
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
