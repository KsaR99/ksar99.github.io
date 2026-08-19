"use strict";

import {BaseMode} from "./base-mode.js";

export class ZenMode extends BaseMode {
    objectiveText() {
        return `${this.zenHeight()}`;
    }

    onLinesCleared(_cleared) {
        this.maybeGiveBackZenOverflow();
        return false;
    }

    highestFilledRow() {
        const board = this.game.board;
        for (let y = 0; y < board.rows; y++) {
            if (board.occupancy[y] !== 0) return y;
        }
        return board.rows;
    }

    zenHeight() {
        const game = this.game;
        const board = game.board;
        const stackHeight = board.rows - this.highestFilledRow();
        return (game.modeState.zenOverflowUsed ?? 0) + stackHeight;
    }

    maybeApplyZenOverflow() {
        const game = this.game;
        const def = this.def;
        if (!def.zenOverflow) return;

        const board = game.board;
        const highestFilledRow = this.highestFilledRow();

        if (highestFilledRow > def.zenOverflowThresholdRow) return;

        const used = game.modeState.zenOverflowUsed ?? 0;
        const remaining = def.zenOverflowMaxRows - used;
        if (remaining <= 0) return;

        const wanted = Math.min(def.zenOverflowShiftRows, remaining);
        const shifted = board.shiftDown(wanted);
        if (shifted <= 0) return;

        game.modeState.zenOverflowUsed = used + shifted;
        game.startZenShiftAnimation?.(shifted);
    }

    maybeGiveBackZenOverflow() {
        const game = this.game;
        const def = this.def;
        if (!def.zenOverflow) return;

        const used = game.modeState.zenOverflowUsed ?? 0;
        if (used <= 0) return;

        const giveBackUsed = game.modeState.zenGiveBackUsed ?? 0;
        const giveBackRemaining = def.zenGiveBackMaxRows - giveBackUsed;
        if (giveBackRemaining <= 0) return;

        const board = game.board;
        const shiftRows = def.zenOverflowShiftRows;
        const safeHeadroom = this.highestFilledRow() - def.zenOverflowThresholdRow - shiftRows;
        if (safeHeadroom < shiftRows) return;

        const wanted = Math.min(shiftRows, used, giveBackRemaining);
        const shifted = board.shiftUp(wanted);
        if (shifted <= 0) return;

        game.modeState.zenOverflowUsed = used - shifted;
        game.modeState.zenGiveBackUsed = giveBackUsed + shifted;
        game.startZenShiftAnimation?.(-shifted);
    }
}
