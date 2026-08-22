// @ts-nocheck
import type {ScreenFlow} from "./screen-flow.js";
import type {Game} from "../game/game.js";

"use strict";

function clampToStep(value, min, max, step) {
    const clamped = Math.max(min, Math.min(max, value));
    return Math.round(clamped / step) * step;
}

export class ScreenFlowPause {
    private _pauseBlockedTimer: null | number = null;

    constructor(public readonly flow: ScreenFlow) {
    }

    private get game(): Game {
        return this.flow.game;
    }

    togglePause() {
        const game = this.game;
        if (game.multiplayerOptionsOverlayOpen) {
            this.toggleMultiplayerLiveOptions();
            return;
        }
        if (game.state === "running") {
            if (game.multiplayerConnected && !game.multiplayerVsBot) {
                this.toggleMultiplayerLiveOptions();
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

    toggleMultiplayerLiveOptions() {
        const game = this.game;
        if (game.multiplayerOptionsOverlayOpen) {
            game.soundManager.stopPreview();
            game.multiplayerOptionsOverlayOpen = false;
            game.hud.hideOverlay();
            return;
        }
        if (game.state !== "running") return;
        game.multiplayerOptionsOverlayOpen = true;
        this.flow.renderOptionsMenu();
    }

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
        if (!["running", "paused", "clearing", "countdown", "gameOver-entry"].includes(game.state)) {
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
        this.flow.startCountdown();
    }

    handleEscape() {
        if (this.game.multiplayerOptionsOverlayOpen) {
            this.toggleMultiplayerLiveOptions();
        } else if (this.game.state === "options") {
            this.flow.toggleOptions();
        } else {
            this.togglePause();
        }
    }

    renderPauseMenu() {
        const game = this.game;
        game.hud.showScreen(game.screens.options(game.settings, game.dom, game.i18n, game.soundManager, "pause"));
        this.flow.bindOptionsMenu();
    }

    closeOptionsOrPause() {
        if (this.game.multiplayerOptionsOverlayOpen) this.toggleMultiplayerLiveOptions();
        else if (this.game.state === "paused") this.togglePause();
        else this.flow.toggleOptions();
    }
}
