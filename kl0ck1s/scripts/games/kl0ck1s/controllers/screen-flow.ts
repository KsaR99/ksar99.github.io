// @ts-nocheck
import type {Game} from "../game/game.js";
import {ScreenFlowMenu} from "./screen-flow-menu.js";
import {ScreenFlowGame} from "./screen-flow-game.js";
import {ScreenFlowPause} from "./screen-flow-pause.js";
import {ScreenFlowOptions} from "./screen-flow-options.js";
import {NICKNAME_PATTERN} from "../game/game-constants.js";

export class ScreenFlow {
    readonly menu: ScreenFlowMenu;
    readonly gameFlow: ScreenFlowGame;
    readonly pause: ScreenFlowPause;
    readonly options: ScreenFlowOptions;

    constructor(public readonly game: Game) {
        this.menu = new ScreenFlowMenu(this);
        this.gameFlow = new ScreenFlowGame(this);
        this.pause = new ScreenFlowPause(this);
        this.options = new ScreenFlowOptions(this);
    }

    get firstGameTutorial() {
        return this.game.gameFlow?.firstGameTutorial ?? null;
    }

    async handleEnter() {
        const game = this.game;
        const mp = game.multiplayerController;
        if (mp?.isOpen) {
            if (mp.isResultPanelVisible) mp.rematch();
            return;
        }
        if (game.state === "idle") {
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

    renderLeaderboard(list, highlightEntry = null) {
        return this.menu.renderLeaderboard(list, highlightEntry);
    }

    async showIdleScreen() {
        return await this.menu.showIdleScreen();
    }

    async showSinglePlayerScreen() {
        return await this.menu.showSinglePlayerScreen();
    }

    showModeChoiceScreen() {
        return this.menu.showModeChoiceScreen();
    }

    renderIdleScreen(list) {
        return this.menu.renderIdleScreen(list);
    }

    bindLeaderboardActions() {
        return this.menu.bindLeaderboardActions();
    }

    async commitProfile(name) {
        return await this.menu.commitProfile(name);
    }

    async deleteProfile() {
        return await this.menu.deleteProfile();
    }

    async restoreProfile(name) {
        return await this.menu.restoreProfile(name);
    }

    async switchProfile(name) {
        return await this.menu.switchProfile(name);
    }

    async renameProfile(oldName, newName) {
        return await this.menu.renameProfile(oldName, newName);
    }

    isCreatingNewProfile() {
        return this.menu.isCreatingNewProfile();
    }

    bindProfileSelect() {
        return this.menu.bindProfileSelect();
    }

    bindDeleteProfileButton() {
        return this.menu.bindDeleteProfileButton();
    }

    updateDeleteProfileButtonState() {
        return this.menu.updateDeleteProfileButtonState();
    }

    moveMenuFocus(dir, axis = "vertical") {
        return this.menu.moveMenuFocus(dir, axis);
    }

    updateMenuSelectorFocus() {
        return this.menu.updateMenuSelectorFocus();
    }

    bindStartButton() {
        return this.menu.bindStartButton();
    }

    bindNameInput() {
        return this.menu.bindNameInput();
    }

    showModeInfo() {
        return this.menu.showModeInfo();
    }

    bindModeInfoContinue() {
        return this.menu.bindModeInfoContinue();
    }

    startCountdown() {
        return this.gameFlow.startCountdown();
    }

    updateCountdownBar(reset = false) {
        return this.gameFlow.updateCountdownBar(reset);
    }

    advanceCountdownStep() {
        return this.gameFlow.advanceCountdownStep();
    }

    renderCountdownStep() {
        return this.gameFlow.renderCountdownStep();
    }

    start() {
        return this.gameFlow.start();
    }

    async gameOver() {
        return await this.gameFlow.gameOver();
    }

    async endRound(reason = "topOut") {
        return await this.gameFlow.endRound(reason);
    }

    exitToMenu() {
        return this.gameFlow.exitToMenu();
    }

    renderGameOverEntry(list, entry, todayBestBeforeThisGame, reason = "topOut") {
        return this.gameFlow.renderGameOverEntry(list, entry, todayBestBeforeThisGame, reason);
    }

    bindGameOverShare() {
        return this.gameFlow.bindGameOverShare();
    }

    bindGameOverContinue() {
        return this.gameFlow.bindGameOverContinue();
    }

    continueFromGameOverEntry() {
        return this.gameFlow.continueFromGameOverEntry();
    }

    togglePause() {
        return this.pause.togglePause();
    }

    toggleMultiplayerLiveOptions() {
        return this.pause.toggleMultiplayerLiveOptions();
    }

    _showMultiplayerBlockedHint(messageKey = "multiplayer.pauseBlocked") {
        return this.pause._showMultiplayerBlockedHint(messageKey);
    }

    restart() {
        return this.pause.restart();
    }

    handleEscape() {
        return this.pause.handleEscape();
    }

    renderPauseMenu() {
        return this.pause.renderPauseMenu();
    }

    closeOptionsOrPause() {
        return this.pause.closeOptionsOrPause();
    }

    refreshCurrentScreen() {
        return this.options.refreshCurrentScreen();
    }

    refreshLanguage() {
        return this.options.refreshLanguage();
    }

    bindLangSelect() {
        return this.options.bindLangSelect();
    }

    toggleOptions() {
        return this.options.toggleOptions();
    }

    renderOptionsMenu() {
        return this.options.renderOptionsMenu();
    }

    togglePreviewButton(button, list) {
        return this.options.togglePreviewButton(button, list);
    }

    setPreviewButtonState(button, state) {
        return this.options.setPreviewButtonState(button, state);
    }

    bindOptionsMenu() {
        return this.options.bindOptionsMenu();
    }

    categoryResetGroups() {
        return this.options.categoryResetGroups();
    }

    bindCategoryResetButtons() {
        return this.options.bindCategoryResetButtons();
    }

    syncThemePicker() {
        return this.options.syncThemePicker();
    }

    syncCategoryResetButtons() {
        return this.options.syncCategoryResetButtons();
    }

    bindSoundCategoryResetButtons() {
        return this.options.bindSoundCategoryResetButtons();
    }

    syncSoundCategoryResetButtons() {
        return this.options.syncSoundCategoryResetButtons();
    }

    bindBenchmark() {
        return this.options.bindBenchmark();
    }

    bindKeybindList() {
        return this.options.bindKeybindList();
    }

    syncKeybindResetButton() {
        return this.options.syncKeybindResetButton();
    }

    bindOptionsSearch() {
        return this.options.bindOptionsSearch();
    }

    setImportReviewVisible(visible) {
        return this.options.setImportReviewVisible(visible);
    }

    showImportMessage(kind) {
        return this.options.showImportMessage(kind);
    }

    showImportReview(changes) {
        return this.options.showImportReview(changes);
    }

    bindOptionsDataMenu() {
        return this.options.bindOptionsDataMenu();
    }

}
