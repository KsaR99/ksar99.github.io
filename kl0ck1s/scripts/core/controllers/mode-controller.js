"use strict";

import {formatDuration} from "../shared/utils.js";

export class ModeController {
    constructor(game) {
        this.game = game;
    }

    get def() {
        return this.game.gameModes[this.game.mode];
    }

    get randomizableModeKeys() {
        const game = this.game;
        return Object.keys(game.gameModes).filter((key) => !game.gameModes[key].isRandom);
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
        game.hud.update(game.stats);
    }

    restoreSelectedMode() {
        const game = this.game;
        if (game.settings.mode && game.gameModes[game.settings.mode] && game.mode !== game.settings.mode) {
            game.mode = game.settings.mode;
        }
    }

    applyModeAndRerender(mode) {
        const game = this.game;
        this.setMode(mode);

        if (game.state === "idle") {
            game.screenFlow.renderIdleScreen(game.leaderboard.forMode(game.mode));
        } else if (game.state === "gameOver-saved" && game.currentGameOverSaved) {
            const {entry} = game.currentGameOverSaved;
            game.screenFlow.renderGameOverSaved(game.leaderboard.forMode(game.mode), entry);
        }
    }

    reset() {
        const def = this.def;
        this.game.modeState = {
            garbageTimer: 0,
            digCleared: 0,
            countdownRemainingMs: def.countdownStartMs ?? 0,
        };
    }

    setupBoard() {
        const game = this.game;
        const def = this.def;
        if (!def.cheeseRows) return;
        game.board.addGarbageLines(def.cheeseRows);
    }

    cheeseRaceComplete() {
        const game = this.game;
        const def = this.def;
        return game.lines >= def.cheeseRows;
    }

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

        if (game.mode === "cheeseRace") {
            return `${game.lines} / ${def.cheeseRows}`;
        }

        if (game.mode === "digSurvival") {
            return `${game.modeState.digCleared} / ${def.digTarget}`;
        }

        if (game.mode === "countdown") {
            return formatDuration(Math.max(0, game.modeState.countdownRemainingMs));
        }

        return null;
    }

    objectivePercent() {
        const game = this.game;
        const def = this.def;

        if (game.mode === "sprint") {
            return Math.min(100, (game.lines / def.sprintTarget) * 100);
        }

        if (game.mode === "ultra") {
            return Math.min(100, (game.elapsedMs / def.timeLimitMs) * 100);
        }

        if (game.mode === "survival") {
            return Math.min(100, (game.modeState.garbageTimer / def.garbageIntervalMs) * 100);
        }

        if (game.mode === "cheeseRace") {
            return Math.min(100, (game.lines / def.cheeseRows) * 100);
        }

        if (game.mode === "digSurvival") {
            return Math.min(100, (game.modeState.digCleared / def.digTarget) * 100);
        }

        if (game.mode === "countdown") {
            return Math.min(100, (game.modeState.countdownRemainingMs / def.countdownStartMs) * 100);
        }

        return null;
    }

    objectiveUrgency() {
        const game = this.game;
        const def = this.def;
        let remainingMs;

        if (game.mode === "ultra") {
            remainingMs = def.timeLimitMs - game.elapsedMs;
        } else if (game.mode === "survival") {
            remainingMs = def.garbageIntervalMs - game.modeState.garbageTimer;
        } else if (game.mode === "countdown") {
            remainingMs = game.modeState.countdownRemainingMs;
        } else {
            return null;
        }

        if (remainingMs <= 5000) return "danger";
        if (remainingMs <= 10000) return "warning";
        return null;
    }

    objectiveColorMode() {
        const game = this.game;
        if (["sprint", "cheeseRace", "digSurvival"].includes(game.mode)) {
            return "ramp";
        }

        if (["ultra", "survival", "countdown"].includes(game.mode)) {
            return "urgency";
        }

        return null;
    }

    update(delta) {
        const game = this.game;
        const def = this.def;

        if (game.mode === "ultra" && game.elapsedMs >= def.timeLimitMs) {
            game.screenFlow.endRound("timeUp");
            return;
        }

        if (game.mode === "countdown") {
            game.modeState.countdownRemainingMs -= delta;
            if (game.modeState.countdownRemainingMs <= 0) {
                game.screenFlow.endRound("timeUp");
                return;
            }
        }

        if (game.mode === "survival" && def.garbage) {
            game.modeState.garbageTimer += delta;
            if (game.modeState.garbageTimer >= def.garbageIntervalMs) {
                game.modeState.garbageTimer = 0;
                const span = def.garbageLinesMax - def.garbageLinesMin + 1;
                const count = def.garbageLinesMin + Math.floor(Math.random() * span);
                const {toppedOut} = game.board.addGarbageLines(count);
                if (game.current) game.current.y -= count;
                if (toppedOut) {
                    game.screenFlow.endRound("topOut");
                }
            }
        }
    }

    onLinesCleared(cleared) {
        const game = this.game;
        const def = this.def;

        if (game.mode === "digSurvival") {
            game.modeState.digCleared += cleared;

            const {toppedOut} = game.board.addGarbageLines(cleared);
            if (toppedOut) {
                game.screenFlow.endRound("topOut");
                return true;
            }
        }

        if (game.mode === "countdown") {
            const bonusMs = def.countdownBonusMs[Math.min(cleared, def.countdownBonusMs.length - 1)];
            game.modeState.countdownRemainingMs += bonusMs;
        }

        return false;
    }

    checkObjectiveComplete() {
        const game = this.game;
        const def = this.def;

        if (game.mode === "sprint" && game.lines >= def.sprintTarget) {
            game.screenFlow.endRound("sprintComplete");
            return true;
        }

        if (game.mode === "cheeseRace" && this.cheeseRaceComplete()) {
            game.screenFlow.endRound("cheeseClear");
            return true;
        }

        if (game.mode === "digSurvival" && game.modeState.digCleared >= def.digTarget) {
            game.screenFlow.endRound("digComplete");
            return true;
        }

        return false;
    }
}
