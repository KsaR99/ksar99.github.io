"use strict";

import {formatNumber} from "../shared/utils.js";
import {SOUND_FILES} from "../shared/config.js";

function clone(dom, templateId) {
    return dom.getElementById(templateId).content.cloneNode(true);
}

function fillDifficultyCarousel(container, selectedDifficulty, difficulties, i18n) {
    if (!container) return;
    const def = difficulties[selectedDifficulty];
    container.querySelector('[data-field="difficultyLabel"]').textContent = i18n.t(`difficulty.${selectedDifficulty}`);
    container.querySelector('[data-field="difficultyLevel"]').textContent = i18n.t("difficulty.levelPrefix", {level: def.startLevel});
}

function fillModeCarousel(container, selectedMode, i18n) {
    if (!container) return;
    container.querySelector('[data-field="modeLabel"]').textContent = i18n.t(`modes.${selectedMode}.name`);
}

/**
 * Fills the single shared panel below the mode picker with the currently
 * selected mode's rules text, prefixed with 💡. Called once per screen
 * render (idle/gameOverSaved); ModeController re-renders the whole screen
 * on every mode change (click or arrow key), so this always reflects the
 * current selection without needing its own change listener.
 */
function fillModeDescription(container, selectedMode, i18n) {
    if (!container) return;
    container.textContent = `💡 ${i18n.t(`modes.${selectedMode}.description`)}`;
}

function fillSoundRows(dom, container, keys, soundVolumes, i18n) {
    keys.forEach((key) => {
        const row = clone(dom, "tpl-options-sound-row").querySelector('[data-role="sound-row"]');
        const label = SOUND_FILES[key]?.label ?? i18n.t(`sounds.${key}`);
        row.querySelector('[data-field="name"]').textContent = label;

        const slider = row.querySelector('[data-role="sound-volume-slider"]');
        slider.dataset.soundKey = key;
        slider.value = Math.round((soundVolumes[key] ?? 1) * 100);

        const previewButton = row.querySelector('[data-role="sound-preview-button"]');
        previewButton.dataset.soundKey = key;
        previewButton.setAttribute("aria-label", i18n.t("screens.options.preview"));

        container.appendChild(row);
    });
}

function fillModeInfoRules(dom, container, mode, i18n) {
    const rules = i18n.raw(`modes.${mode}.rules`) ?? [];
    rules.forEach((rule) => {
        const item = clone(dom, "tpl-mode-info-rule").querySelector('[data-field="rule"]');
        item.textContent = rule;
        container.appendChild(item);
    });
}

export const Screens = {
    loading(title, text, dom = document) {
        const screen = clone(dom, "tpl-screen-loading");
        screen.querySelector('[data-field="title"]').textContent = title;
        screen.querySelector('[data-field="hint"]').textContent = text;
        return screen;
    },

    idle(list, selectedDifficulty, difficulties, selectedMode, gameModes, renderLeaderboard, dom = document, i18n, playerName = "") {
        const screen = clone(dom, "tpl-screen-idle");
        fillDifficultyCarousel(screen.querySelector('[data-role="difficulty-select"]'), selectedDifficulty, difficulties, i18n);
        fillModeCarousel(screen.querySelector('[data-role="mode-select"]'), selectedMode, i18n);
        fillModeDescription(screen.querySelector('[data-field="modeDescription"]'), selectedMode, i18n);
        screen.querySelector('[data-role="name-input"]').value = playerName;
        screen.querySelector('[data-field="leaderboard"]').appendChild(renderLeaderboard(list));
        i18n.applyStatic(screen);
        return screen;
    },

    paused(dom = document, i18n) {
        const screen = clone(dom, "tpl-screen-paused");
        i18n.applyStatic(screen);
        return screen;
    },

    options(settings, dom = document, i18n, soundManager = null) {
        const screen = clone(dom, "tpl-screen-options");

        if (soundManager) {
            const categoryVolumes = settings.categoryVolumes ?? {};
            const soundVolumes = settings.soundVolumes ?? {};

            ["sfx", "music"].forEach((category) => {
                const keys = soundManager.keysInCategory(category);
                const group = screen.querySelector(`[data-role="sound-group-${category}"]`);
                if (!group) return;

                if (keys.length === 0) {
                    group.remove();
                    return;
                }

                const categorySlider = group.querySelector('[data-role="category-volume-slider"]');
                if (categorySlider) categorySlider.value = Math.round((categoryVolumes[category] ?? 1) * 100);

                const list = group.querySelector('[data-role="sound-list"]');
                if (list) fillSoundRows(dom, list, keys, soundVolumes, i18n);
            });
        }

        const muteCheckbox = screen.querySelector('[data-role="mute-checkbox"]');
        const volumeSlider = screen.querySelector('[data-role="volume-slider"]');
        muteCheckbox.checked = settings.muted;
        volumeSlider.value = Math.round(settings.volume * 100);
        volumeSlider.disabled = settings.muted;
        screen.querySelector('[data-role="hud-right-checkbox"]').checked = settings.hudRight;
        screen.querySelector('[data-role="ghost-checkbox"]').checked = settings.ghost;
        screen.querySelector('[data-role="grid-checkbox"]').checked = settings.gridLines;
        screen.querySelector('[data-role="glow-checkbox"]').checked = settings.glow;
        screen.querySelector('[data-role="transparency-checkbox"]').checked = settings.transparency;
        const fallTrailCheckbox = screen.querySelector('[data-role="fall-trail-checkbox"]');
        if (fallTrailCheckbox) fallTrailCheckbox.checked = Boolean(settings.fallTrail);
        const skipCountdownCheckbox = screen.querySelector('[data-role="skip-countdown-checkbox"]');
        if (skipCountdownCheckbox) skipCountdownCheckbox.checked = Boolean(settings.skipCountdown);
        const skipModeInfoCheckbox = screen.querySelector('[data-role="skip-mode-info-checkbox"]');
        if (skipModeInfoCheckbox) skipModeInfoCheckbox.checked = Boolean(settings.skipModeInfo);

        const mouseControlCheckbox = screen.querySelector('[data-role="mouse-control-checkbox"]');
        if (mouseControlCheckbox) mouseControlCheckbox.checked = Boolean(settings.mouseControl);

        const mouseSensitivitySlider = screen.querySelector('[data-role="mouse-sensitivity-slider"]');
        if (mouseSensitivitySlider) {
            mouseSensitivitySlider.value = Math.round((settings.mouseSensitivity ?? 1) * 100);
            mouseSensitivitySlider.disabled = !settings.mouseControl;
        }

        const effectSelect = screen.querySelector('[data-role="effect-select"]');
        if (effectSelect) effectSelect.value = settings.effect ?? "none";

        const langSelect = screen.querySelector('[data-role="lang-select"]');
        if (langSelect) {
            Object.entries(i18n.languages).forEach(([code, name]) => {
                const option = dom.createElement("option");
                option.value = code;
                option.textContent = name;
                option.selected = code === i18n.lang;
                langSelect.appendChild(option);
            });
        }

        i18n.applyStatic(screen);
        return screen;
    },

    modeInfo(mode, dom = document, i18n) {
        const screen = clone(dom, "tpl-screen-mode-info");
        screen.querySelector('[data-field="modeName"]').textContent = i18n.t(`modes.${mode}.name`);
        fillModeInfoRules(dom, screen.querySelector('[data-field="rules"]'), mode, i18n);
        i18n.applyStatic(screen);
        return screen;
    },

    calibrationResult(sensitivity, dom = document, i18n) {
        const screen = clone(dom, "tpl-screen-calibration-result");
        const successEl = screen.querySelector('[data-role="calibration-success"]');
        const failedEl = screen.querySelector('[data-role="calibration-failed"]');
        const valueEl = screen.querySelector('[data-field="sensitivityValue"]');

        if (sensitivity != null) {
            if (valueEl) valueEl.textContent = `${Math.round(sensitivity * 100)}%`;
            if (failedEl) failedEl.hidden = true;
        } else {
            if (successEl) successEl.hidden = true;
        }

        i18n.applyStatic(screen);
        return screen;
    },

    keyboardCalibrationResult(dasMs, arrMs, dom = document, i18n) {
        const screen = clone(dom, "tpl-screen-keyboard-calibration-result");
        const successEl = screen.querySelector('[data-role="keyboard-calibration-success"]');
        const failedEl = screen.querySelector('[data-role="keyboard-calibration-failed"]');
        const dasEl = screen.querySelector('[data-field="dasValue"]');
        const arrEl = screen.querySelector('[data-field="arrValue"]');

        if (dasMs != null || arrMs != null) {
            if (dasEl) dasEl.textContent = dasMs != null ? `${Math.round(dasMs)} ms` : "-";
            if (arrEl) arrEl.textContent = arrMs != null ? `${Math.round(arrMs)} ms` : "-";
            if (failedEl) failedEl.hidden = true;
        } else {
            if (successEl) successEl.hidden = true;
        }

        i18n.applyStatic(screen);
        return screen;
    },

    countdown(number, tint, dom = document) {
        const screen = clone(dom, "tpl-screen-countdown");
        screen.querySelector('[data-role="countdown-screen"]').dataset.tint = tint;
        screen.querySelector('[data-field="number"]').textContent = number;
        return screen;
    },

    gameOverEntry(stats, list, highlightEntry, todayBestEntry, renderLeaderboard, dom = document, i18n, reason = "topOut") {
        const screen = clone(dom, "tpl-screen-gameover-entry");
        screen.querySelector('[data-field="playerName"]').textContent = highlightEntry?.name ?? "";
        screen.querySelector('[data-field="score"]').textContent = stats.score;
        screen.querySelector('[data-field="level"]').textContent = stats.level;
        screen.querySelector('[data-field="lines"]').textContent = stats.lines;

        const headerTimeEl = screen.querySelector('[data-role="gameover-header-time"]');
        const isTimedRaceMode = stats.mode === "sprint" || stats.mode === "cheeseRace";
        if (headerTimeEl) {
            if (isTimedRaceMode) {
                headerTimeEl.querySelector('[data-field="headerTime"]').textContent = stats.gameTime;
            } else {
                headerTimeEl.remove();
            }
        }

        screen.querySelector('[data-field="gameTime"]').textContent = stats.gameTime;
        screen.querySelector('[data-field="maxDrought"]').textContent = stats.maxDrought;

        const droughtTotalEl = screen.querySelector('[data-field="droughtTotal"]');
        if (droughtTotalEl) droughtTotalEl.textContent = stats.droughtTotal;

        const droughtAvgEl = screen.querySelector('[data-field="droughtAvg"]');
        if (droughtAvgEl) droughtAvgEl.textContent = stats.droughtAvg;

        const burnEl = screen.querySelector('[data-field="burn"]');
        if (burnEl) burnEl.textContent = stats.burn;

        const transitionEl = screen.querySelector('[data-field="transitionScore"]');
        if (transitionEl) transitionEl.textContent = stats.transitionScore;

        screen.querySelector('[data-field="tetrisRate"]').textContent = stats.tetrisRate;
        screen.querySelector('[data-field="clearBreakdown"]').textContent =
            `${stats.singles} / ${stats.doubles} / ${stats.triples} / ${stats.tetrises}`;
        screen.querySelector('[data-field="pps"]').textContent = stats.pps;
        screen.querySelector('[data-field="spinsBreakdown"]').textContent =
            `${stats.tSpins} / ${stats.tSpinMinis} / ${stats.otherSpins}`;
        screen.querySelector('[data-field="maxCombo"]').textContent = stats.maxCombo;
        screen.querySelector('[data-field="efficiency"]').textContent = stats.efficiency;

        const todayBestRow = screen.querySelector('[data-role="today-best-row"]');
        if (todayBestEntry) {
            screen.querySelector('[data-field="todayBest"]').textContent = formatNumber(todayBestEntry.score);
            screen.querySelector('[data-field="todayBestName"]').textContent = todayBestEntry.name;
        } else if (todayBestRow) {
            todayBestRow.remove();
        }

        screen.querySelector('[data-field="leaderboard"]').appendChild(renderLeaderboard(list, highlightEntry));
        i18n.applyStatic(screen);

        // Sprint/Ultra finishing on their own terms aren't a "GAME OVER" -
        // swap in a mode-specific title. topOut (and any other/unknown
        // reason) keeps whatever applyStatic() already set above.
        const titleKeyByReason = {
            sprintComplete: "screens.gameOverEntry.titleSprintComplete",
            timeUp: "screens.gameOverEntry.titleTimeUp",
            cheeseClear: "screens.gameOverEntry.titleCheeseClear",
            digComplete: "screens.gameOverEntry.titleDigComplete",
        };
        const titleKey = titleKeyByReason[reason];
        if (titleKey) {
            const titleEl = screen.querySelector('[data-field="title"]');
            if (titleEl) titleEl.textContent = i18n.t(titleKey);
        }

        return screen;
    },

    gameOverSaved(list, highlightEntry, renderLeaderboard, selectedDifficulty, difficulties, selectedMode, gameModes, dom = document, i18n, playerName = "") {
        const screen = clone(dom, "tpl-screen-gameover-saved");
        fillDifficultyCarousel(screen.querySelector('[data-role="difficulty-select"]'), selectedDifficulty, difficulties, i18n);
        fillModeCarousel(screen.querySelector('[data-role="mode-select"]'), selectedMode, i18n);
        fillModeDescription(screen.querySelector('[data-field="modeDescription"]'), selectedMode, i18n);
        screen.querySelector('[data-role="name-input"]').value = playerName;
        screen.querySelector('[data-field="leaderboard"]').appendChild(renderLeaderboard(list, highlightEntry));
        i18n.applyStatic(screen);
        return screen;
    },
};
