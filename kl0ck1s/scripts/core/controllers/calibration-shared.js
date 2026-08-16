"use strict";

import {voiceCountingKey} from "../shared/config.js";

export function mean(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function clampToStep(value, min, max, step) {
    const clamped = Math.max(min, Math.min(max, value));
    return Math.round(clamped / step) * step;
}

export function getBanner(game) {
    return game.dom?.querySelector('[data-role="calibration-banner"]');
}

export function getBannerField(game, field) {
    return getBanner(game)?.querySelector(`[data-field="${field}"]`);
}

export function showCalibrationBanner(game) {
    getBanner(game)?.classList.add("board__calibration--visible");
}

export function hideCalibrationBanner(game) {
    getBanner(game)?.classList.remove("board__calibration--visible");
}

export function clearCountdownDisplay(game) {
    const el = getBannerField(game, "countdown");
    if (el) el.textContent = "";
}

export function updateCountdownDisplay(game, countdownIndex, steps, applyTint) {
    const el = getBannerField(game, "countdown");
    if (!el) return;

    const {number, tint} = steps[countdownIndex];
    game.soundManager.play(voiceCountingKey(number));
    el.textContent = number;
    applyTint(el, tint);
    el.classList.remove("board__calibration__countdown--pop");
    void el.offsetWidth;
    el.classList.add("board__calibration__countdown--pop");
}

export function tickCalibrationCountdown(controller, delta, {steps, stepDuration, onStep, onComplete}) {
    controller.countdownTimer += delta;
    while (controller.countdownTimer >= stepDuration) {
        controller.countdownTimer -= stepDuration;
        controller.countdownIndex++;

        if (controller.countdownIndex >= steps.length) {
            onComplete();
            return;
        }
        onStep();
    }
}

export function bindCalibrationResultButtons(game, prefix, {hasPending, onSave, onDiscard, onRestart}) {
    const saveButton = game.dom?.querySelector(`[data-role="${prefix}-save-button"]`);
    const discardButton = game.dom?.querySelector(`[data-role="${prefix}-discard-button"]`);
    const restartButton = game.dom?.querySelector(`[data-role="${prefix}-restart-button"]`);

    if (saveButton) {
        if (hasPending) {
            saveButton.addEventListener("click", onSave, {once: true});
        } else {
            saveButton.hidden = true;
        }
    }
    if (discardButton) discardButton.addEventListener("click", onDiscard, {once: true});
    if (restartButton) restartButton.addEventListener("click", onRestart, {once: true});
}
