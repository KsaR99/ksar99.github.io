"use strict";

import {Piece} from "../game/piece.js";
import {pointsForHardDrop, pointsForSoftDrop} from "../game/scoring.js";
import {
    getKickTable,
    PIECE_CONTROLLABLE_STATES,
    ROTATION_ANIM_180_DURATION_MS,
    ROTATION_ANIM_DURATION_MS,
    T_FRONT_CORNERS,
} from "../game/game-constants.js";
import {forEachShapeCell, getTightBounds} from "../shared/utils.js";
import {LINE_CLEAR_SOUND_PLAYBACK_RATE, NEXT_PREVIEW_QUEUE_SIZE} from "../shared/config.js";

const GROUNDED_GRACE_MS = 100;
const GROUNDED_SOUND_REFERENCE_DURATION_MS = 1500;

export class PieceController {
    constructor(game) {
        this.game = game;
    }

    canControlPiece() {
        const game = this.game;
        return PIECE_CONTROLLABLE_STATES.has(game.state) && !game.multiplayerOptionsOverlayOpen;
    }

    reset() {
        const game = this.game;
        game.dropCounter = 0;
        game.pendingSpin = null;
        game.clearingLines = [];
        game.clearingFragments = [];
        game.clearingDropRows = [];
        game.clearingTimer = 0;
        this.resetPerPieceState();

        game.current = new Piece(game.bag.next(), {cols: game.board.cols});
        game.statsTracker.registerPieceSpawn(game.current.type);
        game.nextQueue = game.bag.peek(NEXT_PREVIEW_QUEUE_SIZE);
        game.renderer.drawNext(game.nextQueue);
        this.snapToPointer();
    }

    spawnNext() {
        const game = this.game;
        game.modeController.maybeApplyZenOverflow();
        game.current = new Piece(game.bag.next(), {cols: game.board.cols});
        game.statsTracker.registerPieceSpawn(game.current.type);
        game.nextQueue = game.bag.peek(NEXT_PREVIEW_QUEUE_SIZE);
        this.resetPerPieceState();
        game.renderer.drawNext(game.nextQueue);
        this.snapToPointer();

        if (game.board.collides(game.current, 0, 0)) {
            game.screenFlow.gameOver().then();
        }
    }

    resetPerPieceState() {
        const game = this.game;
        game.hardDropUsed = false;
        game.lockDelayTimer = 0;
        game.lockDelayResets = 0;
        game.groundedTime = 0;
        this.stopGameplaySounds();
        game.isGrounded = false;
        game.rawGrounded = false;
        game.groundedGraceTimer = 0;
        game.groundedSoundRate = 1;
        game.lastAction = null;
        game.rotationAnim = null;
        game.shiftAnim = null;
        game.resetFallTrail();
    }

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

    /**
     * Detects the exact moment the falling piece first touches down
     *
     * @param {boolean} grounded
     * @param {number} delta - ms elapsed this frame, used to time the grace window
     */
    updateGrounded(grounded, delta) {
        const game = this.game;

        if (grounded) {
            game.groundedGraceTimer = 0;
            if (!game.isGrounded) {
                const resumed = game.groundedSoundId != null && game.soundManager.resume(game.groundedSoundId);
                if (!resumed) {
                    const rate = this.groundedSoundPlaybackRate();
                    game.groundedSoundId = game.soundManager.play("grounded", {playbackRate: rate});
                    game.groundedSoundRate = rate;
                }
                game.isGrounded = true;
            }

            return;
        }

        if (!game.isGrounded) return;

        game.groundedGraceTimer += delta;
        if (game.groundedGraceTimer >= GROUNDED_GRACE_MS) {
            this.pauseGroundedSound();
            game.isGrounded = false;
            game.groundedGraceTimer = 0;
        }
    }

    groundedSoundPlaybackRate() {
        const durationSeconds = this.game.soundManager.getDuration("grounded");
        const durationMs = durationSeconds != null
            ? durationSeconds * 1000
            : GROUNDED_SOUND_REFERENCE_DURATION_MS;
        return durationMs / this.game.getMaxGroundedTime();
    }

    pauseGroundedSound() {
        const game = this.game;
        if (game.groundedSoundId == null) return;
        game.soundManager.pause(game.groundedSoundId);
    }

    stopGroundedSound() {
        const game = this.game;
        if (game.groundedSoundId == null) return;
        game.soundManager.stop(game.groundedSoundId);
        game.groundedSoundId = null;
    }

    fallingSoundPlaybackRate() {
        return this.game.getFallingSoundRate();
    }

    updateFalling() {
        const game = this.game;

        if (game.isGrounded) {
            this.stopFallingSound();
            return;
        }

        const rate = this.fallingSoundPlaybackRate();

        if (game.fallingSoundId == null) {
            game.fallingSoundId = game.soundManager.play("falling", {loop: true, playbackRate: rate});
            return;
        }

        game.soundManager.setPlaybackRate(game.fallingSoundId, rate);
    }

    stopFallingSound() {
        const game = this.game;
        if (game.fallingSoundId == null) return;
        game.soundManager.stop(game.fallingSoundId);
        game.fallingSoundId = null;
    }

    stopGameplaySounds() {
        this.stopGroundedSound();
        this.stopFallingSound();
    }

    stopAllGameplaySounds() {
        this.stopGameplaySounds();
        this.game.soundManager.stopCategory("sfx");
        this.game.soundManager.stopCategory("voices");
    }

    moveHorizontal(dir, isRepeat = false) {
        const game = this.game;
        if (!this.canControlPiece()) return;
        if (!game.board.collides(game.current, dir, 0)) {
            const fromX = game.getShiftDisplayX();
            game.current.x += dir;
            game.lastAction = "move";
            game.noteColStep();
            if (isRepeat) game.renderer.shakeMove(dir);
            game.shiftAnim = game.settings.fallTrail
                ? {fromX, toX: game.current.x, elapsed: 0, duration: 60}
                : null;
            if (game.board.collides(game.current, 0, 1)) {
                this.resetLockDelay();
                game.rawGrounded = true;
                game.dropCounter = 0;
            }
        }
    }

    handleHorizontalArrow(dir, isRepeat = false) {
        const game = this.game;
        if (game.state === "idle") {
            if (game.menuSelector === "mode") {
                game.modeController.changeMode(dir);
            } else {
                game.difficultyController.changeDifficulty(dir);
            }
        } else {
            this.moveHorizontal(dir, isRepeat);
        }
    }

    moveToColumn(targetColumn) {
        const game = this.game;
        if (!this.canControlPiece()) return;

        const bounds = getTightBounds(game.current.mask, game.current.width, game.current.height);
        const offsetX = bounds.minX || 0;
        targetColumn -= Math.floor((bounds.width - 1) / 2);
        targetColumn = Math.max(
            0,
            Math.min(targetColumn, game.board.cols - bounds.width)
        );
        let targetX = targetColumn - offsetX;

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
            game.rawGrounded = true;
            game.dropCounter = 0;
        }
    }

    softDrop() {
        const game = this.game;
        if (!this.canControlPiece()) return;
        if (game.board.collides(game.current, 0, 1)) return;

        ++game.current.y;
        game.lastAction = "move";
        game.statsTracker.addScore(pointsForSoftDrop(game.scoring));
        game.dropCounter = 0;
        game.noteRowStep();
        game.shiftAnim = null;
    }

    hardDrop() {
        const game = this.game;
        if (!this.canControlPiece()) return;
        if (game.hardDropUsed) return;

        game.hardDropUsed = true;

        const cellsDropped = game.board.getDropOffset(game.current);
        game.current.y += cellsDropped;

        game.statsTracker.addScore(pointsForHardDrop(cellsDropped, game.scoring));
        game.renderer.shakeHardDrop();
        game.beginHardDropTrail(game.current, cellsDropped);
        game.beginHardDropImpactFlash(game.current);
        game.multiplayerController?.notifyHardDropTrail();
        this.lockCurrentPiece();
        game.dropCounter = 0;
    }

    find180Kick(piece) {
        const game = this.game;
        const fromState = piece.rotationState;
        const firstState = (fromState + 1) % 4;
        const finalState = (fromState + 2) % 4;
        const firstMask = piece.rotated(1);
        const finalMask = piece.rotated(2);

        const firstKicks = getKickTable(piece.type)[`${fromState}>${firstState}`] ?? [[0, 0]];
        const secondKicks = getKickTable(piece.type)[`${firstState}>${finalState}`] ?? [[0, 0]];

        for (const [dx1, dy1] of firstKicks) {
            if (game.board.collides(piece, dx1, dy1, firstMask)) continue;
            if (!this.pieceHasVisibleCell(piece, dx1, dy1, firstMask)) continue;

            for (const [dx2, dy2] of secondKicks) {
                const totalDx = dx1 + dx2;
                const totalDy = dy1 + dy2;

                if (game.board.collides(piece, totalDx, totalDy, finalMask)) continue;
                if (!this.pieceHasVisibleCell(piece, totalDx, totalDy, finalMask)) continue;

                return [totalDx, totalDy];
            }
        }

        return null;
    }

    pieceFullyVisible(piece, offsetX, offsetY, mask) {
        let fully = true;
        forEachShapeCell(mask, piece.width, piece.height, (r) => {
            if (piece.y + r + offsetY < 0) fully = false;
        });
        return fully;
    }

    pieceHasVisibleCell(piece, offsetX, offsetY, mask) {
        let visible = false;
        forEachShapeCell(mask, piece.width, piece.height, (r) => {
            if (piece.y + r + offsetY >= 0) visible = true;
        });
        return visible;
    }

    /**
     * Rotate the active piece using SRS kicks and animate the final state
     * around the piece's actual SRS pivot.
     *
     * @param {number} [dir=1] - +1 clockwise, -1 counter-clockwise, 2 for 180°
     */
    rotate(dir = 1) {
        const game = this.game;
        if (!this.canControlPiece()) return;

        if (game.rotationAnim) return;

        const piece = game.current;
        const fromState = piece.rotationState;
        const normalizedDir = dir === 2 ? 2 : (dir < 0 ? -1 : 1);
        const toState = (fromState + normalizedDir + 4) % 4;
        const rotatedMask = piece.rotated(normalizedDir);

        const fromX = piece.x;
        const fromY = piece.y;

        let chosen = null;

        if (Math.abs(normalizedDir) === 2) {
            chosen = this.find180Kick(piece);
        } else {
            const kicks = getKickTable(piece.type)[`${fromState}>${toState}`] ?? [[0, 0]];
            const legalKicks = kicks.filter(([dx, dy]) =>
                !game.board.collides(piece, dx, dy, rotatedMask)
            );

            chosen = legalKicks.find(([dx, dy]) =>
                this.pieceFullyVisible(piece, dx, dy, rotatedMask)
            ) ?? legalKicks.find(([dx, dy]) =>
                this.pieceHasVisibleCell(piece, dx, dy, rotatedMask)
            ) ?? null;
        }

        if (!chosen) return;

        const [dx, dy] = chosen;
        piece.mask = rotatedMask;
        piece.x += dx;
        piece.y += dy;
        piece.rotationState = toState;
        game.lastAction = "rotate";
        game.soundManager.play("rotate");

        if (game.board.collides(piece, 0, 1)) this.resetLockDelay();

        const is180 = Math.abs(normalizedDir) === 2;
        game.rotationAnim = {
            fromX,
            fromY,
            toX: piece.x,
            toY: piece.y,
            fromAngle: is180 ? 180 : -normalizedDir * 90,
            elapsed: 0,
            duration: is180 ? ROTATION_ANIM_180_DURATION_MS : ROTATION_ANIM_DURATION_MS,
        };
    }

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
        const isHardDrop = game.hardDropUsed;

        this.stopGameplaySounds();
        game.soundManager.play(isHardDrop ? "drop" : "pieceLock");
        if (!isHardDrop) {
            game.beginLockImpactFlash(game.current);
            game.multiplayerController?.notifyLockImpactFlash();
        }
        game.board.lockPiece(game.current);
        game.renderer.notifyPieceLocked(game.current, game.board);

        const fullRows = game.board.getFullLineIndices();

        if (fullRows.length === 0) {
            if (spin) game.statsTracker.registerSpin(spin, 0);
            game.currentCombo = 0;
            this.spawnNext();
            return;
        }

        game.pendingSpin = spin;
        const clearedCount = Math.min(fullRows.length, 4);
        game.soundManager.play(`lineClear${clearedCount}`, {playbackRate: LINE_CLEAR_SOUND_PLAYBACK_RATE});
        game.state = "clearing";
        game.clearingLines = fullRows;
        game.clearingFragments = this.buildClearFragments(fullRows);
        game.clearingDropRows = this.buildDropRows(fullRows, game.board.rows);
        game.clearingTimer = 0;
    }

    buildDropRows(fullRows, rowCount) {
        const dropRows = new Uint8Array(rowCount);
        for (let y = 0; y < rowCount; y++) {
            dropRows[y] = fullRows.reduce((count, clearedY) => count + (clearedY > y ? 1 : 0), 0);
        }
        return dropRows;
    }

    buildClearFragments(rows) {
        const {board, renderer} = this.game;
        return renderer.buildClearFragments({
            cells: board.colors,
            cols: board.cols,
            rows: board.rows,
            lineIndices: rows,
        });
    }

    finishLineClear() {
        const game = this.game;
        const clearedRowIndices = game.clearingLines;
        const cleared = game.board.clearFullLines();
        game.renderer.notifyLinesCleared(game.board, clearedRowIndices);
        if (game.pendingSpin) game.statsTracker.registerSpin(game.pendingSpin, cleared);
        game.statsTracker.registerLineClears(cleared, false);

        ++game.currentCombo;
        game.maxCombo = Math.max(game.maxCombo, game.currentCombo);

        game.pendingSpin = null;
        game.clearingLines = [];
        game.clearingFragments = [];
        game.clearingDropRows = [];
        game.dropCounter = 0;

        const toppedOutFromResupply = game.modeController.onLinesCleared(cleared);
        if (toppedOutFromResupply) return;
        if (game.modeController.checkObjectiveComplete()) return;

        game.state = "running";
        this.spawnNext();
    }
}
