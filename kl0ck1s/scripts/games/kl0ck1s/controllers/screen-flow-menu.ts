// @ts-nocheck
import type {ScreenFlow} from "./screen-flow.js";
import type {Game} from "../game/game.js";
import {APP_NAME,} from "../game/game-constants.js";

"use strict";

function clampToStep(value, min, max, step) {
    const clamped = Math.max(min, Math.min(max, value));
    return Math.round(clamped / step) * step;
}

export class ScreenFlowMenu {
    constructor(public readonly flow: ScreenFlow) {
    }

    private get game(): Game {
        return this.flow.game;
    }

    renderLeaderboard(list, highlightEntry = null) {
        return this.game.leaderboard.renderTable(list, highlightEntry);
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
        multi?.addEventListener("click", () => game.multiplayerController?.open(), {once: true});
        this.updateModeChoiceSelection();
    }

    async showSinglePlayerScreen() {
        const game = this.game;
        if (game.multiplayerController?.isOpen) game.multiplayerController.close();
        game.state = "idle";
        game.menuSelector = "mode";
        game.isPlayingSession = false;
        game.multiplayerOptionsOverlayOpen = false;
        game.hud.setPlaying(false);
        game.modeController.restoreSelectedMode();
        if (!game.playerName) game.playerName = game.leaderboard.profile || "";
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
        const returnButton = game.hud.overlayEl?.querySelector('[data-role="single-return-button"]');
        returnButton?.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.showModeChoiceScreen();
        });
        this.updateMenuSelectorFocus();
        if (returnButton) {
            requestAnimationFrame(() => {
                if (game.menuSelector === "mode" && game.hud.overlayEl?.contains(returnButton)) {
                    returnButton.focus();
                }
            });
        }
    }

    bindLeaderboardActions() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const shareButton = game.hud.overlayEl.querySelector('[data-role="leaderboard-share-button"]');
        game.shareService.bindIconButton(shareButton, () => game.shareService.shareLeaderboard(game.mode));
    }

    async commitProfile(name) {
        const game = this.game;
        const trimmed = (name || "").trim();
        if (!trimmed) return;

        const changingProfile = trimmed !== game.leaderboard.profile;
        await game.leaderboard.switchProfile(trimmed);
        if (!changingProfile) return;

        const showFirstGameTutorial = game.settings.showFirstGameTutorial;
        const saved = await game.leaderboard.loadProfileSettings(trimmed);
        if (saved) {
            game.settingsController.applyStoredSettings(saved);
        }
        game.settings.showFirstGameTutorial = showFirstGameTutorial;
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
        }
        game.hud.update(game.stats);
    }

    isCreatingNewProfile() {
        const game = this.game;
        if (!game.hud.overlayEl) return true;
        const select = game.hud.overlayEl.querySelector('[data-role="profile-select"]');
        return !select || select.value === "";
    }

    bindProfileSelect() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const select = game.hud.overlayEl.querySelector('[data-role="profile-select"]');
        if (select) {
            select.addEventListener("change", () => {
                const value = select.value;
                if (!value) {
                    const input = game.hud.overlayEl.querySelector('[data-role="name-input"]');
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
        if (!game.hud.overlayEl) return;
        const button = game.hud.overlayEl.querySelector('[data-role="delete-profile-button"]');
        if (!button) return;
        button.addEventListener("click", () => this.deleteProfile());
        this.updateDeleteProfileButtonState();
    }

    updateDeleteProfileButtonState() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const button = game.hud.overlayEl.querySelector('[data-role="delete-profile-button"]');
        if (button) button.disabled = !game.playerName;
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

    updateMenuSelectorFocus() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const choiceButtons = Array.from(game.hud.overlayEl.querySelectorAll('[data-role="single-player-button"], [data-role="multiplayer-button"]'));
        choiceButtons.forEach((button) => {
            const active = game.menuSelector === "entry" && game.menuChoiceFocusActive && button === choiceButtons[game.menuChoiceIndex ?? 0];
            button.classList.toggle("difficulty--focused", active);
            button.classList.toggle("mode-choice__button--keyboard-focus", active);
        });
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

    bindNameInput() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const input = game.hud.overlayEl.querySelector('[data-role="name-input"]');
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
            e.target.value = e.target.value.replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 16);
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
            this.flow.startCountdown();
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
        button.addEventListener("click", () => this.flow.startCountdown(), {once: true});
    }
}
