"use strict";

import {dropIntervalForLevel, nowMs, smoothedInterval, tierForLevel} from "../shared/utils.js";
import {LINE_CLEAR_SOUND_PLAYBACK_RATE} from "../shared/config.js";
import {
    COUNTDOWN_STEPS,
    FALL_TRAIL_FRAME_MS,
    FALL_TRAIL_MAX_LENGTH,
    fallTrailLengthForInterval,
    HARD_DROP_TRAIL_ALPHAS,
    HARD_DROP_TRAIL_DURATION_MS,
    HUD_UPDATE_INTERVAL_MS
} from "./game-constants.js";
import {InputController} from "../controllers/input-controller.js";
import {PieceController} from "../controllers/piece-controller.js";
import {StatsTracker} from "../controllers/stats-tracker.js";
import {SettingsController} from "../controllers/settings-controller.js";
import {ThemeOverlay} from "../controllers/theme-overlay.js";
import {DifficultyController} from "../controllers/difficulty-controller.js";
import {ModeController} from "../controllers/mode-controller.js";
import {ScreenFlow} from "../controllers/screen-flow.js";
import {CreditsController} from "../controllers/credits-controller.js";
import {SensitivityCalibrationController} from "../controllers/sensitivity-calibration-controller.js";
import {KeyboardCalibrationController} from "../controllers/keyboard-calibration-controller.js";
import {MusicDirector} from "../services/music-director.js";
import {ShareService} from "../services/share-service.js";
import {ConfirmDialog} from "../services/confirm-dialog.js";
import {BenchmarkController} from "../controllers/benchmark-controller.js";

function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

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
                    gameModes,
                    defaultMode,
                    scoring,
                    levelUpBannerDuration,
                    lineClearAnimationDuration,
                    countdownStepDuration = 500,
                    settingsStore = null,
                    themeCanvas = null,
                    themeCtx = null,
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
        this.gameModes = gameModes;
        this.mode = defaultMode;
        this.modeState = {garbageTimer: 0};
        this.scoring = scoring;
        this.levelUpBannerDuration = levelUpBannerDuration;
        this.lineClearAnimationDuration = lineClearAnimationDuration;
        this.countdownStepDuration = countdownStepDuration;
        this.settingsStore = settingsStore ?? leaderboard.store;
        this.dom = dom;
        this.i18n = i18n;
        this.lastTime = 0;
        this._backgroundTicker = null;
        this.activeTheme = "none";
        this.previousStateBeforeOptions = null;
        this.isPlayingSession = false;
        this.multiplayerOptionsOverlayOpen = false;

        this.dom?.addEventListener("visibilitychange", () => {
            if (this.dom.hidden) {
                if (this.multiplayerConnected) this._startBackgroundTicker();
            } else {
                this._stopBackgroundTicker();
            }
        });

        this.state = "idle";
        this.menuSelector = "mode";
        this.countdownIndex = 0;
        this.countdownTimer = 0;
        this.playerName = "";
        this.currentIdleList = null;
        this.currentGameOverEntry = null;
        this.currentGameOverSaved = null;
        this.pointerClientX = null;
        this.pointerClientY = null;

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
        this.rawGrounded = false;
        this.groundedSoundId = null;
        this.groundedGraceTimer = 0;
        this.groundedSoundRate = 1;
        this.fallingSoundId = null;
        this.lastAction = null;
        this.pendingSpin = null;
        this.clearingLines = [];
        this.clearingFragments = [];
        this.clearingDropRows = [];
        this.clearingTimer = 0;

        this.fallTrail = Array.from({length: FALL_TRAIL_MAX_LENGTH}, () => ({
            x: 0, y: 0, mask: null, width: 0, height: 0, color: null,
        }));
        this.fallTrailHead = 0;
        this.fallTrailCount = 0;
        this._trailPieceRef = null;
        this.hardDropTrail = null;

        this.lastRowStepTime = 0;
        this.effectiveDropIntervalMs = Infinity;

        this.lastColStepTime = 0;
        this.effectiveShiftIntervalMs = Infinity;

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
        this.themeOverlay = new ThemeOverlay(this, {canvas: themeCanvas, ctx: themeCtx});
        this.difficultyController = new DifficultyController(this);
        this.modeController = new ModeController(this);
        this.screenFlow = new ScreenFlow(this);
        this.inputController = new InputController(this);
        this.creditsController = new CreditsController(this);
        this.sensitivityCalibrationController = new SensitivityCalibrationController(this);
        this.keyboardCalibrationController = new KeyboardCalibrationController(this);
        this.musicDirector = new MusicDirector(this.soundManager);
        this.shareService = new ShareService(this);
        this.confirmDialog = new ConfirmDialog(this.dom);
        this.confirmDialog.bind();
        this.benchmarkController = new BenchmarkController(this);

        this.settings = this.settingsController.defaultSettings();
    }

    get stats() {
        return this.statsTracker.stats;
    }

    getMaxGroundedTime() {
        return this.difficulties[this.levelTier]?.groundedTime ?? this.scoring.MAX_GROUNDED_TIME;
    }

    getFallingSoundRate() {
        return this.difficulties[this.levelTier]?.fallingSoundRate ?? this.scoring.DEFAULT_FALLING_SOUND_RATE;
    }

    previewPlaybackRateFor(key) {
        if (key === "falling") return this.getFallingSoundRate();
        if (key === "grounded") return this.pieceController.groundedSoundPlaybackRate();
        if (key.startsWith("lineClear")) return LINE_CLEAR_SOUND_PLAYBACK_RATE;
        return 1;
    }

    async init({onStep = null, onAudioProgress = null, minStepMs = 200} = {}) {
        const runStep = async (name, work) => {
            onStep?.(name);
            await nextPaint();
            const start = Date.now();
            const result = await work();
            const elapsed = Date.now() - start;
            if (elapsed < minStepMs) await wait(minStepMs - elapsed);
            return result;
        };

        await runStep("settings", () => this.settingsController.loadSettings());
        await runStep("sprites", () => this.renderer.warmSpriteCache());
        await runStep("audio", () => this.soundManager.init(onAudioProgress));

        onStep?.("finalize");
        await nextPaint();
        this.prepareNewRound();
        this.screenFlow.showIdleScreen().then();
        this.inputController.bindControls();
        this.inputController.bindTouchControls();
        this.inputController.bindMouseControls();
        this.creditsController.bind();
        requestAnimationFrame(this.loop.bind(this));
        if (minStepMs > 0) await wait(minStepMs / 2);
    }

    prepareNewRound() {
        const startLevel = this.difficulties[this.difficulty].startLevel;

        this.board.reset();
        this.modeController.setupBoard();
        this.startLevel = startLevel;
        this.level = startLevel;
        this.levelTier = tierForLevel(this.level, this.difficulties);
        this.dropInterval = dropIntervalForLevel(startLevel, this.scoring);

        this.statsTracker.reset();
        this.pieceController.reset();
        this.modeController.reset();

        this.hud.update(this.stats);
    }

    resetFallTrail() {
        this.fallTrailCount = 0;
        this.fallTrailHead = 0;
        this._trailPieceRef = null;
        this.lastRowStepTime = 0;
        this.effectiveDropIntervalMs = this.dropInterval || Infinity;
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
                x: piece.x,
                y,
                mask: piece.mask,
                width: piece.width,
                height: piece.height,
                color: piece.color,
            });
        }

        this.hardDropTrail = {entries, elapsed: 0, duration: HARD_DROP_TRAIL_DURATION_MS};
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

        if (this.hardDropTrail) {
            this.hardDropTrail.elapsed += delta;
            if (this.hardDropTrail.elapsed >= this.hardDropTrail.duration) {
                this.hardDropTrail = null;
            }
        }

        if (this.levelUpTimer > 0) {
            this.levelUpTimer = Math.max(0, this.levelUpTimer - delta);
        }

        if (this.state === "running" || this.state === "clearing") {
            this.elapsedMs += delta;

            this._hudUpdateAcc = (this._hudUpdateAcc ?? 0) + delta;
            if (this._hudUpdateAcc >= HUD_UPDATE_INTERVAL_MS) {
                this._hudUpdateAcc = 0;
                this.hud.update(this.stats);
            }

            this.musicDirector.update(this.board, delta);
        }

        if (this.state === "countdown") {
            this.countdownTimer += delta;
            while (this.countdownTimer >= this.countdownStepDuration) {
                this.countdownTimer -= this.countdownStepDuration;
                ++this.countdownIndex;
                if (this.countdownIndex >= COUNTDOWN_STEPS.length) {
                    this.screenFlow.start();
                    break;
                }
                this.screenFlow.advanceCountdownStep();
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

        if (this.state === "calibrating") {
            this.sensitivityCalibrationController.tick(delta);
            return;
        }

        if (this.state === "calibrating-keyboard") {
            this.keyboardCalibrationController.tick(delta);
            return;
        }

        if (this.state !== "running") return;

        const resting = this.board.collides(this.current, 0, 1);
        this.rawGrounded = resting;
        if (resting) this.dropCounter = 0;
        this.pieceController.updateGrounded(resting, delta);
        this.pieceController.updateFalling();

        this.modeController.update(delta);
        if (this.state !== "running") return;

        if (this.isGrounded) {
            const stillResting = this.board.collides(this.current, 0, 1);

            if (stillResting) {
                this.lockDelayTimer += delta;
                this.groundedTime += delta;
                const maxGroundedTime = this.getMaxGroundedTime();

                if (this.lockDelayTimer >= this.scoring.LOCK_DELAY || this.groundedTime >= maxGroundedTime) {
                    this.pieceController.lockCurrentPiece();
                }
                return;
            }
        }

        this.lockDelayTimer = 0;
        this.dropCounter += delta;
        if (this.dropCounter > this.dropInterval) {
            this.dropCounter -= this.dropInterval;
            ++this.current.y;
            this.noteRowStep();
            this.shiftAnim = null;

            if (this.board.collides(this.current, 0, 1)) {
                this.rawGrounded = true;
                this.dropCounter = 0;
            }
        }
    }

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
            if (this.state === "running" && this.dropInterval > 0 && !this.rawGrounded) {
                y = base.y + Math.min(1, this.dropCounter / this.dropInterval);
            }
        }

        if (x === base.x && y === base.y) return base;

        const rendered = Object.create(Object.getPrototypeOf(base));
        Object.assign(rendered, base, {x, y});

        return rendered;
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
            this._primeFallTrail(renderedPiece, trailLength, moveIntervalMs);
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

    _primeFallTrail(renderedPiece, trailLength, moveIntervalMs) {
        const stepPerFrame = Number.isFinite(moveIntervalMs) && moveIntervalMs > 0
            ? FALL_TRAIL_FRAME_MS / moveIntervalMs
            : 0;

        for (let i = 0; i < trailLength; i++) {
            const framesAgo = trailLength - i;
            const slot = this.fallTrail[i];
            slot.x = renderedPiece.x;
            slot.y = renderedPiece.y - framesAgo * stepPerFrame;
            slot.mask = renderedPiece.mask;
            slot.width = renderedPiece.width;
            slot.height = renderedPiece.height;
            slot.color = renderedPiece.color;
        }
        this.fallTrailHead = trailLength % FALL_TRAIL_MAX_LENGTH;
        this.fallTrailCount = trailLength;
    }

    render() {
        this.themeOverlay.update();

        const body = this.dom?.body;
        if (body) {
            const shouldHideCursor = ["running", "clearing", "countdown"].includes(this.state)
                && !this.settings.mouseControl
                && !this.multiplayerOptionsOverlayOpen;

            if (shouldHideCursor !== body.classList.contains("cursor-hidden")) {
                body.classList.toggle("cursor-hidden", shouldHideCursor);
                this._forceCursorRepaint();
            }
        }

        const showPieceBehindOptions = this.state === "options"
            && ["running", "paused"].includes(this.previousStateBeforeOptions);

        if (this.state === "clearing") {
            const progress = Math.min(1, this.clearingTimer / this.lineClearAnimationDuration);
            this.renderer.drawClearingFrame(
                this.board, this.clearingLines, this.clearingDropRows, this.clearingFragments, progress
            );
        } else {
            this.renderer.drawBoard(this.board);
        }

        if (this.hardDropTrail) {
            const progress = Math.min(1, this.hardDropTrail.elapsed / this.hardDropTrail.duration);
            this.renderer.drawHardDropTrail(this.hardDropTrail.entries, progress);
        }

        if (this.state === "running" || this.state === "paused" || this.state === "calibrating"
            || this.state === "calibrating-keyboard" || showPieceBehindOptions) {
            const renderedPiece = this.getRenderedPiece();

            if (this.state === "running" || this.state === "calibrating" || this.state === "calibrating-keyboard") {
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

            this.renderer.drawPiece(renderedPiece, this.board);
        }

        if (this.levelUpTimer > 0) {
            this.renderer.drawLevelUpBanner(this.levelUpLevel);
        }
    }

    _startBackgroundTicker() {
        if (this._backgroundTicker) return;
        this._backgroundTicker = setInterval(() => {
            const now = performance.now();
            const delta = Math.min(now - this.lastTime, 1000);
            this.lastTime = now;
            this.update(delta);
        }, 200);
    }

    _stopBackgroundTicker() {
        if (this._backgroundTicker) {
            clearInterval(this._backgroundTicker);
            this._backgroundTicker = null;
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
