// @ts-nocheck
import type {Game} from "../game/game.js";
import {APP_NAME, COUNTDOWN_STEPS} from "../game/game-constants.js";
import {isCascadeMode, numberToVoiceKeys} from "../shared/utils.js";
import {voiceCountingKey} from "../shared/config.js";
import {ProfileController} from "./profile-controller.js";
import {OptionsController} from "./options-controller.js";
import {FirstGameTutorial} from "./first-game-tutorial.js";

"use strict";

export class GameFlowController {

    game: Game;
    profile: ProfileController;
    options: OptionsController;
    _startingCountdown: Promise<void> | null;

    constructor(game) {
        this.game = game;
        this.profile = new ProfileController(game, this);
        this.options = new OptionsController(game, this);
        this.firstGameTutorial = new FirstGameTutorial(game);
        this._startingCountdown = null;
    }

    renderLeaderboard(list, highlightEntry = null) {
        return this.game.leaderboard.renderTable(list, highlightEntry);
    }

    startIdleMusic() {
        const game = this.game;
        if (game.idleMusicId != null) return;
        game.idleMusicId = game.soundManager.play("idleSong", {loop: true});
    }

    stopIdleMusic() {
        const game = this.game;
        if (game.idleMusicId == null) return;
        game.soundManager.stop(game.idleMusicId);
        game.idleMusicId = null;
    }

    async showIdleScreen() {
        const game = this.game;
        game.state = "idle";
        game.renderer.clearVisuals();
        this.startIdleMusic();
        game.menuSelector = "entry";
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
        this.showModeChoiceScreen();
        game.hud.update(game.stats);
    }

    showModeChoiceScreen() {
        const game = this.game;
        game.menuSelector = "entry";
        game.menuChoiceIndex = 0;
        game.menuChoiceFocusActive = false;
        game.hud.showScreen(game.screens.modeChoice(game.dom, game.i18n));
        const single = game.hud.overlayEl.querySelector('[data-role="single-player-button"]');
        const multi = game.hud.overlayEl.querySelector('[data-role="multiplayer-button"]');
        single?.addEventListener("click", () => this.showSinglePlayerScreen(), {once: true});

        this.updateModeChoiceSelection();
    }

    showSinglePlayerScreen() {
        const game = this.game;
        if (game.multiplayerController?.isOpen) game.multiplayerController.close();
        game.state = "idle";
        game.menuSelector = "mode";
        game.isPlayingSession = false;
        game.multiplayerOptionsOverlayOpen = false;
        game.hud.setPlaying(false);
        game.modeController.restoreSelectedMode();
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

        const returnButton = game.hud.overlayEl?.querySelector('[data-role="single-return-button"]');
        if (returnButton) {
            returnButton.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.showModeChoiceScreen();
            }, {once: true});
        }

        this.updateMenuSelectorFocus();
    }

    bindLeaderboardActions() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const shareButton = game.hud.overlayEl.querySelector('[data-role="leaderboard-share-button"]');
        game.shareService.bindIconButton(shareButton, () => game.shareService.shareLeaderboard(game.mode));
    }

    moveMenuFocus(dir, axis = "vertical") {
        const game = this.game;
        if (game.state !== "idle") return;

        if (game.menuSelector === "entry") {
            if (axis !== "horizontal") return;
            game.menuChoiceIndex = Math.max(0, Math.min(1, (game.menuChoiceIndex ?? 0) + dir));
            game.menuChoiceFocusActive = true;
            this.updateModeChoiceSelection();
            return;
        }
        const groups = ["mode", "difficulty", "nickname"];
        const currentIndex = groups.indexOf(game.menuSelector);
        const nextIndex = Math.max(0, Math.min(groups.length - 1, currentIndex + dir));
        if (nextIndex === currentIndex) return;

        game.menuSelector = groups[nextIndex];
        this.updateMenuSelectorFocus();
    }


    updateModeChoiceSelection() {
        const game = this.game;
        const root = game.hud.overlayEl;
        if (!root) return;
        const buttons = Array.from(root.querySelectorAll('[data-role="single-player-button"], [data-role="multiplayer-button"]'));
        buttons.forEach((button, index) => {
            const active = Boolean(game.menuChoiceFocusActive) && index === (game.menuChoiceIndex ?? 0);
            button.classList.toggle("difficulty--focused", active);
            button.classList.toggle("mode-choice__button--keyboard-focus", active);
            button.setAttribute("aria-pressed", index === (game.menuChoiceIndex ?? 0) ? "true" : "false");
        });
    }

    updateMenuSelectorFocus() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const choiceButtons = game.hud.overlayEl.querySelectorAll('[data-role="single-player-button"], [data-role="multiplayer-button"]');
        choiceButtons.forEach((button) => button.classList.toggle("difficulty--focused", game.menuSelector === "entry" && game.dom.activeElement === button));
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
        if (this._startingCountdown) return this._startingCountdown;

        const game = this.game;
        this._startingCountdown = (async () => {
            game.soundManager.unlock();
            game.soundManager.readyForGameplay().catch((err) => {
                console.warn("[SoundManager] Gameplay audio preload failed:", err);
            });

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
        })().finally(() => {
            this._startingCountdown = null;
        });

        return this._startingCountdown;
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
        this.stopIdleMusic();
        game.musicDirector.start(game.board);
        this.firstGameTutorial.showIfFirstGame();

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
        game.renderer.clearVisuals();
        game.isPlayingSession = false;
        game.hud.setPlaying(false);
        game.musicDirector.stop();
        this.startIdleMusic();
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
            combo: isCascadeMode(game.mode) ? game.maxCombo : null,
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
        game.state = "idle";
        game.isPlayingSession = false;
        game.statsTracker.reset();
        game.modeController.reset();
        game.level = game.difficulties[game.difficulty].startLevel;
        game.hud.update(game.stats);
        this.showSinglePlayerScreen();
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
            if (game.multiplayerConnected) game.multiplayerController?.setOpponentPausedVisual(true);
            this.options.renderPauseMenu();
        } else if (game.state === "paused") {
            game.state = "running";
            game.hud.hideOverlay();
            game.multiplayerController?.setOpponentPausedVisual(false);
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
        this.startIdleMusic();

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
            if (game.menuSelector === "entry") {
                const buttons = Array.from(game.hud.overlayEl?.querySelectorAll('[data-role="single-player-button"], [data-role="multiplayer-button"]') ?? []);
                const selected = buttons[game.menuChoiceIndex ?? 0];
                selected?.click();
                return;
            }
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
