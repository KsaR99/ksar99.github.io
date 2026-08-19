"use strict";

import {APP_NAME, COUNTDOWN_STEPS} from "../game/game-constants.js";
import {numberToVoiceKeys} from "../shared/utils.js";
import {voiceCountingKey} from "../shared/config.js";
import {ProfileController} from "./profile-controller.js";
import {OptionsController} from "./options-controller.js";

export class GameFlowController {
    constructor(game) {
        this.game = game;
        this.profile = new ProfileController(game, this);
        this.options = new OptionsController(game, this);
    }

    renderLeaderboard(list, highlightEntry = null) {
        return this.game.leaderboard.renderTable(list, highlightEntry);
    }

    async showIdleScreen() {
        const game = this.game;
        game.state = "idle";
        game.menuSelector = "mode";
        game.isPlayingSession = false;
        game.multiplayerOptionsOverlayOpen = false;
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
        this.profile.bindNameInput();
        this.profile.bindProfileSelect();
        this.bindStartButton();
        this.bindLeaderboardActions();
        this.updateMenuSelectorFocus();
    }

    bindLeaderboardActions() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const shareButton = game.hud.overlayEl.querySelector('[data-role="leaderboard-share-button"]');
        game.shareService.bindIconButton(shareButton, () => game.shareService.shareLeaderboard(game.mode));
    }

    moveMenuFocus(dir) {
        const game = this.game;
        if (game.state !== "idle") return;

        const groups = ["mode", "difficulty", "nickname"];
        const currentIndex = groups.indexOf(game.menuSelector);
        const nextIndex = Math.max(0, Math.min(groups.length - 1, currentIndex + dir));
        if (nextIndex === currentIndex) return;

        game.menuSelector = groups[nextIndex];
        this.updateMenuSelectorFocus();
    }

    updateMenuSelectorFocus() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const difficultyEl = game.hud.overlayEl.querySelector('[data-role="difficulty-select"]');
        const modeEl = game.hud.overlayEl.querySelector('[data-role="mode-select"]');
        const nameInput = game.hud.overlayEl.querySelector('[data-role="name-input"]');
        if (difficultyEl) difficultyEl.classList.toggle("difficulty--focused", game.menuSelector === "difficulty");
        if (modeEl) modeEl.classList.toggle("difficulty--focused", game.menuSelector === "mode");
        if (nameInput && game.menuSelector === "nickname" && game.dom.activeElement !== nameInput) {
            nameInput.focus();
        }
    }

    bindStartButton() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const button = game.hud.overlayEl.querySelector('[data-role="start-button"]');
        if (!button) return;
        button.addEventListener("click", () => this.handleEnter());
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
        if (!game.hud.overlayEl) return;
        const button = game.hud.overlayEl.querySelector('[data-role="mode-info-continue-button"]');
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
        if (!game.hud.overlayEl) return;
        const bar = game.hud.overlayEl.querySelector('[data-role="countdown-progress-bar"]');
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

        const bar = game.hud.overlayEl?.querySelector('[data-role="countdown-progress-bar"]');
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
                ...numberToVoiceKeys(game.level, game.i18n.lang),
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
            combo: game.mode === "cascade" ? game.maxCombo : null,
        };

        const raceUnfinished =
            (game.mode === "sprint" && reason !== "sprintComplete") ||
            (game.mode === "cheeseRace" && reason !== "cheeseClear");
        const savedEntry = (raceUnfinished || game.gameModes[game.mode].noLeaderboard) ? null : entry;

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
        if (!game.hud.overlayEl) return;
        const button = game.hud.overlayEl.querySelector('[data-role="gameover-share-button"]');
        game.shareService.bindLabeledButton(button, () => game.shareService.shareRun());
    }

    bindGameOverContinue() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const button = game.hud.overlayEl.querySelector('[data-role="gameover-continue-button"]');
        if (!button) return;
        button.addEventListener("click", () => this.continueFromGameOverEntry(), {once: true});
    }

    continueFromGameOverEntry() {
        const game = this.game;
        if (game.state !== "gameOver-entry" || !game.currentGameOverEntry) return;
        game.currentGameOverEntry = null;
        game.level = game.difficulties[game.difficulty].startLevel;
        game.statsTracker.reset();
        game.modeController.reset();
        this.showIdleScreen().then();
    }

    togglePause() {
        const game = this.game;
        if (game.multiplayerOptionsOverlayOpen) {
            this.options.toggleMultiplayerLiveOptions();
            return;
        }
        if (game.state === "running") {
            if (game.multiplayerConnected && !game.multiplayerVsBot) {
                this.options.toggleMultiplayerLiveOptions();
                return;
            }
            game.state = "paused";
            game.pieceController.stopAllGameplaySounds();
            game.musicDirector.pause();
            this.options.renderPauseMenu();
        } else if (game.state === "paused") {
            game.state = "running";
            game.hud.hideOverlay();
            game.musicDirector.resume();
        }
    }

    restart() {
        const game = this.game;
        if (!["running", "paused", "clearing", "countdown", "gameOver-entry"].includes(game.state)) {
            return;
        }

        if (["running", "paused", "clearing", "countdown"].includes(game.state) && game.multiplayerConnected) {
            if (game.multiplayerVsBot && game.multiplayerController) {
                game.multiplayerController.restartBotMatch();
                return;
            }
            this.options._showMultiplayerBlockedHint("multiplayer.restartBlocked");
            return;
        }

        game.pieceController.stopAllGameplaySounds();
        game.musicDirector.stop(0);

        game.modeController.resolveRandomMode();
        this.startCountdown();
    }

    toggleOptions() {
        return this.options.toggleOptions();
    }

    handleEscape() {
        if (this.game.multiplayerOptionsOverlayOpen) {
            this.options.toggleMultiplayerLiveOptions();
        } else if (this.game.state === "options") {
            this.options.toggleOptions();
        } else {
            this.togglePause();
        }
    }

    async handleEnter() {
        const game = this.game;
        const mp = game.multiplayerController;
        if (mp?.isOpen) {
            if (mp.isResultPanelVisible) mp.rematch();
            return;
        }
        if (game.state === "idle") {
            if (!this.profile.isNicknameValid()) return;
            if (game.playerName) await this.profile.commitProfile(game.playerName);
            game.modeController.resolveRandomMode();
            this.showModeInfo();
        } else if (game.state === "gameOver-entry") {
            this.continueFromGameOverEntry();
        } else if (game.state === "modeInfo") {
            this.startCountdown();
        }
    }
}
