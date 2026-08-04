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

// tutorialLeft/tutorialRight are the "wall-stopped" single-column steps that
// teach basic control before the real drag steps; dragToLeftEdge/
// dragToRightEdge are the full center-to-edge drags that actually feed the
// sensitivity estimate (see SAMPLE_GESTURES below).
const GESTURE_DIR_SIGN = {tutorialLeft: -1, tutorialRight: 1, dragToLeftEdge: -1, dragToRightEdge: 1};
const TUTORIAL_GESTURES = new Set(["tutorialLeft", "tutorialRight"]);
const SAMPLE_GESTURES = new Set(["dragToLeftEdge", "dragToRightEdge"]);

const GESTURE_MATCHERS = {
    tutorialLeft: (kind, payload, ctrl) => kind === "move" && payload.x - ctrl.roundStartX <= -1,
    tutorialRight: (kind, payload, ctrl) => kind === "move" && payload.x - ctrl.roundStartX >= 1,
    dragToLeftEdge: (kind, payload, ctrl) => kind === "move" && payload.x <= ctrl.targetX,
    dragToRightEdge: (kind, payload, ctrl) => kind === "move" && payload.x >= ctrl.targetX,
};

// Reuses the existing moveLeft/moveRight/sideToEdge translations rather than
// adding brand-new strings for every language - only the ◄/► decoration
// (added in instructionText() below) is specific to the tutorial/drag split.
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

/**
 * Drives the "Calibrate sensitivity" exercise reachable from Options: spawns
 * a fresh board and walks the player through SENSITIVITY_CALIBRATION_ROUNDS
 * passes (default 3), each running the same fixed sequence of steps -
 * SENSITIVITY_CALIBRATION_STEPS - behind its own in-banner 3-2-1 countdown:
 *
 *  1. tutorialLeft/tutorialRight - move the piece exactly one column left,
 *     then one right. A "wall" (clampDragTargetX(), called from
 *     PieceController.moveToColumn()) stops the piece after that single
 *     column even if the drag itself keeps going, so these steps only teach
 *     the gesture and never feed the sensitivity estimate - see
 *     SAMPLE_GESTURES.
 *  2. dragToLeftEdge/dragToRightEdge - drag the piece all the way from the
 *     center column to each edge. These are the real samples: overshoot
 *     (dragging past the edge and correcting back) derives a personal
 *     mouseSensitivity/touchSensitivity value, same technique as before.
 *
 * The board itself is never hidden behind a full-screen countdown screen -
 * unlike the regular play-start countdown, the countdown here renders
 * in-place inside the small calibration banner (see _updateCountdownDisplay)
 * so the piece stays visible and steerable throughout, and there's no
 * hide/show flash between rounds.
 *
 * After every pass, _refineSensitivity() recomputes the running average from
 * every sample gathered so far and applies it live to game.settings, so each
 * later pass's drag is already steered with the improved value instead of
 * only updating once at the very end. The pre-exercise values are snapshotted
 * in start() and restored by cancel()/Discard/Restart, so this live preview
 * never survives anything but an explicit Save.
 */
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

        // The board is shown right away and stays visible for the whole
        // exercise - no full-screen countdown ever covers it (see class doc).
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

    /**
     * Called by PieceController.moveToColumn() for every drag-driven move
     * (mouse or touch). Outside an armed tutorial step this is a no-op; while
     * tutorialLeft/tutorialRight is armed, it clamps the target column to at
     * most one column away from where the step started - a "wall" that stops
     * the piece there regardless of how far the drag itself continues.
     */
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

        // Every step starts centered: tutorialLeft/Right need room to move
        // in either direction (same reasoning as KeyboardCalibrationController),
        // and dragToLeftEdge/dragToRightEdge both start their drag from the
        // center column, per the exercise's design.
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

    /** Mirrors PieceController.moveToColumn()'s own clamping math, without actually moving the piece - used to know the exact x a drag needs to reach for an edge column before the player has moved there. */
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
        this.stepIndex += 1;

        // A pass just finished (every SENSITIVITY_CALIBRATION_STEPS.length
        // steps) - refine the live estimate before the next pass starts.
        if (this.stepIndex % this.stepsPerPass === 0) this._refineSensitivity();

        if (this.stepIndex >= this.totalSteps) {
            this._finish();
        } else {
            this._showBanner(this.gestureQueue[this.stepIndex]);
            this._armCountdown();
        }
    }

    /** Recomputes mouseSensitivity/touchSensitivity from every sample gathered so far (across all completed passes) and applies it live to game.settings - not persisted yet, just previewed for the remaining passes. See _acceptResult()/_restoreOriginalSettings() for how this is finalized or undone. */
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

        // Candidate values are staged, not applied - the player gets to
        // review the result and explicitly Save/Discard/Restart rather than
        // having the exercise auto-commit the moment it finishes. (The live
        // preview from _refineSensitivity() is already sitting in
        // game.settings at this point; this just recomputes the same
        // averages to display and to hand to Save/Discard/Restart.)
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

    /** Applies whatever _finish() staged in _pendingSettings and persists it - called by the result screen's Save button. */
    _acceptResult() {
        const game = this.game;
        Object.assign(game.settings, this._pendingSettings);
        if (Object.keys(this._pendingSettings).length > 0) game.settingsController.saveSettings();
        this._originalSettings = null;
        game.screenFlow.showIdleScreen().then();
    }

    /** Undoes the exercise's live preview (see _refineSensitivity()), restoring whatever mouseSensitivity/touchSensitivity were before start() ran - called by the result screen's Discard button. */
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
            // Nothing to save if every gesture whiffed (no samples at all) -
            // hide the option rather than let it silently no-op.
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
            // Undo this attempt's live preview first, so restarting always
            // begins from the same pre-exercise baseline rather than
            // building on top of whatever the last attempt refined.
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

    /** Renders the current COUNTDOWN_STEPS entry inside the calibration banner itself (not a full-screen overlay), so the board and piece stay visible/steerable through the countdown. */
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
