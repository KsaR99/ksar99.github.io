"use strict";

import {createMode} from "../game/modes/index.js";

export class ModeController {
    constructor(game) {
        this.game = game;
        this.currentMode = createMode(game.mode, game);
    }

    get def() {
        return this.game.gameModes[this.game.mode];
    }

    get randomizableModeKeys() {
        const game = this.game;
        return Object.keys(game.gameModes).filter((key) => !game.gameModes[key].isRandom && !game.gameModes[key].excludeFromRandom);
    }

    setMode(mode) {
        const game = this.game;
        if (!game.gameModes[mode]) return;
        game.mode = mode;
        game.settings.mode = mode;
        game.settingsController.saveSettings();
        this.reset();
        game.hud.update(game.stats);
    }

    bindModeButtons() {
        const game = this.game;
        if (!game.dom) return;
        const prevButton = game.dom.querySelector('[data-role="mode-prev"]');
        const nextButton = game.dom.querySelector('[data-role="mode-next"]');
        if (prevButton) prevButton.addEventListener("click", () => this.changeMode(-1));
        if (nextButton) nextButton.addEventListener("click", () => this.changeMode(1));
    }

    changeMode(dir) {
        const game = this.game;
        const keys = Object.keys(game.gameModes);
        const currentIndex = keys.indexOf(game.mode);
        const nextMode = keys[(currentIndex + dir + keys.length) % keys.length];
        this.applyModeAndRerender(nextMode);
    }

    resolveRandomMode() {
        const game = this.game;
        if (!game.gameModes[game.mode]?.isRandom) return;
        const keys = this.randomizableModeKeys;
        const picked = keys[Math.floor(Math.random() * keys.length)];
        game.mode = picked;
        this.currentMode = createMode(picked, game);
        game.hud.update(game.stats);
    }

    restoreSelectedMode() {
        const game = this.game;
        if (game.settings.mode && game.gameModes[game.settings.mode] && game.mode !== game.settings.mode) {
            game.mode = game.settings.mode;
            this.currentMode = createMode(game.mode, game);
        }
    }

    applyModeAndRerender(mode) {
        const game = this.game;
        this.setMode(mode);

        if (game.state === "idle") {
            game.screenFlow.renderIdleScreen(game.leaderboard.forMode(game.mode));
        }
    }

    reset() {
        const def = this.def;
        this.currentMode = createMode(this.game.mode, this.game);
        this.game.modeState = {
            garbageTimer: 0,
            digCleared: 0,
            countdownRemainingMs: def.countdownStartMs ?? 0,
            zenOverflowUsed: 0,
            zenGiveBackUsed: 0,
        };
    }

    setupBoard() {
        this.currentMode.setupBoard();
    }

    objectiveText() {
        return this.currentMode.objectiveText();
    }

    objectivePercent() {
        return this.currentMode.objectivePercent();
    }

    objectiveUrgency() {
        return this.currentMode.objectiveUrgency();
    }

    objectiveColorMode() {
        return this.currentMode.objectiveColorMode();
    }

    update(delta) {
        this.currentMode.update(delta);
    }

    onLinesCleared(cleared) {
        return this.currentMode.onLinesCleared(cleared);
    }

    checkObjectiveComplete() {
        return this.currentMode.checkObjectiveComplete();
    }

    maybeApplyZenOverflow() {
        this.currentMode.maybeApplyZenOverflow?.();
    }
}
