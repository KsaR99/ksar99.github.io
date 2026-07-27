"use strict";

import {formatNumber} from "./utils.js";

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

export const Screens = {
    loading(title, text, dom = document) {
        const screen = clone(dom, "tpl-screen-loading");
        screen.querySelector('[data-field="title"]').textContent = title;
        screen.querySelector('[data-field="hint"]').textContent = text;
        return screen;
    },

    idle(list, selectedDifficulty, difficulties, renderLeaderboard, dom = document, i18n, playerName = "") {
        const screen = clone(dom, "tpl-screen-idle");
        fillDifficultyButtons(dom, screen.querySelector('[data-field="difficulty"]'), selectedDifficulty, difficulties, i18n);
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

    options(settings, dom = document, i18n) {
        const screen = clone(dom, "tpl-screen-options");
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

        const effectSelect = screen.querySelector('[data-role="effect-select"]');
        if (effectSelect) effectSelect.value = settings.effect ?? "vhs";

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

    countdown(number, tint, dom = document, i18n) {
        const screen = clone(dom, "tpl-screen-countdown");
        screen.querySelector('[data-role="countdown-screen"]').dataset.tint = tint;
        screen.querySelector('[data-field="number"]').textContent = number;
        return screen;
    },

    gameOverEntry(stats, list, highlightEntry, todayBestEntry, renderLeaderboard, dom = document, i18n) {
        const screen = clone(dom, "tpl-screen-gameover-entry");
        screen.querySelector('[data-field="playerName"]').textContent = highlightEntry?.name ?? "";
        screen.querySelector('[data-field="score"]').textContent = stats.score;
        screen.querySelector('[data-field="level"]').textContent = stats.level;
        screen.querySelector('[data-field="lines"]').textContent = stats.lines;

        screen.querySelector('[data-field="gameTime"]').textContent = stats.gameTime;
        screen.querySelector('[data-field="maxDrought"]').textContent = stats.maxDrought;
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
        return screen;
    },

    gameOverSaved(list, highlightEntry, renderLeaderboard, selectedDifficulty, difficulties, dom = document, i18n, playerName = "") {
        const screen = clone(dom, "tpl-screen-gameover-saved");
        fillDifficultyButtons(dom, screen.querySelector('[data-field="difficulty"]'), selectedDifficulty, difficulties, i18n);
        screen.querySelector('[data-role="name-input"]').value = playerName;
        screen.querySelector('[data-field="leaderboard"]').appendChild(renderLeaderboard(list, highlightEntry));
        i18n.applyStatic(screen);
        return screen;
    },
};
