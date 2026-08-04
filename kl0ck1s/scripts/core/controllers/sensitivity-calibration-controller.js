"use strict";

import {
    COUNTDOWN_STEPS,
    SENSITIVITY_CALIBRATION_ROUNDS,
    SENSITIVITY_CALIBRATION_STEPS,
    SENSITIVITY_MAX,
    SENSITIVITY_MIN,
    SENSITIVITY_STEP,
} from "../game/game-constants.js";
import {getTightBounds} from "../shared/utils.js";

const GESTURE_DIR_SIGN = {tutorialLeft: -1, tutorialRight: 1, dragToLeftEdge: -1, dragToRightEdge: 1};
const TUTORIAL_GESTURES = new Set(["tutorialLeft", "tutorialRight"]);
const SAMPLE_GESTURES = new Set(["dragToLeftEdge", "dragToRightEdge"]);

const GESTURE_MATCHERS = {
    tutorialLeft: (kind, payload, ctrl) => kind === "move" && payload.x - ctrl.roundStartX <= -1,
    tutorialRight: (kind, payload, ctrl) => kind === "move" && payload.x - ctrl.roundStartX >= 1,
    dragToLeftEdge: (kind, payload, ctrl) => kind === "move" && payload.x <= ctrl.targetX,
    dragToRightEdge: (kind, payload, ctrl) => kind === "move" && payload.x >= ctrl.targetX,
};

const GESTURE_INSTRUCTION_KEYS = {
    tutorialLeft: "moveLeft",
    tutorialRight: "moveRight",
    dragToLeftEdge: "sideToEdge",
    dragToRightEdge: "sideToEdge",
};
const GESTURE_ARROW_BEFORE = new Set(["tutorialLeft", "dragToLeftEdge"]);

function instructionText(i18n, gesture) {
    const base = i18n.t(`screens.calibration.gestures.${GESTURE_INSTRUCTION_KEYS[gesture]}`);
    return GESTURE_ARROW_BEFORE.has(gesture) ? `◄ ${base}` : `${base} ►`;
}

function clampSensitivity(value) {
    const clamped = Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, value));
    return Math.round(clamped / SENSITIVITY_STEP) * SENSITIVITY_STEP;
}

function buildGestureQueue(passes) {
    const queue = [];
    for (let i = 0; i < passes; i++) queue.push(...SENSITIVITY_CALIBRATION_STEPS);
    return queue;
}

export class SensitivityCalibrationController {
    constructor(game) {
        this.game = game;
        this.active = false;
        this.armed = false;

        this.stepIndex = 0;
        this.totalPasses = SENSITIVITY_CALIBRATION_ROUNDS;
        this.stepsPerPass = SENSITIVITY_CALIBRATION_STEPS.length;
        this.totalSteps = this.totalPasses * this.stepsPerPass;
        this.gestureQueue = [];
        this.samples = [];
        this._pendingSettings = {};
        this._originalSettings = null;

        this.roundStartX = 0;
        this.targetX = 0;
        this.countdownIndex = 0;
        this.countdownTimer = 0;

        this.dragStartX = null;
        this.lastPointerX = null;
        this.lastPointerType = null;
        this.maxDxInDirection = 0;

        this._canvas = null;
        this._onPointerDown = null;
        this._onPointerMove = null;
    }

    start() {
        const game = this.game;
        if (this.active) return;

        game.soundManager.stopPreview();
        game.pieceController.stopGameplaySounds();
        game.musicDirector.stop();
        game.previousStateBeforeOptions = null;
        game.state = "calibrating";
        game.isPlayingSession = false;
        game.hud.setPlaying(false);
        game.prepareNewRound();
        game.hud.hideOverlay();

        this.active = true;
        this.samples = [];
        this.stepIndex = 0;
        this.totalPasses = SENSITIVITY_CALIBRATION_ROUNDS;
        this.stepsPerPass = SENSITIVITY_CALIBRATION_STEPS.length;
        this.totalSteps = this.totalPasses * this.stepsPerPass;
        this.gestureQueue = buildGestureQueue(this.totalPasses);
        this._originalSettings = {
            mouseSensitivity: game.settings.mouseSensitivity,
            touchSensitivity: game.settings.touchSensitivity,
        };

        this._bindPointerTracking();
        this._showBanner(this.gestureQueue[this.stepIndex]);
        this._armCountdown();
    }

    cancel() {
        const game = this.game;
        if (!this.active && game.state !== "calibrating-result") return;

        this.active = false;
        this.armed = false;
        this._unbindPointerTracking();
        this._hideBanner();
        this._restoreOriginalSettings();
        game.hud.hideOverlay();
        game.screenFlow.showIdleScreen().then();
    }

    tick(delta) {
        if (this.armed) return;

        this.countdownTimer += delta;
        if (this.countdownTimer < this.game.countdownStepDuration) return;
        this.countdownTimer = 0;
        this.countdownIndex++;

        if (this.countdownIndex >= COUNTDOWN_STEPS.length) {
            this._armRound();
            return;
        }

        this._updateCountdownDisplay();
    }

    notify(kind, payload) {
        if (!this.active || !this.armed) return;
        const gesture = this.gestureQueue[this.stepIndex];
        const matcher = GESTURE_MATCHERS[gesture];
        if (!matcher || !matcher(kind, payload, this)) return;
        this._completeRound();
    }

    clampDragTargetX(targetX) {
        if (!this.active || !this.armed) return targetX;
        const gesture = this.gestureQueue[this.stepIndex];
        if (!TUTORIAL_GESTURES.has(gesture)) return targetX;

        const dir = GESTURE_DIR_SIGN[gesture];
        const min = dir < 0 ? this.roundStartX - 1 : this.roundStartX;
        const max = dir > 0 ? this.roundStartX + 1 : this.roundStartX;
        return Math.max(min, Math.min(max, targetX));
    }

    _armCountdown() {
        this.armed = false;
        this.countdownIndex = 0;
        this.countdownTimer = 0;
        this._updateCountdownDisplay();
    }

    _armRound() {
        const game = this.game;
        const gesture = this.gestureQueue[this.stepIndex];

        this._clearCountdownDisplay();

        game.pieceController.moveToColumn(Math.floor(game.board.cols / 2));

        if (gesture === "dragToLeftEdge" || gesture === "dragToRightEdge") {
            this.targetX = this._targetXForColumn(gesture === "dragToLeftEdge" ? 0 : game.board.cols - 1);
        }

        this.roundStartX = game.current.x;
        this.dragStartX = null;
        this.lastPointerX = null;
        this.lastPointerType = null;
        this.maxDxInDirection = 0;
        this.armed = true;

        this._showBanner(gesture);
    }

    _targetXForColumn(column) {
        const game = this.game;
        const bounds = getTightBounds(game.current.mask, game.current.width, game.current.height);
        const offsetX = bounds.minX || 0;
        let col = column - Math.floor((bounds.width - 1) / 2);
        col = Math.max(0, Math.min(col, game.board.cols - bounds.width));
        return col - offsetX;
    }

    _completeRound() {
        const game = this.game;
        const gesture = this.gestureQueue[this.stepIndex];
        const dirSign = GESTURE_DIR_SIGN[gesture];

        if (SAMPLE_GESTURES.has(gesture) && dirSign !== undefined && this.dragStartX !== null) {
            const finalDx = dirSign * (this.lastPointerX - this.dragStartX);
            if (finalDx > 0 && this.maxDxInDirection > 0) {
                const overshootFactor = Math.max(1, this.maxDxInDirection / finalDx);
                const settingKey = this.lastPointerType === "touch" ? "touchSensitivity" : "mouseSensitivity";
                const prevSensitivity = game.settings[settingKey] ?? 1;
                this.samples.push({settingKey, value: prevSensitivity / overshootFactor});
            }
        }

        this.armed = false;
        ++this.stepIndex;

        if (this.stepIndex % this.stepsPerPass === 0) this._refineSensitivity();

        if (this.stepIndex >= this.totalSteps) {
            this._finish();
        } else {
            this._showBanner(this.gestureQueue[this.stepIndex]);
            this._armCountdown();
        }
    }

    _refineSensitivity() {
        const game = this.game;
        const byKey = {mouseSensitivity: [], touchSensitivity: []};
        this.samples.forEach(({settingKey, value}) => byKey[settingKey].push(value));

        Object.entries(byKey).forEach(([key, values]) => {
            if (values.length === 0) return;
            const average = values.reduce((sum, value) => sum + value, 0) / values.length;
            game.settings[key] = clampSensitivity(average);
        });
    }

    _finish() {
        const game = this.game;
        this._unbindPointerTracking();
        this._hideBanner();

        const byKey = {mouseSensitivity: [], touchSensitivity: []};
        this.samples.forEach(({settingKey, value}) => byKey[settingKey].push(value));

        const pending = {};
        let summaryValue = null;
        Object.entries(byKey).forEach(([key, values]) => {
            if (values.length === 0) return;
            const average = values.reduce((sum, value) => sum + value, 0) / values.length;
            const clamped = clampSensitivity(average);
            pending[key] = clamped;
            if (summaryValue === null) summaryValue = clamped;
        });
        this._pendingSettings = pending;

        game.state = "calibrating-result";
        game.hud.showScreen(game.screens.calibrationResult(summaryValue, game.dom, game.i18n));
        this.active = false;

        this._bindResultButtons();
    }

    _acceptResult() {
        const game = this.game;
        Object.assign(game.settings, this._pendingSettings);
        if (Object.keys(this._pendingSettings).length > 0) game.settingsController.saveSettings();
        this._originalSettings = null;
        game.screenFlow.showIdleScreen().then();
    }

    _discardResult() {
        this._restoreOriginalSettings();
        this.game.screenFlow.showIdleScreen().then();
    }

    _restoreOriginalSettings() {
        if (!this._originalSettings) return;
        Object.assign(this.game.settings, this._originalSettings);
        this._originalSettings = null;
    }

    _bindResultButtons() {
        const game = this.game;
        const saveButton = game.dom?.querySelector('[data-role="calibration-result-save-button"]');
        const discardButton = game.dom?.querySelector('[data-role="calibration-result-discard-button"]');
        const restartButton = game.dom?.querySelector('[data-role="calibration-result-restart-button"]');

        if (saveButton) {
            if (Object.keys(this._pendingSettings ?? {}).length === 0) {
                saveButton.hidden = true;
            } else {
                saveButton.addEventListener("click", () => this._acceptResult(), {once: true});
            }
        }
        if (discardButton) {
            discardButton.addEventListener("click", () => this._discardResult(), {once: true});
        }
        if (restartButton) {
            restartButton.addEventListener("click", () => {
                this._restoreOriginalSettings();
                this.start();
            }, {once: true});
        }
    }

    _showBanner(gesture) {
        const game = this.game;
        const banner = game.dom?.querySelector('[data-role="calibration-banner"]');
        if (!banner) return;

        const instructionEl = banner.querySelector('[data-field="instruction"]');
        const progressEl = banner.querySelector('[data-field="progress"]');
        if (instructionEl) instructionEl.textContent = instructionText(game.i18n, gesture);
        if (progressEl) {
            const pass = Math.floor(this.stepIndex / this.stepsPerPass) + 1;
            const step = (this.stepIndex % this.stepsPerPass) + 1;
            progressEl.textContent = game.i18n.t("screens.calibration.progress", {
                pass, totalPasses: this.totalPasses, step, steps: this.stepsPerPass,
            });
        }
        banner.classList.add("board__calibration--visible");
    }

    _hideBanner() {
        const banner = this.game.dom?.querySelector('[data-role="calibration-banner"]');
        if (banner) banner.classList.remove("board__calibration--visible");
    }

    _updateCountdownDisplay() {
        const banner = this.game.dom?.querySelector('[data-role="calibration-banner"]');
        const el = banner?.querySelector('[data-field="countdown"]');
        if (!el) return;

        const {number, tint} = COUNTDOWN_STEPS[this.countdownIndex];
        el.textContent = number;
        el.dataset.tint = tint;
        el.classList.remove("board__calibration__countdown--pop");
        void el.offsetWidth;
        el.classList.add("board__calibration__countdown--pop");
    }

    _clearCountdownDisplay() {
        const banner = this.game.dom?.querySelector('[data-role="calibration-banner"]');
        const el = banner?.querySelector('[data-field="countdown"]');
        if (el) el.textContent = "";
    }

    _bindPointerTracking() {
        const game = this.game;
        const canvas = game.dom?.getElementById("klockis-board");
        if (!canvas) return;

        this._onPointerDown = (event) => {
            if (!this.armed) return;
            this.dragStartX = event.clientX;
            this.lastPointerX = event.clientX;
            this.lastPointerType = event.pointerType;
            this.maxDxInDirection = 0;
        };

        this._onPointerMove = (event) => {
            if (!this.armed || this.dragStartX === null) return;
            this.lastPointerX = event.clientX;

            const gesture = this.gestureQueue[this.stepIndex];
            const dirSign = GESTURE_DIR_SIGN[gesture];
            if (dirSign === undefined) return;

            const signedDx = dirSign * (event.clientX - this.dragStartX);
            if (signedDx > this.maxDxInDirection) this.maxDxInDirection = signedDx;
        };

        canvas.addEventListener("pointerdown", this._onPointerDown);
        canvas.addEventListener("pointermove", this._onPointerMove);
        this._canvas = canvas;
    }

    _unbindPointerTracking() {
        if (!this._canvas) return;
        this._canvas.removeEventListener("pointerdown", this._onPointerDown);
        this._canvas.removeEventListener("pointermove", this._onPointerMove);
        this._canvas = null;
        this._onPointerDown = null;
        this._onPointerMove = null;
    }
}
