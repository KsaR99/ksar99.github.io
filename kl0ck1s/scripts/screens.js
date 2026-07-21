"use strict";

function clone(dom, templateId) {
    return dom.getElementById(templateId).content.cloneNode(true);
}

function fillDifficultyButtons(dom, container, selectedDifficulty, difficulties) {
    Object.entries(difficulties).forEach(([key, def]) => {
        const button = clone(dom, "tpl-difficulty-button").querySelector('[data-role="difficulty-button"]');
        button.dataset.difficulty = key;
        button.classList.toggle("difficulty__button--active", key === selectedDifficulty);
        button.querySelector('[data-field="label"]').textContent = def.label;
        button.querySelector('[data-field="level"]').textContent = `poziom ${def.startLevel}`;
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

    idle(list, selectedDifficulty, difficulties, renderLeaderboard, dom = document) {
        const screen = clone(dom, "tpl-screen-idle");
        fillDifficultyButtons(dom, screen.querySelector('[data-field="difficulty"]'), selectedDifficulty, difficulties);
        screen.querySelector('[data-field="leaderboard"]').appendChild(renderLeaderboard(list));
        return screen;
    },

    paused({volumePercent, muted}, dom = document) {
        const screen = clone(dom, "tpl-screen-paused");
        const muteCheckbox = screen.querySelector('[data-role="mute-checkbox"]');
        const volumeSlider = screen.querySelector('[data-role="volume-slider"]');
        muteCheckbox.checked = muted;
        volumeSlider.value = volumePercent;
        volumeSlider.disabled = muted;
        return screen;
    },

    gameOverEntry(stats, list, renderLeaderboard, dom = document) {
        const screen = clone(dom, "tpl-screen-gameover-entry");
        screen.querySelector('[data-field="score"]').textContent = stats.score;
        screen.querySelector('[data-field="level"]').textContent = stats.level;
        screen.querySelector('[data-field="lines"]').textContent = stats.lines;
        screen.querySelector('[data-field="leaderboard"]').appendChild(renderLeaderboard(list));
        return screen;
    },

    gameOverSaved(list, highlightEntry, renderLeaderboard, selectedDifficulty, difficulties, dom = document) {
        const screen = clone(dom, "tpl-screen-gameover-saved");
        fillDifficultyButtons(dom, screen.querySelector('[data-field="difficulty"]'), selectedDifficulty, difficulties);
        screen.querySelector('[data-field="leaderboard"]').appendChild(renderLeaderboard(list, highlightEntry));
        return screen;
    },
};
