"use strict";

import {formatNumber} from "../shared/utils.js";
import {SOUND_FILES} from "../shared/config.js";

function clone(dom, templateId) {
    return dom.getElementById(templateId).content.cloneNode(true);
}

function fillDifficultyButtons(dom, container, selectedDifficulty, difficulties, i18n) {
    Object.entries(difficulties).forEach(([key, def]) => {
        const button = clone(dom, "tpl-difficulty-button").querySelector('[data-role="difficulty-button"]');
        button.dataset.difficulty = key;
        button.classList.toggle("difficulty__button--active", key === selectedDifficulty);
        button.querySelector('[data-field="label"]').textContent = i18n.t(`difficulty.${key}`);
        button.querySelector('[data-field="level"]').textContent = i18n.t("difficulty.levelPrefix", {level: def.startLevel});
        container.appendChild(button);
    });
}

function fillModeButtons(dom, container, selectedMode, gameModes, i18n) {
    Object.keys(gameModes).forEach((key) => {
        const button = clone(dom, "tpl-mode-button").querySelector('[data-role="mode-button"]');
        button.dataset.mode = key;
        button.classList.toggle("difficulty__button--active", key === selectedMode);
        button.querySelector('[data-field="label"]').textContent = i18n.t(`modes.${key}.name`);
        button.querySelector('[data-field="description"]').textContent = i18n.t(`modes.${key}.description`);
        container.appendChild(button);
    });
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

export const Screens = {
    loading(title, text, dom = document) {
        const screen = clone(dom, "tpl-screen-loading");
        screen.querySelector('[data-field="title"]').textContent = title;
        screen.querySelector('[data-field="hint"]').textContent = text;
        return screen;
    },

    idle(list, selectedDifficulty, difficulties, selectedMode, gameModes, renderLeaderboard, dom = document, i18n, playerName = "") {
        const screen = clone(dom, "tpl-screen-idle");
        fillDifficultyButtons(dom, screen.querySelector('[data-field="difficulty"]'), selectedDifficulty, difficulties, i18n);
        fillModeButtons(dom, screen.querySelector('[data-field="mode"]'), selectedMode, gameModes, i18n);
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
        fillDifficultyButtons(dom, screen.querySelector('[data-field="difficulty"]'), selectedDifficulty, difficulties, i18n);
        fillModeButtons(dom, screen.querySelector('[data-field="mode"]'), selectedMode, gameModes, i18n);
        screen.querySelector('[data-role="name-input"]').value = playerName;
        screen.querySelector('[data-field="leaderboard"]').appendChild(renderLeaderboard(list, highlightEntry));
        i18n.applyStatic(screen);
        return screen;
    },
};
