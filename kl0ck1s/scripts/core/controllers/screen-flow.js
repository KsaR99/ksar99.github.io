"use strict";

import {
    APP_NAME,
    ARR_MAX,
    ARR_MIN,
    ARR_STEP,
    COUNTDOWN_STEPS,
    DAS_MAX,
    DAS_MIN,
    DAS_STEP,
    NICKNAME_PATTERN,
    SENSITIVITY_MAX,
    SENSITIVITY_MIN,
    SENSITIVITY_STEP,
} from "../game/game-constants.js";

function clampToStep(value, min, max, step) {
    const clamped = Math.max(min, Math.min(max, value));
    return Math.round(clamped / step) * step;
}

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
        game.menuSelector = "mode";
        game.isPlayingSession = false;
        game.hud.setPlaying(false);
        game.hud.setHasPlayedBefore(false);
        game.modeController.restoreSelectedMode();
        game.hud.showScreen(game.screens.loading(
            APP_NAME, game.i18n.t("screens.loading.leaderboardHint"), game.dom
        ));

        const [, lastName] = await Promise.all([
            game.leaderboard.load(),
            game.leaderboard.loadLastName(),
        ]);
        if (game.state !== "idle") return;

        game.playerName = lastName;
        this.renderIdleScreen(game.leaderboard.forMode(game.mode));
        game.hud.update(game.stats);
    }

    renderIdleScreen(list) {
        const game = this.game;
        game.currentIdleList = list;
        game.hud.showScreen(
            game.screens.idle(
                list, game.difficulty, game.difficulties, game.mode, game.gameModes,
                (l, h) => this.renderLeaderboard(l, h), game.dom, game.i18n, game.playerName
            )
        );
        game.difficultyController.bindDifficultyButtons();
        game.modeController.bindModeButtons();
        this.bindNameInput();
        this.bindStartButton();
        this.bindOverlayShortcuts();
        this.updateMenuSelectorFocus();
    }

    moveMenuFocus(dir) {
        const game = this.game;
        if (game.state !== "idle" && game.state !== "gameOver-saved") return;

        const groups = ["mode", "difficulty", "nickname"];
        const currentIndex = groups.indexOf(game.menuSelector);
        const nextIndex = Math.max(0, Math.min(groups.length - 1, currentIndex + dir));
        if (nextIndex === currentIndex) return;

        game.menuSelector = groups[nextIndex];
        this.updateMenuSelectorFocus();
    }

    updateMenuSelectorFocus() {
        const game = this.game;
        if (!game.dom) return;
        const difficultyEl = game.dom.querySelector('[data-role="difficulty-select"]');
        const modeEl = game.dom.querySelector('[data-role="mode-select"]');
        const nameInput = game.dom.querySelector('[data-role="name-input"]');
        if (difficultyEl) difficultyEl.classList.toggle("difficulty--focused", game.menuSelector === "difficulty");
        if (modeEl) modeEl.classList.toggle("difficulty--focused", game.menuSelector === "mode");
        if (nameInput && game.menuSelector === "nickname" && game.dom.activeElement !== nameInput) {
            nameInput.focus();
        }
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

        input.addEventListener("keydown", (e) => {
            if (e.key === "ArrowUp") {
                e.preventDefault();
                input.blur();
                this.moveMenuFocus(-1);
            }
        });

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

    showModeInfo() {
        const game = this.game;
        if (game.settings.skipModeInfo) {
            this.startCountdown();
            return;
        }

        game.state = "modeInfo";
        game.isPlayingSession = false;
        game.hud.setPlaying(false);
        game.hud.showScreen(game.screens.modeInfo(game.mode, game.dom, game.i18n));
        this.bindModeInfoContinue();
    }

    bindModeInfoContinue() {
        const game = this.game;
        if (!game.dom) return;
        const button = game.dom.querySelector('[data-role="mode-info-continue-button"]');
        if (!button) return;
        button.addEventListener("click", () => this.startCountdown(), {once: true});
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
        game.musicDirector.start(game.board);
    }

    async gameOver() {
        return this.endRound("topOut");
    }


    async endRound(reason = "topOut") {
        const game = this.game;
        game.state = "gameOver-entry";
        game.isPlayingSession = false;
        game.hud.setPlaying(false);
        game.musicDirector.stop();
        game.pieceController.stopGameplaySounds();
        game.soundManager.play(reason === "topOut" ? "gameOver" : "levelUp");
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
            mode: game.mode,
            timeMs: game.elapsedMs,
        };

        const raceUnfinished =
            (game.mode === "sprint" && reason !== "sprintComplete") ||
            (game.mode === "cheeseRace" && reason !== "cheeseClear");
        const savedEntry = raceUnfinished ? null : entry;

        const todayBestBeforeThisGame = game.mode === "marathon" ? game.leaderboard.todayBestEntry() : null;

        let list = game.leaderboard.forMode(game.mode);
        if (savedEntry) {
            list = await game.leaderboard.add(savedEntry);
            if (game.mode === "marathon") await game.leaderboard.recordIfTodayBest(savedEntry);
        }
        if (game.state !== "gameOver-entry") return;

        this.renderGameOverEntry(list, savedEntry, todayBestBeforeThisGame, reason);
    }

    exitToMenu() {
        const game = this.game;
        if (!["running", "paused", "countdown", "clearing"].includes(game.state)) return;
        game.pieceController.stopGameplaySounds();
        game.musicDirector.stop();
        this.showIdleScreen().then();
    }

    renderGameOverEntry(list, entry, todayBestBeforeThisGame, reason = "topOut") {
        const game = this.game;
        game.currentGameOverEntry = {list, entry, todayBestBeforeThisGame, reason};
        game.hud.showScreen(
            game.screens.gameOverEntry(
                game.stats, list, entry, todayBestBeforeThisGame,
                (l, h) => this.renderLeaderboard(l, h), game.dom, game.i18n, reason
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
        game.menuSelector = "mode";
        game.level = game.difficulties[game.difficulty].startLevel;
        game.lines = 0;
        game.modeController.restoreSelectedMode();
        game.hud.update(game.stats);
        this.renderGameOverSaved(list, entry);
    }

    renderGameOverSaved(list, entry) {
        const game = this.game;
        game.currentGameOverSaved = {list, entry};
        game.hud.showScreen(
            game.screens.gameOverSaved(
                list, entry, (l, h) => this.renderLeaderboard(l, h),
                game.difficulty, game.difficulties, game.mode, game.gameModes, game.dom, game.i18n, game.playerName
            )
        );
        game.difficultyController.bindDifficultyButtons();
        game.modeController.bindModeButtons();
        this.bindNameInput();
        this.bindStartButton();
        this.bindOverlayShortcuts();
        this.updateMenuSelectorFocus();
    }

    togglePause() {
        const game = this.game;
        if (game.state === "running") {
            game.state = "paused";
            game.pieceController.stopGameplaySounds();
            game.musicDirector.pause();
            this.renderPauseMenu();
        } else if (game.state === "paused") {
            game.state = "running";
            game.hud.hideOverlay();
            game.musicDirector.resume();
        }
    }

    restart() {
        const game = this.game;
        if (!["running", "paused", "clearing", "countdown", "gameOver-entry", "gameOver-saved"].includes(game.state)) {
            return;
        }

        game.modeController.resolveRandomMode();
        this.startCountdown();
    }

    handleEscape() {
        if (this.game.state === "options") {
            this.toggleOptions();
        } else if (this.game.state === "calibrating" || this.game.state === "calibrating-result") {
            this.game.sensitivityCalibrationController.cancel();
        } else if (this.game.state === "calibrating-keyboard" || this.game.state === "calibrating-keyboard-result") {
            this.game.keyboardCalibrationController.cancel();
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
            game.modeController.resolveRandomMode();
            this.showModeInfo();
        } else if (game.state === "gameOver-entry") {
            this.continueFromGameOverEntry();
        } else if (game.state === "modeInfo") {
            this.startCountdown();
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
            game.soundManager.stopPreview();
            const previousState = game.previousStateBeforeOptions ?? "idle";
            game.previousStateBeforeOptions = null;
            game.state = previousState;

            if (previousState === "running") {
                game.hud.hideOverlay();
                game.musicDirector.resume();
            } else if (previousState === "paused") {
                this.renderPauseMenu();
            } else if (previousState === "idle") {
                this.renderIdleScreen(game.currentIdleList ?? []);
            } else if (previousState === "gameOver-saved" && game.currentGameOverSaved) {
                const {list, entry} = game.currentGameOverSaved;
                this.renderGameOverSaved(list, entry);
            } else if (previousState === "gameOver-entry" && game.currentGameOverEntry) {
                const {list, entry, todayBestBeforeThisGame, reason} = game.currentGameOverEntry;
                this.renderGameOverEntry(list, entry, todayBestBeforeThisGame, reason);
            }

            return;
        }

        if (!["idle", "running", "paused", "gameOver-saved", "gameOver-entry"].includes(game.state))
            return;

        game.previousStateBeforeOptions = game.state;
        if (game.state === "running") {
            game.pieceController.stopGameplaySounds();
            game.musicDirector.pause();
        }
        game.state = "options";
        this.renderOptionsMenu();
    }

    renderOptionsMenu() {
        const game = this.game;
        game.hud.showScreen(game.screens.options(game.settings, game.dom, game.i18n, game.soundManager));
        this.bindOptionsMenu();
    }

    togglePreviewButton(button, list) {
        const game = this.game;
        const key = button.dataset.soundKey;

        list.querySelectorAll('[data-role="sound-preview-button"]').forEach((otherButton) => {
            if (otherButton !== button) this.setPreviewButtonState(otherButton, "play");
        });

        const rate = game.previewPlaybackRateFor(key);
        const state = game.soundManager.previewToggle(
            key, () => this.setPreviewButtonState(button, "play"), {playbackRate: rate}
        );
        this.setPreviewButtonState(button, state === "playing" ? "pause" : "play");
    }

    setPreviewButtonState(button, state) {
        const game = this.game;
        button.textContent = state === "pause" ? "⏸" : "▶";
        button.setAttribute(
            "aria-label",
            game.i18n.t(state === "pause" ? "screens.options.pause" : "screens.options.preview")
        );
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
        const mouseSensitivityInput = game.dom.querySelector('[data-role="mouse-sensitivity-input"]');
        const touchSensitivityInput = game.dom.querySelector('[data-role="touch-sensitivity-input"]');
        const keyboardDasInput = game.dom.querySelector('[data-role="keyboard-das-input"]');
        const keyboardArrInput = game.dom.querySelector('[data-role="keyboard-arr-input"]');
        const calibrateSensitivityButton = game.dom.querySelector('[data-role="calibrate-sensitivity-button"]');
        const calibrateKeyboardButton = game.dom.querySelector('[data-role="calibrate-keyboard-button"]');
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

        const skipModeInfoCheckbox = game.dom.querySelector('[data-role="skip-mode-info-checkbox"]');
        if (skipModeInfoCheckbox) {
            skipModeInfoCheckbox.addEventListener("change", () => {
                game.settings.skipModeInfo = skipModeInfoCheckbox.checked;
                settingsController.saveSettings();
            });
        }

        if (mouseControlCheckbox) {
            mouseControlCheckbox.addEventListener("change", () => {
                game.settings.mouseControl = mouseControlCheckbox.checked;
                if (mouseSensitivityInput) mouseSensitivityInput.disabled = !mouseControlCheckbox.checked;
                settingsController.saveSettings();
            });
        }

        if (mouseSensitivityInput) {
            mouseSensitivityInput.min = SENSITIVITY_MIN;
            mouseSensitivityInput.max = SENSITIVITY_MAX;
            mouseSensitivityInput.step = SENSITIVITY_STEP;
            mouseSensitivityInput.value = game.settings.mouseSensitivity ?? 1;
            mouseSensitivityInput.disabled = !game.settings.mouseControl;

            mouseSensitivityInput.addEventListener("change", () => {
                const parsed = parseFloat(mouseSensitivityInput.value);
                const value = clampToStep(
                    Number.isFinite(parsed) ? parsed : 1, SENSITIVITY_MIN, SENSITIVITY_MAX, SENSITIVITY_STEP
                );
                mouseSensitivityInput.value = value;
                game.settings.mouseSensitivity = value;
                settingsController.saveSettings();
            });
        }

        if (touchSensitivityInput) {
            touchSensitivityInput.min = SENSITIVITY_MIN;
            touchSensitivityInput.max = SENSITIVITY_MAX;
            touchSensitivityInput.step = SENSITIVITY_STEP;
            touchSensitivityInput.value = game.settings.touchSensitivity ?? "";

            touchSensitivityInput.addEventListener("change", () => {
                if (touchSensitivityInput.value === "") {
                    delete game.settings.touchSensitivity;
                    settingsController.saveSettings();
                    return;
                }
                const parsed = parseFloat(touchSensitivityInput.value);
                if (!Number.isFinite(parsed)) {
                    touchSensitivityInput.value = game.settings.touchSensitivity ?? "";
                    return;
                }
                const value = clampToStep(parsed, SENSITIVITY_MIN, SENSITIVITY_MAX, SENSITIVITY_STEP);
                touchSensitivityInput.value = value;
                game.settings.touchSensitivity = value;
                settingsController.saveSettings();
            });
        }

        if (keyboardDasInput) {
            keyboardDasInput.min = DAS_MIN;
            keyboardDasInput.max = DAS_MAX;
            keyboardDasInput.step = DAS_STEP;
            keyboardDasInput.value = game.settings.keyboardDAS ?? DAS_MIN;

            keyboardDasInput.addEventListener("change", () => {
                const parsed = parseFloat(keyboardDasInput.value);
                const value = clampToStep(
                    Number.isFinite(parsed) ? parsed : DAS_MIN, DAS_MIN, DAS_MAX, DAS_STEP
                );
                keyboardDasInput.value = value;
                game.settings.keyboardDAS = value;
                settingsController.saveSettings();
            });
        }

        if (keyboardArrInput) {
            keyboardArrInput.min = ARR_MIN;
            keyboardArrInput.max = ARR_MAX;
            keyboardArrInput.step = ARR_STEP;
            keyboardArrInput.value = game.settings.keyboardARR ?? ARR_MIN;

            keyboardArrInput.addEventListener("change", () => {
                const parsed = parseFloat(keyboardArrInput.value);
                const value = clampToStep(
                    Number.isFinite(parsed) ? parsed : ARR_MIN, ARR_MIN, ARR_MAX, ARR_STEP
                );
                keyboardArrInput.value = value;
                game.settings.keyboardARR = value;
                settingsController.saveSettings();
            });
        }

        if (calibrateSensitivityButton) {
            calibrateSensitivityButton.addEventListener("click", () => {
                game.sensitivityCalibrationController.start();
            });
        }

        if (calibrateKeyboardButton) {
            calibrateKeyboardButton.addEventListener("click", () => {
                game.keyboardCalibrationController.start();
            });
        }

        game.dom.querySelectorAll('[data-role="category-volume-slider"]').forEach((slider) => {
            slider.addEventListener("input", () => {
                const category = slider.dataset.category;
                const volume = slider.value / 100;
                game.settings.categoryVolumes = {...game.settings.categoryVolumes, [category]: volume};
                game.soundManager.setCategoryVolume(category, volume);
                settingsController.saveSettings();
            });
        });

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
                this.togglePreviewButton(button, list);
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
