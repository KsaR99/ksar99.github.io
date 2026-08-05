"use strict";

import {Piece} from "../game/piece.js";
import {pointsForHardDrop, pointsForSoftDrop} from "../game/scoring.js";
import {getKickTable, PIECE_CONTROLLABLE_STATES, T_FRONT_CORNERS} from "../game/game-constants.js";
import {getTightBounds} from "../shared/utils.js";
import {LINE_CLEAR_SOUND_PLAYBACK_RATE} from "../shared/config.js";

/** Grace window (ms) absorbing single-frame grounded/airborne flicker from in-place rotation before the "grounded" cue actually stops. */
const GROUNDED_GRACE_MS = 100;

/** Fallback duration (ms) for groundedSoundPlaybackRate() before the "grounded" clip has finished decoding - see SoundManager.getDuration(). */
const GROUNDED_SOUND_REFERENCE_DURATION_MS = 1500;


/**
 * Owns everything about the currently falling piece: movement, rotation (with
 * kicks), soft/hard drop, lock delay, spin detection and locking/line-clear
 * hand-off. Reads/writes the shared piece-related fields on the Game instance.
 */
export class PieceController {
    constructor(game) {
        this.game = game;
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
        game.next = game.bag.next();
        game.renderer.drawNext(game.next);
        this.snapToPointer();
    }

    spawnNext() {
        const game = this.game;
        game.current = new Piece(game.next, {cols: game.board.cols});
        game.statsTracker.registerPieceSpawn(game.current.type);
        game.next = game.bag.next();
        this.resetPerPieceState();
        game.renderer.drawNext(game.next);
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

    moveHorizontal(dir) {
        const game = this.game;
        if (!PIECE_CONTROLLABLE_STATES.has(game.state)) return;
        if (!game.board.collides(game.current, dir, 0)) {
            const fromX = game.getShiftDisplayX();
            game.current.x += dir;
            game.lastAction = "move";
            game.noteColStep();
            game.shiftAnim = game.settings.fallTrail
                ? {fromX, toX: game.current.x, elapsed: 0, duration: 60}
                : null;
            if (game.board.collides(game.current, 0, 1)) this.resetLockDelay();
            game.sensitivityCalibrationController?.notify("move", {x: game.current.x, via: "step"});
        }
    }

    handleHorizontalArrow(dir) {
        const game = this.game;
        if (game.state === "idle" || game.state === "gameOver-saved") {
            if (game.menuSelector === "mode") {
                game.modeController.changeMode(dir);
            } else {
                game.difficultyController.changeDifficulty(dir);
            }
        } else {
            this.moveHorizontal(dir);
        }
    }

    moveToColumn(targetColumn) {
        const game = this.game;
        if (!PIECE_CONTROLLABLE_STATES.has(game.state)) return;

        const bounds = getTightBounds(game.current.mask, game.current.width, game.current.height);
        const offsetX = bounds.minX || 0;
        targetColumn -= Math.floor((bounds.width - 1) / 2);
        targetColumn = Math.max(
            0,
            Math.min(targetColumn, game.board.cols - bounds.width)
        );
        let targetX = targetColumn - offsetX;

        targetX = game.sensitivityCalibrationController?.clampDragTargetX?.(targetX) ?? targetX;

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

        game.sensitivityCalibrationController?.notify("move", {x: game.current.x, via: "drag"});
    }

    softDrop() {
        const game = this.game;
        if (!PIECE_CONTROLLABLE_STATES.has(game.state)) return;
        if (game.board.collides(game.current, 0, 1)) return;

        ++game.current.y;
        game.lastAction = "move";
        game.statsTracker.addScore(pointsForSoftDrop(game.scoring));
        game.dropCounter = 0;
        game.noteRowStep();
        game.sensitivityCalibrationController?.notify("softDrop", {});
    }

    hardDrop() {
        const game = this.game;
        if (!PIECE_CONTROLLABLE_STATES.has(game.state)) return;
        if (game.hardDropUsed) return;

        game.hardDropUsed = true;

        const cellsDropped = game.board.getDropOffset(game.current);
        game.current.y += cellsDropped;

        game.statsTracker.addScore(pointsForHardDrop(cellsDropped, game.scoring));
        game.sensitivityCalibrationController?.notify("hardDrop", {});
        this.lockCurrentPiece();
        game.dropCounter = 0;
    }

    get180Kicks(piece, rotatedMask) {
        const fromBounds = getTightBounds(piece.mask, piece.width, piece.height);
        const toBounds = getTightBounds(rotatedMask, piece.width, piece.height);
        const baseDx = fromBounds.minX - toBounds.minX;
        const baseDy = fromBounds.minY - toBounds.minY;

        return [[0, 0], [1, 0], [-1, 0], [0, -1], [0, 1]]
            .map(([nx, ny]) => [baseDx + nx, baseDy + ny]);
    }

    /**
     * @param {number} [dir=1] - +1 for clockwise, -1 for counterclockwise, ±2 for 180°
     */
    rotate(dir = 1) {
        const game = this.game;
        if (!PIECE_CONTROLLABLE_STATES.has(game.state)) return;

        const rotatedMask = game.current.rotated(dir);
        const fromState = game.current.rotationState;
        const toState = (fromState + dir + 4) % 4;
        const kicks = Math.abs(dir) === 2
            ? this.get180Kicks(game.current, rotatedMask)
            : getKickTable(game.current.type)[`${fromState}>${toState}`] ?? [[0, 0]];

        for (const [dx, dy] of kicks) {
            if (!game.board.collides(game.current, dx, dy, rotatedMask)) {
                game.current.mask = rotatedMask;
                game.current.x += dx;
                game.current.y += dy;
                game.current.rotationState = toState;
                game.lastAction = "rotate";
                game.soundManager.play("rotate");
                if (game.board.collides(game.current, 0, 1)) this.resetLockDelay();

                game.rotationAnim = null;
                game.sensitivityCalibrationController?.notify("rotate", {});
                return;
            }
        }
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
        game.board.lockPiece(game.current);

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

    /**
     * dropRows[y] = how many rows y needs to visually fall by once the rows
     * in `fullRows` disappear (i.e. how many cleared rows sit below y).
     * Used to animate the remaining stack sliding down smoothly during the
     * clear animation, instead of snapping into place once it finishes.
     */
    buildDropRows(fullRows, rowCount) {
        const dropRows = new Array(rowCount).fill(0);
        for (let y = 0; y < rowCount; y++) {
            dropRows[y] = fullRows.reduce((count, clearedY) => count + (clearedY > y ? 1 : 0), 0);
        }
        return dropRows;
    }

    buildClearFragments(rows) {
        const game = this.game;
        const {board, renderer} = game;
        const size = renderer.boardConfig.CELL_SIZE;
        const cols = board.cols;
        const fragmentsPerAxis = 9;
        const fragSize = size / fragmentsPerAxis;
        const fragments = [];

        rows.forEach((y) => {
            for (let x = 0; x < cols; x++) {
                const colorIndex = board.colors[y * cols + x];
                if (!colorIndex) continue;
                const color = renderer.colorPalette[colorIndex];

                for (let fy = 0; fy < fragmentsPerAxis; fy++) {
                    for (let fx = 0; fx < fragmentsPerAxis; fx++) {
                        const startX = x * size + (fx + 0.5) * fragSize;
                        const startY = y * size + (fy + 0.2) * fragSize;

                        const angle = Math.random() * Math.PI * 2;
                        const distance = size * (0.2 + Math.random() * 0.5);

                        fragments.push({
                            startX,
                            startY,
                            dx: Math.cos(angle) * distance,
                            dy: Math.sin(angle) * distance,
                            rotation0: Math.random() * Math.PI * 2,
                            dRotation: (Math.random() - 0.5) * Math.PI * 6,
                            size: fragSize,
                            halfSize: fragSize / 2,
                            color: `oklch(from ${color} l c h / 0.55)`
                        });
                    }
                }
            }
        });

        return fragments;
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
        game.clearingFragments = [];
        game.clearingDropRows = [];
        game.dropCounter = 0;

        const toppedOutFromResupply = game.modeController.onLinesCleared(cleared);
        game.hud.update(game.stats);
        if (toppedOutFromResupply) return;
        if (game.modeController.checkObjectiveComplete()) return;

        game.state = "running";
        this.spawnNext();
    }
}
