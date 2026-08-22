// @ts-nocheck
import type {ScreenFlow} from "./screen-flow.js";
import type {Game} from "../game/game.js";
import {COUNTDOWN_STEPS,} from "../game/game-constants.js";
import {numberToVoiceKeys} from "../shared/utils.js";
import {voiceCountingKey} from "../shared/config.js";

"use strict";

function clampToStep(value, min, max, step) {
    const clamped = Math.max(min, Math.min(max, value));
    return Math.round(clamped / step) * step;
}

export class ScreenFlowGame {
    constructor(public readonly flow: ScreenFlow) {
    }

    private get game(): Game {
        return this.flow.game;
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
        game.screenFlow?.firstGameTutorial?.showIfFirstGame?.();

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

        this.flow.showSinglePlayerScreen();
    }

    renderGameOverEntry(list, entry, todayBestBeforeThisGame, reason = "topOut") {
        const game = this.game;
        game.currentGameOverEntry = {list, entry, todayBestBeforeThisGame, reason};
        game.hud.showScreen(
            game.screens.gameOverEntry(
                game.stats, list, entry, todayBestBeforeThisGame,
                (l, h) => this.flow.renderLeaderboard(l, h), game.dom, game.i18n, reason
            )
        );
        this.bindGameOverContinue();
        this.bindGameOverShare();
        this.flow.bindLeaderboardActions();
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
        this.flow.showIdleScreen().then();
    }
}
