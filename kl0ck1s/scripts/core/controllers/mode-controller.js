"use strict";

import {formatDuration} from "../shared/utils.js";

/**
 * Owns game-mode selection (Marathon/Sprint/Ultra/Survival) and the
 * per-frame objective checks that are specific to a mode: Sprint's 40-line
 * finish line, Ultra's 3-minute clock, Survival's periodic garbage. Marathon
 * has no extra objective - it's just the existing unlimited/topping-out
 * behavior with every mode-specific check below skipped.
 */
export class ModeController {
    constructor(game) {
        this.game = game;
    }

    get def() {
        return this.game.gameModes[this.game.mode];
    }

    setMode(mode) {
        const game = this.game;
        if (!game.gameModes[mode]) return;
        game.mode = mode;
        game.settings.mode = mode;
        game.settingsController.saveSettings();
        game.hud.update(game.stats);
    }

    bindModeButtons(onChange) {
        const game = this.game;
        if (!game.dom) return;
        game.dom
            .querySelectorAll('[data-role="mode-button"]')
            .forEach((btn) =>
                btn.addEventListener("click", ({currentTarget}) => {
                    this.setMode(currentTarget.dataset.mode);
                    onChange();
                })
            );
    }

    /** Cycles to the next/previous mode (dir = ±1) - the arrow-key counterpart to bindModeButtons()'s clicks. */
    changeMode(dir) {
        const game = this.game;
        const keys = Object.keys(game.gameModes);
        const currentIndex = keys.indexOf(game.mode);
        const nextMode = keys[(currentIndex + dir + keys.length) % keys.length];
        this.setMode(nextMode);

        if (game.state === "idle") {
            game.screenFlow.renderIdleScreen(game.leaderboard.forMode(game.mode));
        } else if (game.state === "gameOver-saved" && game.currentGameOverSaved) {
            const {entry} = game.currentGameOverSaved;
            game.screenFlow.renderGameOverSaved(game.leaderboard.forMode(game.mode), entry);
        }
    }

    /** Resets per-round mode state - called from Game.prepareNewRound(). */
    reset() {
        this.game.modeState = {garbageTimer: 0};
    }

    /** Short status string for the sidebar (e.g. "24 / 40", "02:14", "8s") - null for Marathon, which has no extra objective. */
    objectiveText() {
        const game = this.game;
        const def = this.def;

        if (game.mode === "sprint") {
            return `${game.lines} / ${def.sprintTarget}`;
        }

        if (game.mode === "ultra") {
            return formatDuration(Math.max(0, def.timeLimitMs - game.elapsedMs));
        }

        if (game.mode === "survival") {
            const remainingMs = Math.max(0, def.garbageIntervalMs - game.modeState.garbageTimer);
            return `${Math.ceil(remainingMs / 1000)}s`;
        }

        return null;
    }

    /** Called every frame the round is actually running - Ultra's clock and Survival's garbage timer both live here. */
    update(delta) {
        const game = this.game;
        const def = this.def;

        if (game.mode === "ultra" && game.elapsedMs >= def.timeLimitMs) {
            game.screenFlow.endRound("timeUp");
            return;
        }

        if (game.mode === "survival" && def.garbage) {
            game.modeState.garbageTimer += delta;
            if (game.modeState.garbageTimer >= def.garbageIntervalMs) {
                game.modeState.garbageTimer = 0;
                const span = def.garbageLinesMax - def.garbageLinesMin + 1;
                const count = def.garbageLinesMin + Math.floor(Math.random() * span);
                const {toppedOut} = game.board.addGarbageLines(count);
                if (toppedOut) {
                    game.screenFlow.endRound("topOut");
                }
            }
        }
    }

    /** Called after a line clear finishes - true if that clear just hit Sprint's target (and endRound() has already been kicked off). */
    checkSprintComplete() {
        const game = this.game;
        if (game.mode !== "sprint") return false;
        if (game.lines < this.def.sprintTarget) return false;
        game.screenFlow.endRound("sprintComplete");
        return true;
    }
}
