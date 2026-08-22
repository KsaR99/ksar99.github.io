// @ts-nocheck
import type {Game} from "../game/game.js";
import {pointsForCascadeChain} from "../game/scoring.js";
import {
    PIECE_CONTROLLABLE_STATES,
    ROTATION_ANIM_180_DURATION_MS,
    ROTATION_ANIM_DURATION_MS,
    T_FRONT_CORNERS,
} from "../game/game-constants.js";
import {getTightBounds} from "../shared/utils.js";
import {LINE_CLEAR_SOUND_PLAYBACK_RATE, NEXT_PREVIEW_QUEUE_SIZE} from "../shared/config.js";

"use strict";

const GROUNDED_GRACE_MS = 100;
const GROUNDED_SOUND_REFERENCE_DURATION_MS = 1500;

export class PieceController {

    game: Game;

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
        game.clearingDropGrid = null;
        game.clearingTimer = 0;
        game.cascadeFalling = false;
        this.resetPerPieceState();

        game.engine.spawn();
        game.current = game.engine.state.current;
        if (game.current) game.scoringService.registerPieceSpawn(game.current.type);
        const nextQueueSize = game.modeController?.def?.hardcoreMask ? 1 : NEXT_PREVIEW_QUEUE_SIZE;
        game.nextQueue = game.bag.peek(nextQueueSize);
        game.renderer.drawNext(game.nextQueue);
        this.snapToPointer();
    }

    spawnNext() {
        const game = this.game;
        game.modeController.maybeApplyZenOverflow();
        game.engine.spawn();
        game.current = game.engine.state.current;
        if (game.current) game.scoringService.registerPieceSpawn(game.current.type);
        const nextQueueSize = game.modeController?.def?.hardcoreMask ? 1 : NEXT_PREVIEW_QUEUE_SIZE;
        game.nextQueue = game.bag.peek(nextQueueSize);
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
            if (!game.engine.move(dir)) return;
            game.current = game.engine.state.current;
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
        const fromX = game.getShiftDisplayX();
        const result = game.engine.moveToColumn(targetColumn);
        if (!result.moved) return;
        game.current = game.engine.state.current;
        const targetX = result.x;
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
        if (!game.engine.softDrop()) return;
        game.current = game.engine.state.current;
        game.lastAction = "move";
        game.scoringService.registerSoftDrop();
        game.dropCounter = 0;
        game.noteRowStep();
        game.shiftAnim = null;
    }

    hardDrop() {
        const game = this.game;
        if (!this.canControlPiece()) return;
        if (game.hardDropUsed) return;

        game.hardDropUsed = true;

        const cellsDropped = game.engine.hardDrop();
        game.current = game.engine.state.current;

        game.scoringService.registerHardDrop(cellsDropped);
        game.renderer.shakeHardDrop();
        game.beginHardDropTrail(game.current, cellsDropped);
        game.beginHardDropImpactFlash(game.current);
        game.multiplayerController?.notifyHardDropTrail();
        this.lockCurrentPiece();
        game.dropCounter = 0;
    }

    rotate(dir = 1) {
        const game = this.game;
        if (!this.canControlPiece()) return;
        if (game.rotationAnim) return;

        const piece = game.current;
        const fromX = piece.x;
        const fromY = piece.y;
        const normalizedDir = dir === 2 ? 2 : (dir < 0 ? -1 : 1);

        if (!game.engine.rotate(normalizedDir)) return;
        game.current = game.engine.state.current;
        if (!game.current) return;

        game.lastAction = "rotate";
        game.soundManager.play("rotate");
        if (game.board.collides(game.current, 0, 1)) this.resetLockDelay();

        const is180 = Math.abs(normalizedDir) === 2;
        const isSquare = game.current.type === "O";
        game.rotationAnim = {
            fromX,
            fromY,
            toX: game.current.x,
            toY: game.current.y,
            fromAngle: is180 ? 180 : -normalizedDir * 90,
            squareSpin: isSquare,
            spinAngle: is180 ? 180 : normalizedDir * 90,
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
        const lockedPiece = game.current;
        game.engine.lock({clearLines: false});
        game.current = game.engine.state.current;
        game.renderer.notifyPieceLocked(lockedPiece, game.board);

        const fullRows = game.board.getFullLineIndices();

        if (fullRows.length === 0) {
            if (spin) game.scoringService.registerSpin(spin, 0);
            game.currentCombo = 0;
            game.cascadeChain = 0;
            this.spawnNext();
            return;
        }

        game.pendingSpin = spin;
        game.cascadeChain = 0;
        const clearedCount = Math.min(fullRows.length, 4);
        game.soundManager.play(`lineClear${clearedCount}`, {playbackRate: LINE_CLEAR_SOUND_PLAYBACK_RATE});
        game.state = "clearing";
        game.clearingLines = fullRows;
        game.clearingFragments = this.buildClearFragments(fullRows);
        game.clearingDropRows = game.gameModes[game.mode]?.cascadeGravity
            ? new Uint8Array(game.board.rows)
            : this.buildDropRows(fullRows, game.board.rows);
        game.clearingDropGrid = null;
        game.cascadeFalling = false;
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

        if (game.gameModes[game.mode]?.cascadeGravity) {
            this.finishCascadeStep();
            return;
        }

        const clearedRowIndices = game.clearingLines;
        const cleared = game.board.clearFullLines();
        game.renderer.notifyLinesCleared(game.board, clearedRowIndices);
        if (game.pendingSpin) game.scoringService.registerSpin(game.pendingSpin, cleared);
        game.scoringService.registerLineClears(cleared, false);

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

    finishCascadeStep() {
        const game = this.game;
        const clearedRowIndices = game.clearingLines;
        const {cleared, dropGrid} = game.board.collapseFullLines(
            Boolean(game.gameModes[game.mode]?.cascadeHardcore)
        );
        game.renderer.notifyLinesCleared(game.board, clearedRowIndices);

        if (game.pendingSpin) {
            game.scoringService.registerSpin(game.pendingSpin, cleared);
            game.pendingSpin = null;
        }

        const isFirstCascadeStep = game.cascadeChain === 0;
        ++game.cascadeChain;
        game.statsTracker.registerLineClears(cleared, game.cascadeChain > 1);
        if (game.cascadeChain > 1) {
            game.scoringService.addScore(pointsForCascadeChain(game.cascadeChain, game.level, game.scoring));
        }

        if (isFirstCascadeStep) {
            ++game.currentCombo;
            game.maxCombo = Math.max(game.maxCombo, game.currentCombo);
            if (game.currentCombo >= 2) {
                game.comboBannerCombo = game.currentCombo;
                game.comboBannerTimer = game.comboBannerDuration;
            }
        }

        game.clearingLines = [];
        game.clearingFragments = [];
        game.clearingDropRows = [];
        game.dropCounter = 0;
        game.cascadeStepCleared = cleared;

        const hasFall = dropGrid && dropGrid.some((amount) => amount !== 0);
        if (hasFall) {
            game.state = "clearing";
            game.clearingDropGrid = dropGrid;
            game.cascadeFalling = true;
            game.clearingTimer = 0;
            return;
        }

        game.clearingDropGrid = null;
        this.continueCascadeChain(cleared);
    }

    finishCascadeFall() {
        const game = this.game;
        game.cascadeFalling = false;
        game.clearingDropGrid = null;
        this.continueCascadeChain(game.cascadeStepCleared);
    }

    continueCascadeChain(cleared) {
        const game = this.game;

        const chainedRows = game.board.getFullLineIndices();
        if (chainedRows.length > 0) {
            const clearedCount = Math.min(chainedRows.length, 4);
            game.soundManager.play(`lineClear${clearedCount}`, {playbackRate: LINE_CLEAR_SOUND_PLAYBACK_RATE});
            game.state = "clearing";
            game.clearingLines = chainedRows;
            game.clearingFragments = this.buildClearFragments(chainedRows);

            game.clearingDropRows = new Uint8Array(game.board.rows);
            game.clearingTimer = 0;
            return;
        }

        game.cascadeChain = 0;

        const toppedOutFromResupply = game.modeController.onLinesCleared(cleared);
        if (toppedOutFromResupply) return;
        if (game.modeController.checkObjectiveComplete()) return;

        game.state = "running";
        this.spawnNext();
    }
}
