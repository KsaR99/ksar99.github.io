"use strict";

import {dropIntervalForLevel, tierForLevel} from "../shared/utils.js";
import {COUNTDOWN_STEPS} from "./game-constants.js";
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
        }
    }

    getRenderedPiece() {
        if (!this.rotationAnim) return this.current;

        const t = Math.min(1, this.rotationAnim.elapsed / this.rotationAnim.duration);
        const {fromX, fromY, toX, toY} = this.rotationAnim;

        const rendered = Object.create(Object.getPrototypeOf(this.current));
        Object.assign(rendered, this.current, {
            x: fromX + (toX - fromX) * t,
            y: fromY + (toY - fromY) * t,
        });

        return rendered;
    }

    render() {
        this.effectOverlay.update();
        this.renderer.drawBoard(this.board);

        const showPieceBehindOptions = this.state === "options"
            && ["running", "paused"].includes(this.previousStateBeforeOptions);

        if (this.state === "running" || this.state === "paused" || showPieceBehindOptions) {
            if (this.state === "running") this.renderer.drawGhost(this.current, this.board);
            this.renderer.drawPiece(this.getRenderedPiece());
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
