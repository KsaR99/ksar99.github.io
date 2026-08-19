"use strict";

export class BaseMode {
    constructor(game) {
        this.game = game;
    }

    get def() {
        return this.game.gameModes[this.game.mode];
    }

    urgencyFromRemainingMs(remainingMs) {
        if (remainingMs <= 5000) return "danger";
        if (remainingMs <= 10000) return "warning";
        return null;
    }

    setupBoard() {
        const def = this.def;
        if (!def.cheeseRows) return;
        this.game.board.addGarbageLines(def.cheeseRows);
    }

    objectiveText() {
        return null;
    }

    objectivePercent() {
        return null;
    }

    objectiveUrgency() {
        return null;
    }

    objectiveColorMode() {
        return null;
    }

    hardcoreMaskFromRow() {
        return null;
    }

    update(_delta) {
    }

    onLinesCleared(_cleared) {
        return false;
    }

    checkObjectiveComplete() {
        return false;
    }
}
