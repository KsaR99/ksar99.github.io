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
        game.shiftAnim = null;
        game.hardDropUsed = false;
        game.clearingLines = [];
        game.clearingTimer = 0;
        game.resetFallTrail();

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
        game.shiftAnim = null;
        game.resetFallTrail();
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
     * Only does this if a pointer source is the one currently steering (per
     * the shared SteeringArbiter) - i.e. it steered more recently than any
     * keyboard movement/rotate/drop. Otherwise a resting pointer (e.g. the
     * player switched to keyboard controls mid-game while mouseControl is
     * still on) would keep yanking every new piece back to wherever it sits.
     */
    snapToPointer() {
        const game = this.game;
        if (!game.settings?.mouseControl) return;
        if (!game.steeringArbiter?.isPointerSteering()) return;
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
            const fromX = game.getShiftDisplayX();
            game.current.x += dir;
            game.lastAction = "move";
            game.noteColStep();
            // shiftAnim only exists to give the fall trail enough distinct
            // in-between x values to spread out horizontally (see
            // getRenderedPiece()) - with the trail off there's no reason to
            // ease the move, so snap instantly like before that feature existed.
            game.shiftAnim = game.settings.fallTrail
                ? {fromX, toX: game.current.x, elapsed: 0, duration: 60}
                : null;
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

        const fromX = game.getShiftDisplayX();

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
        game.noteColStep();
        game.shiftAnim = game.settings.fallTrail
            ? {fromX, toX: game.current.x, elapsed: 0, duration: 60}
            : null;

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
        game.noteRowStep();
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

    /**
     * 180° kicks aren't part of official SRS (see rotate() below), so instead
     * of a hand-guessed per-piece table, this derives the one geometrically
     * correct base offset straight from the mask data we already have: J, L,
     * S, T and Z all occupy the *top* half of their 3×3 box in state 0 but
     * the *bottom* half in state 2 (I is the same story in its 4×4 box, top
     * vs bottom row-pair) - a plain "try (0,0) first" kick table doesn't know
     * this and effectively lets the piece silently drop/shift a cell when
     * flipped, which is what looked like a "wrong" rotation for e.g. Z.
     * Comparing the tight bounds of the from/to masks gives the exact shift
     * needed to land the shape back in the same absolute board position
     * before trying any further wall-kick leniency.
     */
    get180Kicks(piece, rotatedMask) {
        const fromBounds = getTightBounds(piece.mask, piece.width, piece.height);
        const toBounds = getTightBounds(rotatedMask, piece.width, piece.height);
        const baseDx = fromBounds.minX - toBounds.minX;
        const baseDy = fromBounds.minY - toBounds.minY;

        // Small extra nudges tried after the base correction, for leniency
        // near walls/stacks - same spirit as a normal 5-offset kick table.
        return [[0, 0], [1, 0], [-1, 0], [0, -1], [0, 1]]
            .map(([nx, ny]) => [baseDx + nx, baseDy + ny]);
    }

    /**
     * @param {number} [dir=1] - +1 for clockwise, -1 for counterclockwise, ±2 for 180°
     */
    rotate(dir = 1) {
        const game = this.game;
        if (game.state !== "running") return;

        const rotatedMask = game.current.rotated(dir);
        const fromState = game.current.rotationState;
        const toState = (fromState + dir + 4) % 4;
        const kicks = Math.abs(dir) === 2
            ? this.get180Kicks(game.current, rotatedMask)
            : getKickTable(game.current.type)[`${fromState}>${toState}`] ?? [[0, 0]];

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

                // Skip the position tween for 180s (see comment below) and
                // for any rotation that didn't actually move the piece (e.g.
                // O, whose kick table is always [0,0] - so this is every
                // single O rotation). With no from->to distance there's
                // nothing to animate, and letting the tween run anyway would
                // needlessly suppress the falling-piece interpolation in
                // getRenderedPiece() for its whole duration - visible as a
                // brief stutter in the fall, most noticeable on O since it
                // hits this on every rotate press.
                //
                // For 180s specifically: the tween interpolates x/y while the
                // mask has already swapped to its new shape, which is
                // invisible for 90° turns (the shape looks different anyway)
                // but shows up as a visible "jump" for pieces with true 180°
                // self-symmetry (I, S, Z) - mid-tween, the new mask's
                // internal row/column offset combined with the not-yet-
                // arrived position briefly misaligns the shape even though
                // the start and end positions are both correct.
                const noPositionChange = game.current.x === fromX && game.current.y === fromY;
                game.rotationAnim = (Math.abs(dir) === 2 || noPositionChange)
                    ? null
                    : {fromX, fromY, toX: game.current.x, toY: game.current.y, elapsed: 0, duration: 60};
                return;
            }
        }
    }

    /** Convenience wrapper for a 180° rotation - see rotate(). */
    rotate180() {
        this.rotate(2);
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
