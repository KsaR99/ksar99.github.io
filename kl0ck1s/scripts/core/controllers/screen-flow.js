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
    SETTINGS_EXPORT_FILENAME,
} from "../game/game-constants.js";
import {copyTextToClipboard, debounce, isMobileViewport, numberToVoiceKeys} from "../shared/utils.js";
import {voiceCountingKey} from "../shared/config.js";
import {defaultKeyBindings} from "../shared/key-bindings.js";

function clampToStep(value, min, max, step) {
    const clamped = Math.max(min, Math.min(max, value));
    return Math.round(clamped / step) * step;
}

export class ScreenFlow {
    constructor(game) {
        this.game = game;
        this._pauseBlockedTimer = null;
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

        await game.leaderboard.loadLastName();
        await game.leaderboard.migrateLegacyScores();
        await Promise.all([
            game.leaderboard.load(),
            game.leaderboard.loadProfiles(),
            game.leaderboard.loadTrash(),
        ]);
        if (game.state !== "idle") return;

        game.playerName = game.leaderboard.profile;
        this.renderIdleScreen(game.leaderboard.forMode(game.mode));
        game.hud.update(game.stats);
    }

    renderIdleScreen(list) {
        const game = this.game;
        game.currentIdleList = list;
        game.hud.showScreen(
            game.screens.idle(
                list, game.difficulty, game.difficulties, game.mode, game.gameModes,
                (l, h) => this.renderLeaderboard(l, h), game.dom, game.i18n, game.playerName,
                game.leaderboard.profiles, game.leaderboard.trash
            )
        );
        game.difficultyController.bindDifficultyButtons();
        game.modeController.bindModeButtons();
        this.bindNameInput();
        this.bindProfileSelect();
        this.bindStartButton();
        this.bindLeaderboardActions();
        this.updateMenuSelectorFocus();
    }

    bindLeaderboardActions() {
        const game = this.game;
        if (!game.dom) return;
        const shareButton = game.dom.querySelector('[data-role="leaderboard-share-button"]');
        game.shareService.bindIconButton(shareButton, () => game.shareService.shareLeaderboard(game.mode));
    }

    async commitProfile(name) {
        const game = this.game;
        const trimmed = (name || "").trim();
        if (!trimmed) return;

        const changingProfile = trimmed !== game.leaderboard.profile;
        await game.leaderboard.switchProfile(trimmed);
        if (!changingProfile) return;

        const saved = await game.leaderboard.loadProfileSettings(trimmed);
        if (saved) {
            game.settingsController.applyStoredSettings(saved);
        }
        game.settings.mode = game.mode;
        game.settingsController.saveSettings();
    }

    async deleteProfile() {
        const game = this.game;
        const name = game.playerName;
        if (!name) return;

        const confirmed = await game.confirmDialog.ask(game.i18n.t("screens.idle.deleteProfileConfirm", {name}));
        if (!confirmed) return;

        await game.leaderboard.deleteProfile(name);
        game.playerName = game.leaderboard.profile;

        if (game.state === "idle") {
            this.renderIdleScreen(game.leaderboard.forMode(game.mode));
        } else if (game.state === "gameOver-saved" && game.currentGameOverSaved) {
            this.renderGameOverSaved(game.leaderboard.forMode(game.mode), null);
        }
        game.hud.update(game.stats);
    }

    async restoreProfile(name) {
        if (!name) return;
        const game = this.game;
        await game.leaderboard.restoreProfile(name);
        await this.switchProfile(name);
    }

    async switchProfile(name) {
        const game = this.game;
        await this.commitProfile(name);
        game.playerName = game.leaderboard.profile;

        if (game.state === "idle") {
            this.renderIdleScreen(game.leaderboard.forMode(game.mode));
        } else if (game.state === "gameOver-saved" && game.currentGameOverSaved) {
            const {entry} = game.currentGameOverSaved;
            this.renderGameOverSaved(game.leaderboard.forMode(game.mode), entry);
        }
        game.hud.update(game.stats);
    }

    async renameProfile(oldName, newName) {
        const game = this.game;
        const trimmed = (newName || "").trim();
        if (!trimmed || trimmed === oldName) return;

        await game.leaderboard.renameProfile(oldName, trimmed);
        game.playerName = game.leaderboard.profile;

        if (game.state === "idle") {
            this.renderIdleScreen(game.leaderboard.forMode(game.mode));
        } else if (game.state === "gameOver-saved" && game.currentGameOverSaved) {
            const {entry} = game.currentGameOverSaved;
            this.renderGameOverSaved(game.leaderboard.forMode(game.mode), entry);
        }
        game.hud.update(game.stats);
    }

    isCreatingNewProfile() {
        const game = this.game;
        if (!game.dom) return true;
        const select = game.dom.querySelector('[data-role="profile-select"]');
        return !select || select.value === "";
    }

    bindProfileSelect() {
        const game = this.game;
        if (!game.dom) return;
        const select = game.dom.querySelector('[data-role="profile-select"]');
        if (select) {
            select.addEventListener("change", () => {
                const value = select.value;
                if (!value) {
                    const input = game.dom.querySelector('[data-role="name-input"]');
                    game.playerName = "";
                    if (input) {
                        input.value = "";
                        input.focus();
                    }
                    this.updateDeleteProfileButtonState();
                    return;
                }
                if (value.startsWith("restore:")) {
                    this.restoreProfile(value.slice("restore:".length));
                    return;
                }
                this.switchProfile(value);
            });
        }

        this.bindDeleteProfileButton();
    }

    bindDeleteProfileButton() {
        const game = this.game;
        if (!game.dom) return;
        const button = game.dom.querySelector('[data-role="delete-profile-button"]');
        if (!button) return;
        button.addEventListener("click", () => this.deleteProfile());
        this.updateDeleteProfileButtonState();
    }

    updateDeleteProfileButtonState() {
        const game = this.game;
        if (!game.dom) return;
        const button = game.dom.querySelector('[data-role="delete-profile-button"]');
        if (button) button.disabled = !game.playerName;
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
        this.updateDeleteProfileButtonState();
        input.addEventListener("input", (e) => {
            e.target.value = e.target.value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 16);
            game.playerName = e.target.value;
            input.classList.remove("nickname-form__input--invalid");
            this.updateDeleteProfileButtonState();
        });
        input.addEventListener("change", () => {
            if (!game.playerName) return;
            if (this.isCreatingNewProfile() || !game.leaderboard.profile) {
                this.switchProfile(game.playerName);
            } else {
                this.renameProfile(game.leaderboard.profile, game.playerName);
            }
        });
    }

    showModeInfo() {
        const game = this.game;

        if (game.settings.skipModeInfo || game.multiplayerConnected) {
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
        game.soundManager.unlock();
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
        game.soundManager.play(voiceCountingKey(number));
        game.hud.showScreen(
            game.screens.countdown(number, tint, game.dom),
            {transparentOverlay: true}
        );
        this.updateCountdownBar(true);
    }

    updateCountdownBar(reset = false) {
        const game = this.game;
        if (!game.dom) return;
        const bar = game.dom.querySelector('[data-role="countdown-progress-bar"]');
        if (!bar) return;

        const targetPercent = ((game.countdownIndex + 1) / COUNTDOWN_STEPS.length) * 100;

        if (reset) {
            bar.style.transition = "none";
            bar.style.width = "0%";
            void bar.offsetWidth;
        }
        bar.style.transition = `width ${game.countdownStepDuration}ms linear`;
        bar.style.width = `${targetPercent}%`;
    }

    advanceCountdownStep() {
        const game = this.game;
        const {number, tint} = COUNTDOWN_STEPS[game.countdownIndex];
        game.soundManager.play(voiceCountingKey(number));
        if (!game.hud.updateCountdown(number, tint)) {
            this.renderCountdownStep();
        }
        this.updateCountdownBar();
    }

    renderCountdownStep() {
        const game = this.game;
        const {number, tint} = COUNTDOWN_STEPS[game.countdownIndex];
        game.hud.showScreen(
            game.screens.countdown(number, tint, game.dom),
            {transparentOverlay: true}
        );

        const bar = game.dom?.querySelector('[data-role="countdown-progress-bar"]');
        if (bar) {
            bar.style.transition = "none";
            bar.style.width = `${(game.countdownIndex / COUNTDOWN_STEPS.length) * 100}%`;
            void bar.offsetWidth;
        }
    }

    start() {
        const game = this.game;
        game.state = "running";
        game.isPlayingSession = true;
        game.hud.setPlaying(true, game.mode);
        game.hud.hideOverlay();
        game.musicDirector.start(game.board);

        if (!game.settings.skipCountdown) {
            game.soundManager.playSequence([
                "voiceLetsGo",
                "voiceLevel",
                ...numberToVoiceKeys(game.level),
            ]);
        }
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
        game.pieceController.stopAllGameplaySounds();
        if (reason === "topOut") {
            game.soundManager.play("gameOver");
            game.soundManager.play("voiceGameOver");
        } else {
            game.soundManager.play("levelUp");
        }
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
        if (!["running", "paused", "countdown", "clearing", "modeInfo"].includes(game.state)) return;

        if (game.multiplayerConnected && game.multiplayerController) {
            game.multiplayerController.leaveMatch();
            return;
        }

        game.pieceController.stopAllGameplaySounds();
        game.musicDirector.stop(0);
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
        this.bindGameOverShare();
        this.bindLeaderboardActions();
    }

    bindGameOverShare() {
        const game = this.game;
        if (!game.dom) return;
        const button = game.dom.querySelector('[data-role="gameover-share-button"]');
        game.shareService.bindLabeledButton(button, () => game.shareService.shareRun());
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
        game.modeController.restoreSelectedMode();
        game.statsTracker.reset();
        game.modeController.reset();
        game.hud.update(game.stats);
        this.renderGameOverSaved(list, entry);
    }

    renderGameOverSaved(list, entry) {
        const game = this.game;
        game.currentGameOverSaved = {list, entry};
        game.hud.showScreen(
            game.screens.gameOverSaved(
                list, entry, (l, h) => this.renderLeaderboard(l, h),
                game.difficulty, game.difficulties, game.mode, game.gameModes, game.dom, game.i18n, game.playerName,
                game.leaderboard.profiles, game.leaderboard.trash
            )
        );
        game.difficultyController.bindDifficultyButtons();
        game.modeController.bindModeButtons();
        this.bindNameInput();
        this.bindProfileSelect();
        this.bindStartButton();
        this.bindLeaderboardActions();
        this.updateMenuSelectorFocus();
    }

    togglePause() {
        const game = this.game;
        if (game.state === "running") {
            if (game.multiplayerConnected && !game.multiplayerVsBot) {
                this.toggleOptions();
                return;
            }
            game.state = "paused";
            game.pieceController.stopAllGameplaySounds();
            game.musicDirector.pause();
            this.renderPauseMenu();
        } else if (game.state === "paused") {
            game.state = "running";
            game.hud.hideOverlay();
            game.musicDirector.resume();
        }
    }

    /** Shown when pausing, opening options, or restarting is blocked mid-multiplayer-match
     *  (see toggleOptions()/restart()) - defaults to the pause-blocked message. */
    _showMultiplayerBlockedHint(messageKey = "multiplayer.pauseBlocked") {
        const game = this.game;
        if (!game.dom) return;

        let toast = game.dom.querySelector('[data-role="mp-pause-blocked-toast"]');
        if (!toast) {
            toast = game.dom.createElement("div");
            toast.className = "mp-pause-blocked-toast";
            toast.dataset.role = "mp-pause-blocked-toast";
            (game.dom.body ?? game.dom.documentElement)?.appendChild(toast);
        }

        toast.textContent = game.i18n.t(messageKey);
        toast.classList.add("mp-pause-blocked-toast--visible");

        clearTimeout(this._pauseBlockedTimer);
        this._pauseBlockedTimer = setTimeout(() => {
            toast.classList.remove("mp-pause-blocked-toast--visible");
        }, 1800);
    }

    restart() {
        const game = this.game;
        if (!["running", "paused", "clearing", "countdown", "gameOver-entry", "gameOver-saved"].includes(game.state)) {
            return;
        }

        if (["running", "paused", "clearing", "countdown"].includes(game.state) && game.multiplayerConnected) {
            if (game.multiplayerVsBot && game.multiplayerController) {
                game.multiplayerController.restartBotMatch();
                return;
            }
            this._showMultiplayerBlockedHint("multiplayer.restartBlocked");
            return;
        }

        game.pieceController.stopAllGameplaySounds();
        game.musicDirector.stop(0);

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
        game.hud.showScreen(game.screens.options(game.settings, game.dom, game.i18n, game.soundManager, "pause"));
        this.bindOptionsMenu();
    }

    closeOptionsOrPause() {
        if (this.game.state === "paused") this.togglePause();
        else this.toggleOptions();
    }

    async handleEnter() {
        const game = this.game;
        const mp = game.multiplayerController;
        if (mp?.isOpen) {
            if (mp.isResultPanelVisible) mp.rematch();
            return;
        }
        if (game.state === "idle" || game.state === "gameOver-saved") {
            if (!this.isNicknameValid()) return;
            if (game.playerName) await this.commitProfile(game.playerName);
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
        game.hud.setPlaying(game.isPlayingSession, game.mode);
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
            game.pieceController.stopAllGameplaySounds();
            game.musicDirector.pause();
        }
        game.state = "options";
        this.renderOptionsMenu();
    }

    renderOptionsMenu() {
        const game = this.game;
        const openRoles = new Set();
        game.dom?.querySelectorAll("details[data-role][open]").forEach((el) => {
            openRoles.add(el.dataset.role);
        });

        game.hud.showScreen(game.screens.options(game.settings, game.dom, game.i18n, game.soundManager));
        this.bindOptionsMenu();

        game.dom?.querySelectorAll("details[data-role]").forEach((el) => {
            if (openRoles.has(el.dataset.role)) el.open = true;
        });
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

        const optionsMuteToggle = game.dom.querySelector('[data-role="options-mute-toggle"]');
        const volumeSlider = game.dom.querySelector('[data-role="volume-slider"]');
        const hudRightCheckbox = game.dom.querySelector('[data-role="hud-right-checkbox"]');
        const ghostCheckbox = game.dom.querySelector('[data-role="ghost-checkbox"]');
        const gridCheckbox = game.dom.querySelector('[data-role="grid-checkbox"]');
        const screenShakeCheckbox = game.dom.querySelector('[data-role="screen-shake-checkbox"]');
        const heightSaturationCheckbox = game.dom.querySelector('[data-role="height-saturation-checkbox"]');
        const glowCheckbox = game.dom.querySelector('[data-role="glow-checkbox"]');
        const transparencyCheckbox = game.dom.querySelector('[data-role="transparency-checkbox"]');
        const fallTrailCheckbox = game.dom.querySelector('[data-role="fall-trail-checkbox"]');
        const themeSelect = game.dom.querySelector('[data-role="theme-select"]');
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

        if (optionsMuteToggle) {
            optionsMuteToggle.addEventListener("click", () => {
                settingsController.toggleSound();
                this.syncCategoryResetButtons();
            });
        }

        if (volumeSlider) {
            volumeSlider.addEventListener("input", () => {
                game.settings.volume = volumeSlider.value / 100;
                game.soundManager.setVolume(game.settings.volume);
                settingsController.saveSettings();
                settingsController.syncMuteToggle();
                this.syncCategoryResetButtons();
            });
        }

        if (hudRightCheckbox) {
            hudRightCheckbox.addEventListener("change", () => {
                game.settings.hudRight = hudRightCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        this.bindBenchmark();

        if (ghostCheckbox) {
            ghostCheckbox.addEventListener("change", () => {
                game.settings.ghost = ghostCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (gridCheckbox) {
            gridCheckbox.addEventListener("change", () => {
                game.settings.gridLines = gridCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (screenShakeCheckbox) {
            screenShakeCheckbox.addEventListener("change", () => {
                game.settings.screenShake = screenShakeCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (heightSaturationCheckbox) {
            heightSaturationCheckbox.addEventListener("change", () => {
                game.settings.heightSaturation = heightSaturationCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (glowCheckbox) {
            glowCheckbox.addEventListener("change", () => {
                game.settings.glow = glowCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (transparencyCheckbox) {
            transparencyCheckbox.addEventListener("change", () => {
                game.settings.transparency = transparencyCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (fallTrailCheckbox) {
            fallTrailCheckbox.addEventListener("change", () => {
                game.settings.fallTrail = fallTrailCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (themeSelect) {
            themeSelect.addEventListener("change", () => {
                game.settings.theme = themeSelect.value;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (skipCountdownCheckbox) {
            skipCountdownCheckbox.addEventListener("change", () => {
                game.settings.skipCountdown = skipCountdownCheckbox.checked;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        const skipModeInfoCheckbox = game.dom.querySelector('[data-role="skip-mode-info-checkbox"]');
        if (skipModeInfoCheckbox) {
            skipModeInfoCheckbox.addEventListener("change", () => {
                game.settings.skipModeInfo = skipModeInfoCheckbox.checked;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (mouseControlCheckbox) {
            mouseControlCheckbox.addEventListener("change", () => {
                game.settings.mouseControl = mouseControlCheckbox.checked;
                if (mouseSensitivityInput) mouseSensitivityInput.disabled = !mouseControlCheckbox.checked;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
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
                this.syncCategoryResetButtons();
            });
        }

        if (touchSensitivityInput) {
            touchSensitivityInput.min = SENSITIVITY_MIN;
            touchSensitivityInput.max = SENSITIVITY_MAX;
            touchSensitivityInput.step = SENSITIVITY_STEP;
            touchSensitivityInput.value = game.settings.touchSensitivity ?? 1;

            touchSensitivityInput.addEventListener("change", () => {
                if (touchSensitivityInput.value === "") {
                    delete game.settings.touchSensitivity;
                    touchSensitivityInput.value = 1;
                    settingsController.saveSettings();
                    this.syncCategoryResetButtons();
                    return;
                }
                const parsed = parseFloat(touchSensitivityInput.value);
                if (!Number.isFinite(parsed)) {
                    touchSensitivityInput.value = game.settings.touchSensitivity ?? 1;
                    return;
                }
                const value = clampToStep(parsed, SENSITIVITY_MIN, SENSITIVITY_MAX, SENSITIVITY_STEP);
                touchSensitivityInput.value = value;
                game.settings.touchSensitivity = value;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
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
                this.syncCategoryResetButtons();
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
                this.syncCategoryResetButtons();
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
                settingsController.syncCategoryMuteToggle(category);
                this.syncSoundCategoryResetButtons();
            });
        });

        game.dom.querySelectorAll('[data-role="category-mute-toggle"]').forEach((button) => {
            button.addEventListener("click", () => {
                const category = button.dataset.category;
                settingsController.toggleCategoryMuted(category);
                settingsController.syncCategoryMuteToggle(category);
                this.syncSoundCategoryResetButtons();
            });
        });

        game.dom.querySelectorAll('[data-role="sound-list"], [data-role="sound-list-countdown"]').forEach((list) => {
            list.addEventListener("input", (event) => {
                const slider = event.target.closest('[data-role="sound-volume-slider"]');
                if (!slider) return;
                const key = slider.dataset.soundKey;
                const volume = slider.value / 100;
                game.settings.soundVolumes = {...game.settings.soundVolumes, [key]: volume};
                game.soundManager.setSoundVolume(key, volume);
                settingsController.saveSettings();
                settingsController.syncSoundMuteToggle(key);
                this.syncSoundCategoryResetButtons();
            });

            list.addEventListener("click", (event) => {
                const previewButton = event.target.closest('[data-role="sound-preview-button"]');
                if (previewButton) {
                    this.togglePreviewButton(previewButton, list);
                    return;
                }

                const muteButton = event.target.closest('[data-role="sound-mute-toggle"]');
                if (muteButton) {
                    const key = muteButton.dataset.soundKey;
                    settingsController.toggleSoundMuted(key);
                    settingsController.syncSoundMuteToggle(key);
                    this.syncSoundCategoryResetButtons();
                }
            });
        });

        if (closeButton) {
            closeButton.addEventListener("click", () => this.closeOptionsOrPause());
        }

        if (closeKey) {
            closeKey.addEventListener("click", () => this.closeOptionsOrPause());
        }

        this.bindLangSelect();
        this.bindOptionsDataMenu();
        this.bindKeybindList();
        this.bindCategoryResetButtons();
        this.bindSoundCategoryResetButtons();
        this.syncSoundCategoryResetButtons();
        this.syncCategoryResetButtons();
        this.bindOptionsSearch();
    }

    categoryResetGroups() {
        const graphicsKeys = ["screenShake", "glow", "transparency", "fallTrail"];
        return {
            "reset-general-button": ["volume", "muted", "hudRight", "theme"],
            "reset-controls-button": ["mouseControl", "mouseSensitivity", "touchSensitivity"],
            "reset-gameplay-button": ["skipCountdown", "skipModeInfo", "ghost", "gridLines", "heightSaturation"],
            "reset-graphics-button": isMobileViewport()
                ? graphicsKeys.filter((key) => key !== "screenShake")
                : graphicsKeys,
            "reset-advanced-button": ["keyboardDAS", "keyboardARR"],
        };
    }

    bindCategoryResetButtons() {
        const game = this.game;
        const settingsController = game.settingsController;

        Object.entries(this.categoryResetGroups()).forEach(([role, keys]) => {
            const button = game.dom.querySelector(`[data-role="${role}"]`);
            if (!button) return;
            button.addEventListener("click", () => {
                settingsController.resetSettingsForKeys(keys);
                this.renderOptionsMenu();
            });
        });
    }

    syncCategoryResetButtons() {
        const game = this.game;
        if (!game.dom) return;
        const settingsController = game.settingsController;

        Object.entries(this.categoryResetGroups()).forEach(([role, keys]) => {
            const button = game.dom.querySelector(`[data-role="${role}"]`);
            if (!button) return;
            button.hidden = !settingsController.isSettingsGroupModified(keys);
        });
    }

    bindSoundCategoryResetButtons() {
        const game = this.game;
        const settingsController = game.settingsController;

        ["sfx", "music", "voices"].forEach((category) => {
            const button = game.dom.querySelector(`[data-role="reset-${category}-button"]`);
            if (!button) return;
            button.addEventListener("click", () => {
                const keys = game.soundManager.keysInCategory(category);
                settingsController.resetSoundCategory(category, keys);
                this.renderOptionsMenu();
            });
        });
    }

    syncSoundCategoryResetButtons() {
        const game = this.game;
        if (!game.dom) return;
        const settingsController = game.settingsController;

        ["sfx", "music", "voices"].forEach((category) => {
            const button = game.dom.querySelector(`[data-role="reset-${category}-button"]`);
            if (!button) return;
            const keys = game.soundManager.keysInCategory(category);
            button.hidden = !settingsController.isSoundCategoryModified(category, keys);
        });
    }

    bindBenchmark() {
        const game = this.game;
        const button = game.dom.querySelector('[data-role="benchmark-run-button"]');
        const statusEl = game.dom.querySelector('[data-role="benchmark-status"]');
        const resultsEl = game.dom.querySelector('[data-role="benchmark-results"]');
        const copyButton = game.dom.querySelector('[data-role="benchmark-copy-button"]');

        game.benchmarkController.ensurePreviewCanvasSized();

        if (!button) return;

        let lastRun = null;

        button.addEventListener("click", async () => {
            if (button.disabled) return;
            button.disabled = true;
            if (resultsEl) resultsEl.hidden = true;
            if (copyButton) copyButton.hidden = true;
            lastRun = null;

            if (statusEl) {
                statusEl.hidden = false;
                statusEl.textContent = game.i18n.t("screens.options.benchmarkRunning", {percent: 0});
            }

            try {
                const {results, totalMs, pieceCount} = await game.benchmarkController.run({
                    pieceCount: 10000,
                    onProgress: (done, total) => {
                        if (!statusEl) return;
                        const percent = Math.round((done / total) * 100);
                        statusEl.textContent = game.i18n.t("screens.options.benchmarkRunning", {percent});
                    },
                });

                const slowest = results[0];
                const slowestLabel = slowest
                    ? game.i18n.t(`benchmark.categories.${slowest.key}`)
                    : "";

                if (statusEl) {
                    statusEl.textContent = game.i18n.t("screens.options.benchmarkDone", {
                        pieces: pieceCount,
                        ms: Math.round(totalMs),
                        label: slowestLabel,
                        percent: slowest ? Math.round(slowest.percent) : 0,
                    });
                }

                if (resultsEl) {
                    game.screens.renderBenchmarkResults(game.dom, resultsEl, results, game.i18n);
                    resultsEl.hidden = false;
                }

                lastRun = {results, totalMs, pieceCount};
                if (copyButton) copyButton.hidden = false;
            } finally {
                button.disabled = false;
            }
        });

        if (copyButton) {
            const defaultLabel = copyButton.textContent;
            copyButton.addEventListener("click", async () => {
                if (!lastRun || copyButton.disabled) return;

                const text = game.screens.formatBenchmarkResultsText(lastRun.results, game.i18n, lastRun);
                const copied = await copyTextToClipboard(text, game.dom);

                copyButton.textContent = game.i18n.t(
                    copied ? "screens.options.benchmarkCopied" : "screens.options.benchmarkCopyFailed"
                );
                copyButton.disabled = true;
                setTimeout(() => {
                    copyButton.textContent = defaultLabel;
                    copyButton.disabled = false;
                }, 1500);
            });
        }
    }

    bindKeybindList() {
        const game = this.game;
        if (!game.dom) return;
        const list = game.dom.querySelector('[data-role="keybind-list"]');
        const resetButton = game.dom.querySelector('[data-role="keybind-reset-button"]');
        if (!list) return;

        const settingsController = game.settingsController;
        const keyboard = game.inputController.keyboard;

        const refreshList = () => {
            game.screens.renderKeybindRows(game.dom, list, game.settings.keyBindings, game.i18n);
            this.syncKeybindResetButton();
        };

        list.addEventListener("click", (event) => {
            const kbd = event.target.closest("[data-keybind-slot]");
            if (!kbd || kbd.classList.contains("kbd--listening")) return;

            list.querySelectorAll(".kbd--listening").forEach((el) => el.classList.remove("kbd--listening"));
            keyboard.cancelListening();

            const slotId = kbd.dataset.keybindSlot;
            const originalLabel = kbd.textContent;
            kbd.classList.add("kbd--listening");
            kbd.textContent = game.i18n.t("screens.options.keyboardPressKey");

            keyboard.listenForNextKey((code) => {
                kbd.classList.remove("kbd--listening");

                if (!code) {
                    kbd.textContent = originalLabel;
                    return;
                }

                const bindings = {...game.settings.keyBindings, [slotId]: code};
                Object.keys(bindings).forEach((otherId) => {
                    if (otherId !== slotId && bindings[otherId] === code) bindings[otherId] = "";
                });
                game.settings.keyBindings = bindings;
                settingsController.saveSettings();
                refreshList();
            });
        });

        if (resetButton) {
            resetButton.addEventListener("click", () => {
                game.settings.keyBindings = defaultKeyBindings();
                settingsController.saveSettings();
                refreshList();
            });
        }

        this.syncKeybindResetButton();
    }

    syncKeybindResetButton() {
        const game = this.game;
        if (!game.dom) return;
        const resetButton = game.dom.querySelector('[data-role="keybind-reset-button"]');
        const resetLabel = game.dom.querySelector('[data-role="keybind-reset-label"]');
        if (!resetButton) return;
        const defaults = defaultKeyBindings();
        const bindings = game.settings.keyBindings ?? {};
        const isDefault = Object.keys(defaults).every((key) => bindings[key] === defaults[key])
            && Object.keys(bindings).every((key) => key in defaults);
        resetButton.hidden = isDefault;
        if (resetLabel) resetLabel.hidden = isDefault;
    }

    bindOptionsSearch() {
        const game = this.game;
        if (!game.dom) return;
        const input = game.dom.querySelector('[data-role="options-search-input"]');
        const panels = game.dom.querySelector('[data-role="options-panels"]');
        const emptyState = game.dom.querySelector('[data-role="options-search-empty"]');
        if (!input || !panels) return;

        const rowSelector = ".options__row, .controls__item";
        const groupSelector = '.options[data-role^="options-group-"]:not([data-role="options-group-developer"]), .options__group';
        const searchHiddenRows = new Set();
        const searchHiddenGroups = new Set();
        const expandedByOpen = new Set();

        const isInDeveloperGroup = (el) => Boolean(el.closest('[data-role="options-group-developer"]'));

        const clearSearchState = () => {
            searchHiddenRows.forEach((row) => {
                row.hidden = false;
            });
            searchHiddenRows.clear();
            searchHiddenGroups.forEach((group) => {
                group.hidden = false;
            });
            searchHiddenGroups.clear();
            expandedByOpen.forEach((details) => {
                details.open = false;
            });
            expandedByOpen.clear();
        };

        const groupTitleText = (group) => {
            const title = group.querySelector(":scope > summary, :scope > h3");
            return title ? title.textContent.trim().toLowerCase() : "";
        };

        const rowMatchesQuery = (row, query) => {
            if (row.textContent.trim().toLowerCase().includes(query)) return true;
            let group = row.parentElement?.closest(groupSelector);
            while (group) {
                if (groupTitleText(group).includes(query)) return true;
                group = group.parentElement?.closest(groupSelector);
            }
            return false;
        };

        const applyFilter = () => {
            clearSearchState();

            const query = input.value.trim().toLowerCase();
            if (!query) {
                if (emptyState) emptyState.hidden = true;
                return;
            }

            const rows = Array.from(panels.querySelectorAll(rowSelector)).filter((row) => !isInDeveloperGroup(row));
            let anyVisible = false;

            rows.forEach((row) => {
                if (row.hidden) return;
                const matches = rowMatchesQuery(row, query);
                if (!matches) {
                    row.hidden = true;
                    searchHiddenRows.add(row);
                } else {
                    anyVisible = true;
                }
            });

            const groups = Array.from(panels.querySelectorAll(groupSelector)).filter((group) => !isInDeveloperGroup(group));
            groups.forEach((group) => {
                const hasVisibleRow = Array.from(group.querySelectorAll(rowSelector)).some((row) => !row.hidden);
                if (!hasVisibleRow) {
                    group.hidden = true;
                    searchHiddenGroups.add(group);
                } else if (group.tagName === "DETAILS" && !group.open) {
                    group.open = true;
                    expandedByOpen.add(group);
                }
            });

            if (emptyState) emptyState.hidden = anyVisible;
        };

        input.value = this.optionsSearchQuery ?? "";
        if (input.value) applyFilter();

        input.addEventListener("input", debounce(() => {
            this.optionsSearchQuery = input.value;
            applyFilter();
        }, 200));
    }

    setImportReviewVisible(visible) {
        const game = this.game;
        if (!game.dom) return;
        const panels = game.dom.querySelector('[data-role="options-panels"]');
        const review = game.dom.querySelector('[data-role="options-import-review"]');
        const closeButton = game.dom.querySelector('[data-role="options-close-button"]');
        if (panels) panels.hidden = visible;
        if (review) review.hidden = !visible;
        if (closeButton) closeButton.hidden = visible;
    }

    showImportMessage(kind) {
        const game = this.game;
        if (!game.dom) return;
        this.setImportReviewVisible(true);
        const subtitle = game.dom.querySelector('[data-role="options-import-subtitle"]');
        const emptyMsg = game.dom.querySelector('[data-role="options-import-empty"]');
        const invalidMsg = game.dom.querySelector('[data-role="options-import-invalid"]');
        const selectAllRow = game.dom.querySelector('[data-role="options-import-select-all-row"]');
        const list = game.dom.querySelector('[data-role="options-import-list"]');
        const actions = game.dom.querySelector('[data-role="options-import-actions"]');
        const closeButton = game.dom.querySelector('[data-role="options-import-close"]');

        if (subtitle) subtitle.hidden = true;
        if (selectAllRow) selectAllRow.hidden = true;
        if (list) list.hidden = true;
        if (actions) actions.hidden = true;
        if (emptyMsg) emptyMsg.hidden = kind !== "empty";
        if (invalidMsg) invalidMsg.hidden = kind !== "invalid";
        if (closeButton) {
            closeButton.hidden = false;
            closeButton.onclick = () => this.renderOptionsMenu();
        }
    }

    showImportReview(changes) {
        const game = this.game;
        if (!game.dom) return;

        if (changes.length === 0) {
            this.showImportMessage("empty");
            return;
        }

        this.setImportReviewVisible(true);
        const subtitle = game.dom.querySelector('[data-role="options-import-subtitle"]');
        const emptyMsg = game.dom.querySelector('[data-role="options-import-empty"]');
        const invalidMsg = game.dom.querySelector('[data-role="options-import-invalid"]');
        const selectAllRow = game.dom.querySelector('[data-role="options-import-select-all-row"]');
        const selectAllCheckbox = game.dom.querySelector('[data-role="options-import-select-all"]');
        const list = game.dom.querySelector('[data-role="options-import-list"]');
        const actions = game.dom.querySelector('[data-role="options-import-actions"]');
        const closeButton = game.dom.querySelector('[data-role="options-import-close"]');

        if (emptyMsg) emptyMsg.hidden = true;
        if (invalidMsg) invalidMsg.hidden = true;
        if (closeButton) closeButton.hidden = true;
        if (subtitle) {
            subtitle.hidden = false;
            subtitle.textContent = game.i18n.t("screens.options.importDiffSubtitle", {count: changes.length});
        }
        if (selectAllRow) selectAllRow.hidden = false;
        if (actions) actions.hidden = false;
        if (selectAllCheckbox) selectAllCheckbox.checked = true;
        if (list) {
            list.hidden = false;
            game.screens.renderImportDiffRows(game.dom, list, changes, game.i18n);
        }

        this.pendingImportChanges = changes;
    }

    bindOptionsDataMenu() {
        const game = this.game;
        if (!game.dom) return;

        const exportButton = game.dom.querySelector('[data-role="options-export-button"]');
        const importButton = game.dom.querySelector('[data-role="options-import-button"]');
        const importFile = game.dom.querySelector('[data-role="options-import-file"]');
        const selectAllCheckbox = game.dom.querySelector('[data-role="options-import-select-all"]');
        const list = game.dom.querySelector('[data-role="options-import-list"]');
        const cancelButton = game.dom.querySelector('[data-role="options-import-cancel"]');
        const applyButton = game.dom.querySelector('[data-role="options-import-apply"]');

        if (exportButton) {
            exportButton.addEventListener("click", () => {
                const json = game.settingsController.exportSettings();
                const blob = new Blob([json], {type: "application/json"});
                const url = URL.createObjectURL(blob);
                const link = game.dom.createElement("a");
                link.href = url;
                link.download = SETTINGS_EXPORT_FILENAME;
                link.click();
                URL.revokeObjectURL(url);
            });
        }

        if (importButton && importFile) {
            importButton.addEventListener("click", () => importFile.click());

            importFile.addEventListener("change", async () => {
                const file = importFile.files?.[0];
                importFile.value = "";
                if (!file) return;

                try {
                    const text = await file.text();
                    const parsed = game.settingsController.parseImportedSettings(text);
                    const changes = game.settingsController.diffSettings(parsed);
                    this.showImportReview(changes);
                } catch {
                    this.showImportMessage("invalid");
                }
            });
        }

        if (selectAllCheckbox && list) {
            selectAllCheckbox.addEventListener("change", () => {
                list.querySelectorAll('[data-role="options-diff-checkbox"]').forEach((checkbox) => {
                    checkbox.checked = selectAllCheckbox.checked;
                });
            });
        }

        if (list && selectAllCheckbox) {
            list.addEventListener("change", (event) => {
                if (!event.target.matches('[data-role="options-diff-checkbox"]')) return;
                const checkboxes = [...list.querySelectorAll('[data-role="options-diff-checkbox"]')];
                selectAllCheckbox.checked = checkboxes.every((checkbox) => checkbox.checked);
            });
        }

        if (cancelButton) {
            cancelButton.addEventListener("click", () => {
                this.pendingImportChanges = null;
                this.renderOptionsMenu();
            });
        }

        if (applyButton) {
            applyButton.addEventListener("click", async () => {
                if (!list) return;
                const selectedKeys = new Set(
                    [...list.querySelectorAll('[data-role="options-diff-checkbox"]')]
                        .filter((checkbox) => checkbox.checked)
                        .map((checkbox) => checkbox.dataset.key)
                );
                const selectedChanges = (this.pendingImportChanges ?? []).filter((change) => selectedKeys.has(change.key));
                this.pendingImportChanges = null;
                await game.settingsController.applySettingsChanges(selectedChanges);
                this.renderOptionsMenu();
            });
        }
    }
}
