"use strict";

/** Owns difficulty selection (start level, lines/level pacing). Board theming no longer follows difficulty - see EffectOverlay. */
export class DifficultyController {
    constructor(game) {
        this.game = game;
    }

    setDifficulty(difficulty) {
        const game = this.game;
        game.difficulty = difficulty;
        game.levelTier = difficulty;

        if (game.state === "idle" || game.state === "gameOver-saved") {
            game.level = game.difficulties[difficulty].startLevel;
            game.lines = 0;
        }

        game.settings.difficulty = difficulty;
        game.settingsController.saveSettings();
        game.hud.update(game.stats);
    }

    bindDifficultyButtons(onChange) {
        const game = this.game;
        if (!game.dom) return;
        game.dom
            .querySelectorAll('[data-role="difficulty-button"]')
            .forEach((btn) =>
                btn.addEventListener("click", ({currentTarget}) => {
                    this.setDifficulty(currentTarget.dataset.difficulty);
                    onChange();
                })
            );
    }

    changeDifficulty(dir) {
        const game = this.game;
        const keys = Object.keys(game.difficulties);
        const currentIndex = keys.indexOf(game.difficulty);
        const nextDifficulty = keys[(currentIndex + dir + keys.length) % keys.length];
        this.setDifficulty(nextDifficulty);

        if (game.state === "idle") {
            game.screenFlow.renderIdleScreen(game.currentIdleList);
        } else if (game.state === "gameOver-saved" && game.currentGameOverSaved) {
            const {list, entry} = game.currentGameOverSaved;
            game.screenFlow.renderGameOverSaved(list, entry);
        }
    }
}
