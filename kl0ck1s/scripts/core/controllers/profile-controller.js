"use strict";

import {NICKNAME_PATTERN} from "../game/game-constants.js";

export class ProfileController {
    constructor(game, gameFlow) {
        this.game = game;
        this.gameFlow = gameFlow;
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
            this.gameFlow.renderIdleScreen(game.leaderboard.forMode(game.mode));
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
            this.gameFlow.renderIdleScreen(game.leaderboard.forMode(game.mode));
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
            this.gameFlow.renderIdleScreen(game.leaderboard.forMode(game.mode));
        }
        game.hud.update(game.stats);
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
                this.gameFlow.moveMenuFocus(-1);
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

    isNicknameValid() {
        const game = this.game;
        if (!game.hud.overlayEl) return true;
        const input = game.hud.overlayEl.querySelector('[data-role="name-input"]');
        if (!input) return true;

        const valid = NICKNAME_PATTERN.test(game.playerName || "");
        input.classList.toggle("nickname-form__input--invalid", !valid);
        if (!valid) {
            input.reportValidity();
            input.focus();
        }
        return valid;
    }
}
