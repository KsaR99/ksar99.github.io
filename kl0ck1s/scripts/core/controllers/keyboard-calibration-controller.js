"use strict";

import {
    ARR_MAX,
    ARR_MIN,
    ARR_STEP,
    COUNTDOWN_STEPS,
    DAS_MAX,
    DAS_MIN,
    DAS_STEP,
    KEYBOARD_CALIBRATION_ROUNDS,
} from "../game/game-constants.js";
import {DEFAULT_DAS_MS} from "./input/keyboard-input.js";

const HOLD_GESTURE_CODES = {holdLeft: "ArrowLeft", holdRight: "ArrowRight"};

function clampToStep(value, min, max, step) {
    const clamped = Math.max(min, Math.min(max, value));
    return Math.round(clamped / step) * step;
}

function pickGestures(count) {
    const pool = Object.keys(HOLD_GESTURE_CODES);
    const picked = [];
    for (let i = 0; i < count; i++) {
        picked.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    return picked;
}

function mean(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Drives the "Calibrate keyboard" exercise reachable from Options: spawns a
 * fresh, re-centered board, walks the player through
 * KEYBOARD_CALIBRATION_ROUNDS "hold LEFT/RIGHT, then release whenever you
 * like" gestures (each behind its own 3-2-1 countdown, same as
 * SensitivityCalibrationController), and derives new keyboardDAS/keyboardARR
 * settings from how the player actually holds a direction key:
 *
 * - Reaction time (prompt shown -> first keydown) stands in for how snappy
 *   the player wants the initial delay before auto-repeat kicks in (DAS): a
 *   player who reacts fast and expects the piece to already be moving wants
 *   a short DAS; a more relaxed player is less bothered by a longer one.
 * - Hold time versus columns actually travelled - under the CURRENT
 *   keyboardDAS/keyboardARR, i.e. real auto-repeat, not simulated - stands
 *   in for their preferred auto-repeat interval (ARR): the DAS delay is
 *   subtracted off first (that first extra column is DAS-paced, not
 *   ARR-paced), then what's left is split across the remaining columns to
 *   get an average ms-per-repeat figure.
 *
 * Like SensitivityCalibrationController's drag-only sampling, a round only
 * contributes an ARR sample if auto-repeat genuinely outlasted the DAS delay
 * (columnsMoved of 3+, i.e. at least one column moved at the real ARR pace
 * rather than the DAS-triggered one) - a quick tap, or a hold released
 * during/right at the end of DAS, still contributes a reaction/DAS sample,
 * it just has nothing reliable to say about ARR.
 *
 * Known simplification: if a hold runs long enough to drive the piece into
 * the board edge, further holding no longer moves it, which would make that
 * round's ARR sample look slower than it really was. Rounds are centered
 * first to give room in both directions, but a very long hold can still hit
 * the edge - same class of approximation the sensitivity controller already
 * accepts for its own overshoot-based reading.
 */
export class KeyboardCalibrationController {
    constructor(game) {
        this.game = game;
        this.active = false;
        this.armed = false;
        this.roundIndex = 0;
        this.totalRounds = KEYBOARD_CALIBRATION_ROUNDS;
        this.gestureQueue = [];
        this.samples = [];
        this._pendingSettings = {};

        this.roundStartX = 0;
        this.armedAt = 0;
        this.keyDownAt = null;
        this.sawKeyDown = false;

        this.countdownIndex = 0;
        this.countdownTimer = 0;

        this._onKeyDown = null;
        this._onKeyUp = null;
    }

    start() {
        const game = this.game;
        if (this.active) return;

        game.soundManager.stopPreview();
        game.pieceController.stopGameplaySounds();
        game.musicDirector.stop();
        game.previousStateBeforeOptions = null;
        game.state = "calibrating-keyboard";
        game.isPlayingSession = false;
        game.hud.setPlaying(false);
        game.prepareNewRound();

        this.active = true;
        this.samples = [];
        this.roundIndex = 0;
        this.gestureQueue = pickGestures(this.totalRounds);

        this._bindKeyTracking();
        this._showBanner(this.gestureQueue[this.roundIndex]);
        this._armCountdown();
    }

    cancel() {
        const game = this.game;
        if (!this.active && game.state !== "calibrating-keyboard-result") return;

        this.active = false;
        this.armed = false;
        this._unbindKeyTracking();
        this._hideBanner();
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

        const {number, tint} = COUNTDOWN_STEPS[this.countdownIndex];
        if (!this.game.hud.updateCountdown(number, tint)) {
            this.game.hud.showScreen(this.game.screens.countdown(number, tint, this.game.dom), {transparentOverlay: true});
        }
    }

    _armCountdown() {
        this.armed = false;
        this.countdownIndex = 0;
        this.countdownTimer = 0;
        const {number, tint} = COUNTDOWN_STEPS[this.countdownIndex];
        this.game.hud.showScreen(this.game.screens.countdown(number, tint, this.game.dom), {transparentOverlay: true});
    }

    _armRound() {
        const game = this.game;
        game.hud.hideOverlay();

        // Centered so a hold in either direction has room to actually move -
        // unlike sensitivity calibration's edge-targeted gestures, this one
        // doesn't care which way the player goes, only how they hold.
        game.pieceController.moveToColumn(Math.floor(game.board.cols / 2));

        this.roundStartX = game.current.x;
        this.armedAt = Date.now();
        this.keyDownAt = null;
        this.sawKeyDown = false;
        this.armed = true;

        this._showBanner(this.gestureQueue[this.roundIndex]);
    }

    _showBanner(gesture) {
        const game = this.game;
        const banner = game.dom?.querySelector('[data-role="calibration-banner"]');
        if (!banner) return;

        const instructionEl = banner.querySelector('[data-field="instruction"]');
        const progressEl = banner.querySelector('[data-field="progress"]');
        if (instructionEl) instructionEl.textContent = game.i18n.t(`screens.calibration.gestures.${gesture}`);
        if (progressEl) {
            progressEl.textContent = game.i18n.t("screens.calibration.progress", {
                done: this.roundIndex,
                total: this.totalRounds,
            });
        }
        banner.classList.add("board__calibration--visible");
    }

    _hideBanner() {
        const banner = this.game.dom?.querySelector('[data-role="calibration-banner"]');
        if (banner) banner.classList.remove("board__calibration--visible");
    }

    /**
     * Own keydown/keyup listeners just for timing - separate from
     * KeyboardInput's, which keeps driving the actual piece movement (and
     * real auto-repeat) throughout the hold exactly as it would in a normal
     * round, since "calibrating-keyboard" is in PIECE_CONTROLLABLE_STATES.
     */
    _bindKeyTracking() {
        const game = this.game;
        if (!game.dom) return;

        this._onKeyDown = (event) => {
            if (!this.armed || this.sawKeyDown || event.repeat) return;
            const expectedCode = HOLD_GESTURE_CODES[this.gestureQueue[this.roundIndex]];
            if (event.code !== expectedCode) return;

            this.sawKeyDown = true;
            this.keyDownAt = Date.now();
        };

        this._onKeyUp = (event) => {
            if (!this.armed || !this.sawKeyDown) return;
            const expectedCode = HOLD_GESTURE_CODES[this.gestureQueue[this.roundIndex]];
            if (event.code !== expectedCode) return;

            this._completeRound();
        };

        game.dom.addEventListener("keydown", this._onKeyDown);
        game.dom.addEventListener("keyup", this._onKeyUp);
    }

    _unbindKeyTracking() {
        const game = this.game;
        if (game.dom) {
            if (this._onKeyDown) game.dom.removeEventListener("keydown", this._onKeyDown);
            if (this._onKeyUp) game.dom.removeEventListener("keyup", this._onKeyUp);
        }
        this._onKeyDown = null;
        this._onKeyUp = null;
    }

    _completeRound() {
        const game = this.game;
        const now = Date.now();
        const reactionMs = this.keyDownAt - this.armedAt;
        const holdMs = now - this.keyDownAt;
        const columnsMoved = Math.abs(game.current.x - this.roundStartX);

        this.samples.push({reactionMs, holdMs, columnsMoved});

        this.armed = false;
        this.roundIndex += 1;

        if (this.roundIndex >= this.totalRounds) {
            this._finish();
        } else {
            this._showBanner(this.gestureQueue[this.roundIndex]);
            this._armCountdown();
        }
    }

    _finish() {
        const game = this.game;
        this._unbindKeyTracking();
        this._hideBanner();

        const reactionSamples = this.samples.map((sample) => sample.reactionMs);
        // A hold's timeline is: immediate move at t=0, then the first
        // *repeat* only fires after the DAS delay, and only the gaps after
        // that are actually paced by ARR - so columnsMoved needs at least 3
        // (immediate + DAS-triggered + one real ARR-paced step) before
        // holdMs minus that DAS delay, split across the remaining
        // (columnsMoved - 2) gaps, means anything. Without subtracting DAS
        // first, a short hold's time is dominated by the DAS wait rather
        // than the repeat rate, which skews the derived ARR toward DAS
        // instead of the player's actual repeat pace.
        const activeDas = game.settings.keyboardDAS ?? DEFAULT_DAS_MS;
        const arrSamples = this.samples
            .filter((sample) => sample.columnsMoved >= 3)
            .map((sample) => (sample.holdMs - activeDas) / (sample.columnsMoved - 2));

        // Candidate values are staged, not applied - same as
        // SensitivityCalibrationController: the player reviews the result
        // and explicitly Save/Discard/Restart rather than the round
        // auto-committing the moment it finishes.
        const pending = {};
        let newDas = null;
        let newArr = null;

        if (reactionSamples.length > 0) {
            newDas = clampToStep(mean(reactionSamples), DAS_MIN, DAS_MAX, DAS_STEP);
            pending.keyboardDAS = newDas;
        }
        if (arrSamples.length > 0) {
            newArr = clampToStep(mean(arrSamples), ARR_MIN, ARR_MAX, ARR_STEP);
            pending.keyboardARR = newArr;
        }
        this._pendingSettings = pending;

        game.state = "calibrating-keyboard-result";
        game.hud.showScreen(game.screens.keyboardCalibrationResult(newDas, newArr, game.dom, game.i18n));
        this.active = false;

        this._bindResultButtons();
    }

    /** Applies whatever _finish() staged in _pendingSettings and persists it - called by the result screen's Save button. */
    _acceptResult() {
        const game = this.game;
        Object.assign(game.settings, this._pendingSettings);
        if (Object.keys(this._pendingSettings).length > 0) game.settingsController.saveSettings();
        game.screenFlow.showIdleScreen().then();
    }

    _bindResultButtons() {
        const game = this.game;
        const saveButton = game.dom?.querySelector('[data-role="keyboard-calibration-result-save-button"]');
        const discardButton = game.dom?.querySelector('[data-role="keyboard-calibration-result-discard-button"]');
        const restartButton = game.dom?.querySelector('[data-role="keyboard-calibration-result-restart-button"]');

        if (saveButton) {
            // Nothing to save if neither DAS nor ARR could be derived - hide
            // the option rather than let it silently no-op.
            if (Object.keys(this._pendingSettings ?? {}).length === 0) {
                saveButton.hidden = true;
            } else {
                saveButton.addEventListener("click", () => this._acceptResult(), {once: true});
            }
        }
        if (discardButton) {
            discardButton.addEventListener("click", () => game.screenFlow.showIdleScreen().then(), {once: true});
        }
        if (restartButton) {
            restartButton.addEventListener("click", () => this.start(), {once: true});
        }
    }
}
