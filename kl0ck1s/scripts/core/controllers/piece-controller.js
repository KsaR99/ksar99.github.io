"use strict";

import {Piece} from "../game/piece.js";
import {pointsForHardDrop, pointsForSoftDrop} from "../game/scoring.js";
import {getKickTable, T_FRONT_CORNERS} from "../game/game-constants.js";
import {getTightBounds} from "../shared/utils.js";

/**
 * Owns everything about the currently falling piece: movement, rotation (with
 * kicks), soft/hard drop, lock delay, spin detection and locking/line-clear
 * hand-off. Reads/writes the shared piece-related fields on the Game instance.
 */
export class PieceController {
    constructor(game) {
        this.game = game;
    }

    /** Resets piece-related state for a brand new round. */
    reset() {
        const game = this.game;
        game.dropCounter = 0;
        game.lockDelayTimer = 0;
        game.lockDelayResets = 0;
        game.groundedTime = 0;
        game.lastAction = null;
        game.pendingSpin = null;
        game.rotationAnim = null;
        game.hardDropUsed = false;
        game.clearingLines = [];
        game.clearingTimer = 0;

        game.current = new Piece(game.bag.next(), {cols: game.board.cols});
        game.statsTracker.registerPieceSpawn(game.current.type);
        game.next = game.bag.next();
        game.renderer.drawNext(game.next);
        this.snapToPointer();
    }

    spawnNext() {
        const game = this.game;
        game.current = new Piece(game.next, {cols: game.board.cols});
        game.statsTracker.registerPieceSpawn(game.current.type);
        game.next = game.bag.next();
        game.hardDropUsed = false;
        game.lockDelayTimer = 0;
        game.lockDelayResets = 0;
        game.groundedTime = 0;
        game.lastAction = null;
        game.rotationAnim = null;
        game.renderer.drawNext(game.next);
        this.snapToPointer();

        if (game.board.collides(game.current, 0, 0)) {
            game.screenFlow.gameOver().then();
        }
    }

    /**
     * Places a freshly spawned piece under the last known mouse position (if
     * any) instead of waiting for the next mousemove. Without this, a piece
     * spawning right after a line-clear animation (during which mousemove is
     * ignored) would sit at its default column until the mouse moves again —
     * felt like the mouse control freezing or lagging after a hard drop.
     *
     * Only does this if the mouse is the input currently steering the piece
     * (i.e. it moved more recently than any keyboard movement/rotate/drop).
     * Otherwise a resting pointer (e.g. player switched to keyboard controls
     * mid-game while mouseControl is still on) would keep yanking every new
     * piece back to wherever the mouse happens to sit.
     */
    snapToPointer() {
        const game = this.game;
        if (!game.settings?.mouseControl) return;
        if (!game.usingMouseSteering) return;
        if (game.pointerClientX == null) return;

        const column = game.renderer.columnFromClientX(game.pointerClientX);
        this.moveToColumn(column);
    }

    resetLockDelay() {
        const game = this.game;
        if (game.lockDelayResets >= game.scoring.LOCK_DELAY_MAX_RESETS) return;
        game.lockDelayTimer = 0;
        ++game.lockDelayResets;
    }

    moveHorizontal(dir) {
        const game = this.game;
        if (game.state !== "running") return;
        if (!game.board.collides(game.current, dir, 0)) {
            game.current.x += dir;
            game.lastAction = "move";
            if (game.board.collides(game.current, 0, 1)) this.resetLockDelay();
        }
    }

    /** Arrow keys double up as difficulty pickers on the idle/game-over screens. */
    handleHorizontalArrow(dir) {
        const game = this.game;
        if (game.state === "idle" || game.state === "gameOver-saved") {
            game.difficultyController.changeDifficulty(dir);
        } else {
            this.moveHorizontal(dir);
        }
    }

    /**
     * Mouse control: jumps the piece straight to the column under the pointer
     * in a single collision check, rather than stepping one column at a time.
     * Stepping column-by-column could get stuck on an intermediate obstacle
     * even when the target column itself was reachable — this fixes that
     * and is cheaper per mousemove event besides.
     */
    moveToColumn(targetColumn) {
        const game = this.game;
        if (game.state !== "running") return;

        const bounds = getTightBounds(game.current.mask, game.current.width, game.current.height);
        // bounds.minX is the piece's visible shape offset *within* its mask
        // grid (nonzero for shapes that aren't flush with the mask's left
        // edge, e.g. some rotation states of J/L/S/Z). targetColumn below is
        // in "visible column" space, but game.current.x is the mask's own
        // origin, so it has to be shifted back by that offset - otherwise the
        // piece can never be pushed far enough left to put its visible edge
        // at column 0.
        const offsetX = bounds.minX || 0;
        // Centers the piece under the cursor. For odd widths this is exact.
        // For even widths there's no single center column, so a choice has
        // to be made either way - floor(width/2) here would put the cursor
        // over the piece's *right*-of-center column, making every even-width
        // shape (O, horizontal I, ...) consistently land half a cell to the
        // left of where the cursor actually was. floor((width-1)/2) instead
        // puts the cursor over the *left*-of-center column, matching where
        // players actually expect the piece to land.
        targetColumn -= Math.floor((bounds.width - 1) / 2);
        targetColumn = Math.max(
            0,
            Math.min(targetColumn, game.board.cols - bounds.width)
        );
        const targetX = targetColumn - offsetX;

        if (targetX === game.current.x) return;

        while (
            game.current.x < targetX &&
            !game.board.collides(game.current, 1, 0)
            ) {
            game.current.x++;
        }

        while (
            game.current.x > targetX &&
            !game.board.collides(game.current, -1, 0)
            ) {
            game.current.x--;
        }

        game.lastAction = "move";

        if (game.board.collides(game.current, 0, 1)) {
            this.resetLockDelay();
        }
    }

    softDrop() {
        const game = this.game;
        if (game.state !== "running") return;
        if (game.board.collides(game.current, 0, 1)) return;

        ++game.current.y;
        game.lastAction = "move";
        game.statsTracker.addScore(pointsForSoftDrop(game.scoring));
        game.dropCounter = 0;
    }

    hardDrop() {
        const game = this.game;
        if (game.state !== "running") return;
        if (game.hardDropUsed) return;

        game.hardDropUsed = true;

        const cellsDropped = game.board.getDropOffset(game.current);
        game.current.y += cellsDropped;

        game.statsTracker.addScore(pointsForHardDrop(cellsDropped, game.scoring));
        this.lockCurrentPiece();
        game.dropCounter = 0;
    }

    rotate() {
        const game = this.game;
        if (game.state !== "running") return;

        const rotatedMask = game.current.rotated();
        const fromState = game.current.rotationState;
        const toState = (fromState + 1) % 4;
        const kicks = getKickTable(game.current.type)[`${fromState}>${toState}`];

        for (const [dx, dy] of kicks) {
            if (!game.board.collides(game.current, dx, dy, rotatedMask)) {
                const fromX = game.current.x;
                const fromY = game.current.y;

                game.current.mask = rotatedMask;
                game.current.x += dx;
                game.current.y += dy;
                game.current.rotationState = toState;
                game.lastAction = "rotate";
                if (game.board.collides(game.current, 0, 1)) this.resetLockDelay();

                game.rotationAnim = {fromX, fromY, toX: game.current.x, toY: game.current.y, elapsed: 0, duration: 60};
                return;
            }
        }
    }

    detectSpin() {
        const game = this.game;
        if (game.lastAction !== "rotate") return null;
        if (game.board.countBlockedCorners(game.current) < 3) return null;

        if (game.current.type !== "T") {
            return {type: game.current.type, mini: false};
        }

        const flags = game.board.getCornerFlags(game.current);
        const frontKeys = T_FRONT_CORNERS[game.current.rotationState % 4];
        const frontBlocked = frontKeys.every((key) => flags[key]);

        return {type: "T", mini: !frontBlocked};
    }

    lockCurrentPiece() {
        const game = this.game;
        const spin = this.detectSpin();

        game.soundManager.play("drop");
        game.board.lockPiece(game.current);

        const fullRows = game.board.getFullLineIndices();

        if (fullRows.length === 0) {
            if (spin) game.statsTracker.registerSpin(spin, 0);
            game.currentCombo = 0;
            this.spawnNext();
            return;
        }

        game.pendingSpin = spin;
        game.soundManager.play("lineClear");
        game.state = "clearing";
        game.clearingLines = fullRows;
        game.clearingTimer = 0;
    }

    finishLineClear() {
        const game = this.game;
        const cleared = game.board.clearFullLines();
        if (game.pendingSpin) game.statsTracker.registerSpin(game.pendingSpin, cleared);
        game.statsTracker.registerLineClears(cleared, false);

        ++game.currentCombo;
        game.maxCombo = Math.max(game.maxCombo, game.currentCombo);

        game.pendingSpin = null;
        game.clearingLines = [];
        game.dropCounter = 0;
        game.state = "running";
        this.spawnNext();
    }
}
