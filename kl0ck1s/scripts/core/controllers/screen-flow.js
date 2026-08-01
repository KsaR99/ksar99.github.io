"use strict";

import {APP_NAME, COUNTDOWN_STEPS, NICKNAME_PATTERN} from "../game/game-constants.js";

/**
 * Owns the non-gameplay screen state machine: idle, countdown, pause, the
 * game-over entry/saved flow and the options menu. Talks to `screens`/`hud`
 * to render, and back into DifficultyController/SettingsController for the
 * bits those screens expose (difficulty picker, options toggles).
 */
export class ScreenFlow {
    constructor(game) {
        this.game = game;
    }

    renderLeaderboard(list, highlightEntry = null) {
        return this.game.leaderboard.renderTable(list, highlightEntry);
    }

    async showIdleScreen() {
        const game = this.game;
        game.state = "idle";
        game.isPlayingSession = false;
        game.hud.setPlaying(false);
        game.hud.setHasPlayedBefore(false);
        game.hud.showScreen(game.screens.loading(
            APP_NAME, game.i18n.t("screens.loading.leaderboardHint"), game.dom
        ));

        const [list, lastName] = await Promise.all([
            game.leaderboard.load(),
            game.leaderboard.loadLastName(),
        ]);
        if (game.state !== "idle") return;

        game.playerName = lastName;
        this.renderIdleScreen(list);
        game.hud.update(game.stats);
    }

    renderIdleScreen(list) {
        const game = this.game;
        game.currentIdleList = list;
        game.hud.showScreen(
            game.screens.idle(
                list, game.difficulty, game.difficulties, (l, h) => this.renderLeaderboard(l, h), game.dom, game.i18n, game.playerName
            )
        );
        game.difficultyController.bindDifficultyButtons(() => this.renderIdleScreen(list));
        this.bindNameInput();
        this.bindStartButton();
        this.bindOverlayShortcuts();
    }

    bindOverlayShortcuts() {
        const game = this.game;
        if (!game.dom) return;
        const overlay = game.dom.getElementById("overlay");
        game.inputController.bindKeyActionElements(overlay);
    }

    bindStartButton() {
        const game = this.game;
        if (!game.dom) return;
        const button = game.dom.querySelector('[data-role="start-button"]');
        if (!button) return;
        button.addEventListener("click", () => this.handleEnter());
    }

    bindNameInput() {
        const game = this.game;
        if (!game.dom) return;
        const input = game.dom.querySelector('[data-role="name-input"]');
        if (!input) return;

        input.value = game.playerName || "";
        input.addEventListener("input", (e) => {
            e.target.value = e.target.value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 16);
            game.playerName = e.target.value;
            input.classList.remove("nickname-form__input--invalid");
        });
        input.addEventListener("change", () => {
            game.leaderboard.setLastName(game.playerName);
        });
    }

    startCountdown() {
        const game = this.game;
        game.prepareNewRound();
        game.hud.setHasPlayedBefore(true);

        if (game.settings.skipCountdown) {
            this.start();
            return;
        }

        game.state = "countdown";
        game.isPlayingSession = false;
        game.hud.setPlaying(false);
        game.countdownIndex = 0;
        game.countdownTimer = 0;

        const {number, tint} = COUNTDOWN_STEPS[game.countdownIndex];
        game.hud.showScreen(
            game.screens.countdown(number, tint, game.dom),
            {transparentOverlay: true}
        );
    }

    advanceCountdownStep() {
        const game = this.game;
        const {number, tint} = COUNTDOWN_STEPS[game.countdownIndex];
        if (!game.hud.updateCountdown(number, tint)) {
            this.renderCountdownStep();
        }
    }

    renderCountdownStep() {
        const game = this.game;
        const {number, tint} = COUNTDOWN_STEPS[game.countdownIndex];
        game.hud.showScreen(
            game.screens.countdown(number, tint, game.dom),
            {transparentOverlay: true}
        );
    }

    start() {
        const game = this.game;
        game.state = "running";
        game.isPlayingSession = true;
        game.hud.setPlaying(true);
        game.hud.hideOverlay();
    }

    async gameOver() {
        const game = this.game;
        game.state = "gameOver-entry";
        game.isPlayingSession = false;
        game.hud.setPlaying(false);
        game.soundManager.play("gameOver");
        game.hud.showScreen(game.screens.loading(
            game.i18n.t("screens.gameOverEntry.title"), game.i18n.t("screens.loading.leaderboardHint"), game.dom
        ));

        await game.leaderboard.load();
        await game.leaderboard.loadTodayBest();
        if (game.state !== "gameOver-entry") return;

        const name = game.playerName || game.i18n.t("leaderboard.defaultName");
        const entry = {
            name,
            score: game.score,
            level: game.level,
            lines: game.lines,
            date: new Date().toISOString(),
        };

        const todayBestBeforeThisGame = game.leaderboard.todayBestEntry();

        const list = await game.leaderboard.add(entry);
        await game.leaderboard.recordIfTodayBest(entry);
        if (game.state !== "gameOver-entry") return;

        this.renderGameOverEntry(list, entry, todayBestBeforeThisGame);
    }

    exitToMenu() {
        const game = this.game;
        if (!["running", "paused", "countdown", "clearing"].includes(game.state)) return;
        game.pieceController.stopGameplaySounds();
        this.showIdleScreen().then();
    }

    renderGameOverEntry(list, entry, todayBestBeforeThisGame) {
        const game = this.game;
        game.currentGameOverEntry = {list, entry, todayBestBeforeThisGame};
        game.hud.showScreen(
            game.screens.gameOverEntry(
                game.stats, list, entry, todayBestBeforeThisGame, (l, h) => this.renderLeaderboard(l, h), game.dom, game.i18n
            )
        );
        this.bindGameOverContinue();
    }

    bindGameOverContinue() {
        const game = this.game;
        if (!game.dom) return;
        const button = game.dom.querySelector('[data-role="gameover-continue-button"]');
        if (!button) return;
        button.addEventListener("click", () => this.continueFromGameOverEntry(), {once: true});
    }

    continueFromGameOverEntry() {
        const game = this.game;
        if (game.state !== "gameOver-entry" || !game.currentGameOverEntry) return;
        const {list, entry} = game.currentGameOverEntry;
        game.state = "gameOver-saved";
        game.level = game.difficulties[game.difficulty].startLevel;
        game.lines = 0;
        game.hud.update(game.stats);
        this.renderGameOverSaved(list, entry);
    }

    renderGameOverSaved(list, entry) {
        const game = this.game;
        game.currentGameOverSaved = {list, entry};
        game.hud.showScreen(
            game.screens.gameOverSaved(
                list, entry, (l, h) => this.renderLeaderboard(l, h),
                game.difficulty, game.difficulties, game.dom, game.i18n, game.playerName
            )
        );
        game.difficultyController.bindDifficultyButtons(() => this.renderGameOverSaved(list, entry));
        this.bindNameInput();
        this.bindStartButton();
        this.bindOverlayShortcuts();
    }

    togglePause() {
        const game = this.game;
        if (game.state === "running") {
            game.state = "paused";
            game.pieceController.stopGameplaySounds();
            this.renderPauseMenu();
        } else if (game.state === "paused") {
            game.state = "running";
            game.hud.hideOverlay();
        }
    }

    restart() {
        const game = this.game;
        if (!["running", "paused", "clearing", "countdown", "gameOver-entry", "gameOver-saved"].includes(game.state)) {
            return;
        }
        this.startCountdown();
    }

    handleEscape() {
        if (this.game.state === "options") {
            this.toggleOptions();
        } else {
            this.togglePause();
        }
    }

    renderPauseMenu() {
        const game = this.game;
        game.hud.showScreen(game.screens.paused(game.dom, game.i18n));
        this.bindPauseMenu();
    }

    bindPauseMenu() {
        const game = this.game;
        if (!game.dom) return;
        const resumeButton = game.dom.querySelector('[data-role="resume-button"]');
        const resumeKey = game.dom.querySelector('[data-role="resume-key"]');
        const optionsKey = game.dom.querySelector('[data-role="options-open-key"]');

        if (resumeButton) {
            resumeButton.addEventListener("click", () => this.togglePause());
        }
        if (resumeKey) {
            resumeKey.addEventListener("click", () => this.togglePause());
        }
        if (optionsKey) {
            optionsKey.addEventListener("click", () => this.toggleOptions());
        }
    }

    handleEnter() {
        const game = this.game;
        if (game.state === "idle" || game.state === "gameOver-saved") {
            if (!this.isNicknameValid()) return;
            if (game.playerName) game.leaderboard.setLastName(game.playerName);
            this.startCountdown();
        } else if (game.state === "gameOver-entry") {
            this.continueFromGameOverEntry();
        }
    }

    isNicknameValid() {
        const game = this.game;
        if (!game.dom) return true;
        const input = game.dom.querySelector('[data-role="name-input"]');
        if (!input) return true;

        const valid = NICKNAME_PATTERN.test(game.playerName || "");
        input.classList.toggle("nickname-form__input--invalid", !valid);
        if (!valid) {
            input.reportValidity();
            input.focus();
        }
        return valid;
    }

    refreshCurrentScreen() {
        const game = this.game;
        if (game.state === "idle") {
            this.renderIdleScreen(game.currentIdleList ?? []);
        } else if (game.state === "paused") {
            this.renderPauseMenu();
        } else if (game.state === "options") {
            this.renderOptionsMenu();
        } else if (game.state === "gameOver-saved" && game.currentGameOverSaved) {
            const {list, entry} = game.currentGameOverSaved;
            this.renderGameOverSaved(list, entry);
        }
    }

    refreshLanguage() {
        const game = this.game;
        if (game.dom) game.i18n.applyStatic(game.dom);
        game.hud.setPlaying(game.isPlayingSession);
        game.hud.update(game.stats);
        this.refreshCurrentScreen();
    }

    bindLangSelect() {
        const game = this.game;
        if (!game.dom) return;
        const select = game.dom.querySelector('[data-role="lang-select"]');
        if (!select) return;

        select.addEventListener("change", async () => {
            const lang = select.value;
            if (lang === game.i18n.lang) return;

            await game.i18n.setLanguage(lang);
            this.refreshLanguage();
        });
    }

    toggleOptions() {
        const game = this.game;
        if (game.state === "options") {
            const previousState = game.previousStateBeforeOptions ?? "idle";
            game.previousStateBeforeOptions = null;
            game.state = previousState;

            if (previousState === "running") {
                game.hud.hideOverlay();
            } else if (previousState === "paused") {
                this.renderPauseMenu();
            } else if (previousState === "idle") {
                this.renderIdleScreen(game.currentIdleList ?? []);
            } else if (previousState === "gameOver-saved" && game.currentGameOverSaved) {
                const {list, entry} = game.currentGameOverSaved;
                this.renderGameOverSaved(list, entry);
            } else if (previousState === "gameOver-entry" && game.currentGameOverEntry) {
                const {list, entry, todayBestBeforeThisGame} = game.currentGameOverEntry;
                this.renderGameOverEntry(list, entry, todayBestBeforeThisGame);
            }

            return;
        }

        if (!["idle", "running", "paused", "gameOver-saved", "gameOver-entry"].includes(game.state)) return;

        game.previousStateBeforeOptions = game.state;
        if (game.state === "running") game.pieceController.stopGameplaySounds();
        game.state = "options";
        this.renderOptionsMenu();
    }

    renderOptionsMenu() {
        const game = this.game;
        game.hud.showScreen(game.screens.options(game.settings, game.dom, game.i18n, game.soundManager));
        this.bindOptionsMenu();
    }

    bindOptionsMenu() {
        const game = this.game;
        if (!game.dom) return;
        const settingsController = game.settingsController;

        const muteCheckbox = game.dom.querySelector('[data-role="mute-checkbox"]');
        const volumeSlider = game.dom.querySelector('[data-role="volume-slider"]');
        const hudRightCheckbox = game.dom.querySelector('[data-role="hud-right-checkbox"]');
        const ghostCheckbox = game.dom.querySelector('[data-role="ghost-checkbox"]');
        const gridCheckbox = game.dom.querySelector('[data-role="grid-checkbox"]');
        const glowCheckbox = game.dom.querySelector('[data-role="glow-checkbox"]');
        const transparencyCheckbox = game.dom.querySelector('[data-role="transparency-checkbox"]');
        const fallTrailCheckbox = game.dom.querySelector('[data-role="fall-trail-checkbox"]');
        const effectSelect = game.dom.querySelector('[data-role="effect-select"]');
        const skipCountdownCheckbox = game.dom.querySelector('[data-role="skip-countdown-checkbox"]');
        const mouseControlCheckbox = game.dom.querySelector('[data-role="mouse-control-checkbox"]');
        const closeButton = game.dom.querySelector('[data-role="options-close-button"]');
        const closeKey = game.dom.querySelector('[data-role="options-close-key"]');

        if (muteCheckbox) {
            muteCheckbox.addEventListener("change", () => {
                game.settings.muted = muteCheckbox.checked;
                game.soundManager.setMuted(game.settings.muted);
                if (volumeSlider) volumeSlider.disabled = game.settings.muted;
                settingsController.saveSettings();
            });
        }

        if (volumeSlider) {
            volumeSlider.addEventListener("input", () => {
                game.settings.volume = volumeSlider.value / 100;
                game.soundManager.setVolume(game.settings.volume);
                settingsController.saveSettings();
            });
        }

        if (hudRightCheckbox) {
            hudRightCheckbox.addEventListener("change", () => {
                game.settings.hudRight = hudRightCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
            });
        }

        if (ghostCheckbox) {
            ghostCheckbox.addEventListener("change", () => {
                game.settings.ghost = ghostCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
            });
        }

        if (gridCheckbox) {
            gridCheckbox.addEventListener("change", () => {
                game.settings.gridLines = gridCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
            });
        }

        if (glowCheckbox) {
            glowCheckbox.addEventListener("change", () => {
                game.settings.glow = glowCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
            });
        }

        if (transparencyCheckbox) {
            transparencyCheckbox.addEventListener("change", () => {
                game.settings.transparency = transparencyCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
            });
        }

        if (fallTrailCheckbox) {
            fallTrailCheckbox.addEventListener("change", () => {
                game.settings.fallTrail = fallTrailCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
            });
        }

        if (effectSelect) {
            effectSelect.addEventListener("change", () => {
                game.settings.effect = effectSelect.value;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
            });
        }

        if (skipCountdownCheckbox) {
            skipCountdownCheckbox.addEventListener("change", () => {
                game.settings.skipCountdown = skipCountdownCheckbox.checked;
                settingsController.saveSettings();
            });
        }

        if (mouseControlCheckbox) {
            mouseControlCheckbox.addEventListener("change", () => {
                game.settings.mouseControl = mouseControlCheckbox.checked;
                settingsController.saveSettings();
            });
        }

        // Category (sfx/music) volume sliders - there's at most one per
        // category so a plain querySelectorAll + forEach is enough, unlike
        // the per-sound rows below which are built dynamically.
        game.dom.querySelectorAll('[data-role="category-volume-slider"]').forEach((slider) => {
            slider.addEventListener("input", () => {
                const category = slider.dataset.category;
                const volume = slider.value / 100;
                game.settings.categoryVolumes = {...game.settings.categoryVolumes, [category]: volume};
                game.soundManager.setCategoryVolume(category, volume);
                settingsController.saveSettings();
            });
        });

        // Per-sound rows are generated from SOUND_FILES, so their sliders/
        // preview buttons are bound once via delegation on each sound-list
        // container instead of one listener per row.
        game.dom.querySelectorAll('[data-role="sound-list"]').forEach((list) => {
            list.addEventListener("input", (event) => {
                const slider = event.target.closest('[data-role="sound-volume-slider"]');
                if (!slider) return;
                const key = slider.dataset.soundKey;
                const volume = slider.value / 100;
                game.settings.soundVolumes = {...game.settings.soundVolumes, [key]: volume};
                game.soundManager.setSoundVolume(key, volume);
                settingsController.saveSettings();
            });

            list.addEventListener("click", (event) => {
                const button = event.target.closest('[data-role="sound-preview-button"]');
                if (!button) return;
                game.soundManager.preview(button.dataset.soundKey);
            });
        });

        if (closeButton) {
            closeButton.addEventListener("click", () => this.toggleOptions());
        }

        if (closeKey) {
            closeKey.addEventListener("click", () => this.toggleOptions());
        }

        this.bindLangSelect();
    }
}
