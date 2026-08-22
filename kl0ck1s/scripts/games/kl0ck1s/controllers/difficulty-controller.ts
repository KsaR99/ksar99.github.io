// @ts-nocheck
import type {Game} from "../game/game.js";

"use strict";

export class DifficultyController {

    game: Game;

    constructor(game) {
        this.game = game;
    }

    setDifficulty(difficulty) {
        const game = this.game;
        game.difficulty = difficulty;
        game.levelTier = difficulty;

        if (game.state === "idle") {
            game.level = game.difficulties[difficulty].startLevel;
            game.lines = 0;
        }

        game.settings.difficulty = difficulty;
        game.settingsController.saveSettings();
        game.hud.update(game.stats);
    }

    bindDifficultyButtons() {
        const game = this.game;
        if (!game.dom) return;
        const prevButton = game.dom.querySelector('[data-role="difficulty-prev"]');
        const nextButton = game.dom.querySelector('[data-role="difficulty-next"]');
        if (prevButton) prevButton.addEventListener("click", () => {
            if (this.game.state !== "idle") return;
            this.changeDifficulty(-1);
        });
        if (nextButton) nextButton.addEventListener("click", () => {
            if (this.game.state !== "idle") return;
            this.changeDifficulty(1);
        });
    }

    changeDifficulty(dir) {
        const game = this.game;
        const keys = Object.keys(game.difficulties);
        const currentIndex = keys.indexOf(game.difficulty);
        const nextDifficulty = keys[(currentIndex + dir + keys.length) % keys.length];
        this.setDifficulty(nextDifficulty);

        if (game.state === "idle") {
            game.screenFlow.renderIdleScreen(game.currentIdleList);
        }
    }
}
