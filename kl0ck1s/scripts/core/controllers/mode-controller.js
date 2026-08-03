"use strict";

import {formatDuration} from "../shared/utils.js";

/**
 * Owns game-mode selection (Marathon/Sprint/Ultra/Survival/Cheese Race/Dig
 * Survival/Countdown) and the per-frame objective checks that are specific
 * to a mode: Sprint's 40-line finish line, Ultra's 3-minute clock,
 * Survival's periodic garbage, Cheese Race's dig-out-the-stack finish, Dig
 * Survival's endlessly-resupplied stack, Countdown's clear-to-survive
 * clock. Marathon has no extra objective - it's just the existing
 * unlimited/topping-out behavior with every mode-specific check below
 * skipped.
 */
export class ModeController {
    constructor(game) {
        this.game = game;
    }

    get def() {
        return this.game.gameModes[this.game.mode];
    }

    /** Every real, playable mode - i.e. every GAME_MODES key except the "random" picker entry itself. What resolveRandomMode() below picks from. */
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

    /** Cycles to the next/previous mode (dir = ±1) - the arrow-key counterpart to bindModeButtons()'s clicks. */
    changeMode(dir) {
        const game = this.game;
        const keys = Object.keys(game.gameModes);
        const currentIndex = keys.indexOf(game.mode);
        const nextMode = keys[(currentIndex + dir + keys.length) % keys.length];
        this.applyModeAndRerender(nextMode);
    }

    /**
     * If "Random" is the currently selected mode, swaps it out for one
     * randomly-picked real mode for the *duration of this round only* - same
     * effect as if the player had picked that mode themselves, but without
     * persisting the pick: game.settings.mode (and localStorage) keep
     * remembering "random" as the actual selection, since setMode() (which
     * saves) is deliberately NOT used here. Called from ScreenFlow.handleEnter()
     * right before the Start flow (mode-info screen, countdown, round) begins,
     * so everything downstream - mode-info's rules text, the HUD, the
     * leaderboard entry - already sees the resolved mode and needs no "random"
     * special-casing of its own. A no-op for any other mode. See
     * restoreSelectedMode() for the other half of this - putting game.mode
     * back once the round is over.
     */
    resolveRandomMode() {
        const game = this.game;
        if (!game.gameModes[game.mode]?.isRandom) return;
        const keys = this.randomizableModeKeys;
        const picked = keys[Math.floor(Math.random() * keys.length)];
        game.mode = picked;
        game.hud.update(game.stats);
    }

    /**
     * Puts game.mode back in sync with the player's persisted selection
     * (game.settings.mode) - the counterpart to resolveRandomMode() above.
     * Needed because resolveRandomMode() only overwrites game.mode for the
     * round itself, on purpose, so once we're back on a mode-picker screen
     * (idle / gameOver-saved) it has to be switched back to "random" (or
     * whatever's actually selected) rather than staying on whichever mode
     * got resolved last round. A no-op if nothing was ever swapped.
     */
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

    /** Resets per-round mode state - called from Game.prepareNewRound(). */
    reset() {
        const def = this.def;
        this.game.modeState = {
            garbageTimer: 0,
            digCleared: 0,
            countdownRemainingMs: def.countdownStartMs ?? 0,
        };
    }

    /**
     * Lays down a mode's starting board layout - called from
     * Game.prepareNewRound() right after the board itself has been reset.
     * Only Cheese Race and Dig Survival start with anything already on the
     * board (a `cheeseRows`-tall stack of one-gap-per-row garbage, built via
     * the same Board.addGarbageLines() Survival's periodic rise already
     * uses); every other mode starts on a completely empty board, same as
     * before this method existed.
     */
    setupBoard() {
        const game = this.game;
        const def = this.def;
        if (!def.cheeseRows) return;
        game.board.addGarbageLines(def.cheeseRows);
    }

    /**
     * True once the player has cleared as many lines this round as the
     * board started with (def.cheeseRows) - Cheese Race's actual finish
     * condition. Deliberately just a line count, exactly like Sprint's
     * sprintTarget check, NOT "every cell on the board is empty": requiring
     * a literal perfect-clear board state would mean the round almost never
     * actually ends, since any leftover overhang from a piece that didn't
     * complete a row would block it forever, even after all cheeseRows
     * garbage rows are long gone.
     */
    cheeseRaceComplete() {
        const game = this.game;
        const def = this.def;
        return game.lines >= def.cheeseRows;
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

    /**
     * Progress toward the objective as 0-100, or null for Marathon (no
     * objective bar at all). Sprint/Cheese Race/Dig Survival count up
     * toward a line target; Ultra/Survival/Countdown count up toward
     * their respective clocks running out. This is the single number that
     * drives the sidebar's objective progress bar - objectiveText() above
     * still supplies the label printed on top of it.
     */
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

    /**
     * How urgently the objective bar should read as "running out of time",
     * for the clock-driven objectives (Ultra's round clock, Survival's
     * next-garbage timer, Countdown's clear-or-die clock) - "danger" inside
     * the last 5s, "warning" inside the last 10s, otherwise null. Sprint/
     * Cheese Race/Dig Survival have no clock to run out, so they always
     * return null here; their progress reads via the neutral-to-"good"
     * color ramp applied directly from objectivePercent() instead.
     */
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

    /**
     * Which color scheme the sidebar's objective bar should use for this
     * mode: "ramp" for Sprint/Cheese Race/Dig Survival (fill color eases
     * from neutral toward "good" as the line count closes in on the
     * target), "urgency" for Ultra/Survival/Countdown (fill turns
     * yellow/red as their clock runs low, per objectiveUrgency() above),
     * or null for Marathon (no bar at all).
     */
    objectiveColorMode() {
        const game = this.game;
        if (game.mode === "sprint" || game.mode === "cheeseRace" || game.mode === "digSurvival") return "ramp";
        if (game.mode === "ultra" || game.mode === "survival" || game.mode === "countdown") return "urgency";
        return null;
    }

    /** Called every frame the round is actually running - Ultra's/Countdown's clocks and Survival's garbage timer all live here. */
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
                // addGarbageLines() shifts every existing row up by `count` but has no
                // notion of the currently-falling piece, so without this the piece would
                // stay at its old y while the stack rises underneath it - silently
                // changing (or removing) the gap it was about to drop into. Rising the
                // piece by the same amount keeps its position relative to the stack
                // exactly as it was the instant before the garbage landed.
                if (game.current) game.current.y -= count;
                if (toppedOut) {
                    game.screenFlow.endRound("topOut");
                }
            }
        }
    }

    /**
     * Called from PieceController.finishLineClear() right after a clear has
     * been tallied into game.lines/score, for the two mode-specific per-clear
     * side effects that aren't a finish condition on their own: Dig
     * Survival's endless garbage resupply (returns true if that resupply
     * just topped the player out - finishLineClear() must not spawn a new
     * piece in that case) and Countdown's per-clear time bonus.
     */
    onLinesCleared(cleared) {
        const game = this.game;
        const def = this.def;

        if (game.mode === "digSurvival") {
            game.modeState.digCleared += cleared;

            // Board.clearFullLines() (called just before this, in
            // finishLineClear()) already shifted everything down to fill the
            // gap - adding the same number of rows straight back at the
            // bottom is what keeps the stack "endless" instead of shrinking
            // like Cheese Race's. No falling piece to adjust for here (unlike
            // Survival's timer-driven rise above): this runs between a lock
            // and the next spawn, so there's nothing currently in the air.
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

    /**
     * Called after a line clear finishes - true if that clear just hit this
     * mode's finish condition (and endRound() has already been kicked off).
     * Sprint (line target), Cheese Race (the whole board finally empty) and
     * Dig Survival (dug the target line count) are the three modes with a
     * "win" reachable this way; Marathon/Ultra/Survival/Countdown all end
     * some other way instead (topping out, or their own clock).
     */
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
