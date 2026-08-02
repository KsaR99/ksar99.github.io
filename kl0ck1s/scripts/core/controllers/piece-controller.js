"use strict";

import {Piece} from "../game/piece.js";
import {pointsForHardDrop, pointsForSoftDrop} from "../game/scoring.js";
import {getKickTable, T_FRONT_CORNERS} from "../game/game-constants.js";
import {getTightBounds} from "../shared/utils.js";
import {LINE_CLEAR_SOUND_PLAYBACK_RATE} from "../shared/config.js";

/** Grace window (ms) absorbing single-frame grounded/airborne flicker from in-place rotation before the "grounded" cue actually stops. */
const GROUNDED_GRACE_MS = 100;

/** Fallback duration (ms) for groundedSoundPlaybackRate() before the "grounded" clip has finished decoding - see SoundManager.getDuration(). */
const GROUNDED_SOUND_REFERENCE_DURATION_MS = 1500;

/**
 * The "falling" cue's playback rate is a flat per-difficulty-tier value (see
 * DIFFICULTIES.*.fallingSoundRate in config.js and Game.getFallingSoundRate())
 * rather than anything derived from the piece's instantaneous fall speed -
 * see fallingSoundPlaybackRate() below.
 */

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
        game.pendingSpin = null;
        game.clearingLines = [];
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

    /** Clears lock-delay/grounded-cue/fall-trail state for the piece about to spawn - shared by reset() and spawnNext(). */
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

    /**
     * Detects the exact moment the falling piece first touches down (goes
     * from airborne to resting against the stack/floor) and plays a cue for
     * it - that's the moment lock delay starts counting down, i.e. the
     * player's last window to slide/rotate the piece before it locks.
     *
     * Called from Game.update() with the "resting" collision check it
     * already computes each tick (see game.js), so this doesn't redo that
     * check - it only compares against game.isGrounded to catch the
     * false -> true / true -> false transitions.
     *
     * The "grounded" sound is stopped again once the piece has been out of
     * contact for more than GROUNDED_GRACE_MS - either because it locked in
     * place (see stopGroundedSound(), called from lockCurrentPiece()) or
     * because the player slid/spun it back off whatever ledge it was resting
     * on. A loss of contact shorter than that grace window (e.g. a single
     * frame where a rotation's new footprint/kick briefly isn't flush with
     * the surface) is treated as still grounded, so rotating in place never
     * stops-and-immediately-restarts the cue.
     *
     * Once started/resumed here, the cue is never touched again by a move,
     * rotation, or lock-delay reset - see groundedSoundPlaybackRate() for
     * why that's correct rather than an oversight: it plays at a fixed rate
     * tied to `groundedTime`, which already advances in perfect lockstep
     * with real elapsed grounded time on its own.
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

    /**
     * The fixed rate the "grounded" cue plays at for the whole episode: the
     * one rate at which playing the clip's actual decoded duration (see
     * SoundManager.getDuration()) start-to-finish, uninterrupted, takes
     * exactly the current tier's `maxGroundedTime` of real wall-clock time.
     * Falls back to GROUNDED_SOUND_REFERENCE_DURATION_MS only if the buffer
     * hasn't finished decoding yet (getDuration() returns null) - play()
     * itself no-ops until it has, so this only affects the rate stashed for
     * a resume() that ends up happening before decoding completes.
     * E.g. Easy's 3000ms window
     * plays the cue at 0.5x (stretched to 3s); Pro's 1000ms window plays it
     * at 1.5x (compressed to 1s); Expert's 1500ms window plays it at 1x,
     * matching how the clip was authored.
     *
     * This is the *only* place the cue's speed is decided, and it's set once
     * per episode (touchdown/resume in updateGrounded()) and never adjusted
     * afterwards - no resyncing on a move, rotation, or lock-delay reset is
     * needed, because the cue's position is deliberately tied to
     * `groundedTime`, not to the short, resettable LOCK_DELAY window (see
     * the comment on GROUNDED_SOUND_REFERENCE_DURATION_MS above).
     * `groundedTime` only ever counts forward in real time while the piece
     * is grounded (Game.update()) and is never reset by input, so at this
     * fixed rate the cue's own playback position - driven purely by the
     * audio hardware clock, not by any per-frame recomputation - stays
     * exactly in step with `groundedTime / maxGroundedTime` on its own.
     * Whatever fraction of the clip has played when the piece actually
     * locks (whether from a quiet LOCK_DELAY timeout or hitting the
     * maxGroundedTime cap) is simply however far real time carried it -
     * stopGroundedSound() then cuts it off there, same as before.
     *
     * An earlier version tried to actively realign the cue's *remaining*
     * playback to `LOCK_DELAY - lockDelayTimer` every time a move/rotation
     * reset that timer - but that timer jumps back up on every successful
     * reset, so under repeated input (e.g. DAS-held movement, firing every
     * ~16ms) it recomputed a new target rate faster than the previous
     * ramp/reseek had settled, compounding into audibly wrong pitch/timing.
     * Tying the cue to groundedTime instead removes the need for any of
     * that: nothing about a move/rotation/reset changes groundedTime's pace,
     * so there is nothing to resync.
     */
    groundedSoundPlaybackRate() {
        const durationSeconds = this.game.soundManager.getDuration("grounded");
        const durationMs = durationSeconds != null
            ? durationSeconds * 1000
            : GROUNDED_SOUND_REFERENCE_DURATION_MS;
        return durationMs / this.game.getMaxGroundedTime();
    }

    /**
     * Pauses the currently playing "grounded" cue without discarding it - see
     * updateGrounded(). Used for a contact loss that outlasts the grace
     * window but the piece is still in play (e.g. sliding over a gap); the
     * instance is kept around (groundedSoundId stays set) so a later
     * touchdown resumes from the same offset instead of restarting at 0%.
     * Contrast with stopGroundedSound(), which discards the instance for
     * good - used when the piece actually locks or a new one spawns.
     */
    pauseGroundedSound() {
        const game = this.game;
        if (game.groundedSoundId == null) return;
        game.soundManager.pause(game.groundedSoundId);
    }

    /** Stops the currently playing "grounded" cue for good, if any - see updateGrounded(). */
    stopGroundedSound() {
        const game = this.game;
        if (game.groundedSoundId == null) return;
        game.soundManager.stop(game.groundedSoundId);
        game.groundedSoundId = null;
    }

    /**
     * The "falling" cue's playback rate: a flat value for the current
     * difficulty tier (see DIFFICULTIES.*.fallingSoundRate in config.js) -
     * Easy plays it low and slow (10%), Pro plays it at half speed (50%),
     * with the tiers in between climbing evenly. Read live off the current
     * tier via Game.getFallingSoundRate(), so - same as the "grounded" cue's
     * window - it keeps climbing if the player's level pushes into a faster
     * tier mid-round, even if they started on a slower difficulty.
     */
    fallingSoundPlaybackRate() {
        return this.game.getFallingSoundRate();
    }

    /**
     * Starts/keeps/stops the "falling" cue in lockstep with `game.isGrounded`
     * (already debounced by updateGrounded() above, so this never fights it
     * over the same single-frame flicker). Deliberately simpler than the
     * "grounded" cue's pause/resume dance: falling never seeks back into a
     * previous instance - every fresh falling episode (spawn, or coming back
     * off a ledge after having been grounded) starts a brand new looping
     * instance from position 0 via play(), and stopFallingSound() always
     * discards it outright rather than pausing it. While an instance is
     * already playing, only its rate is touched (a live AudioParam - see
     * SoundManager.setPlaybackRate()), so the pitch can keep tracking speed
     * for as long as the piece keeps falling without ever restarting the
     * clip mid-fall.
     */
    updateFalling() {
        const game = this.game;

        if (game.isGrounded) {
            this.stopFallingSound();
            return;
        }

        const rate = this.fallingSoundPlaybackRate();

        if (game.fallingSoundId == null) {
            // Retries every frame until this succeeds - harmless no-op if
            // the buffer hasn't finished decoding yet (play() just returns
            // null, see SoundManager.play()).
            game.fallingSoundId = game.soundManager.play("falling", {loop: true, playbackRate: rate});
            return;
        }

        game.soundManager.setPlaybackRate(game.fallingSoundId, rate);
    }

    /** Stops the currently playing "falling" cue for good, if any - see updateFalling(). */
    stopFallingSound() {
        const game = this.game;
        if (game.fallingSoundId == null) return;
        game.soundManager.stop(game.fallingSoundId);
        game.fallingSoundId = null;
    }

    /**
     * Stops both the "grounded" and "falling" cues outright. Used whenever
     * gameplay is interrupted from the outside - pausing, opening options,
     * or exiting to the menu - rather than through the piece's own
     * grounded/falling state machine, so neither cue is left playing behind
     * a non-gameplay screen. Piece-lifecycle stops (spawn, lock) already go
     * through resetPerPieceState()/lockCurrentPiece() instead, which call
     * this too - see there.
     */
    stopGameplaySounds() {
        this.stopGroundedSound();
        this.stopFallingSound();
    }

    moveHorizontal(dir) {
        const game = this.game;
        if (game.state !== "running") return;
        if (!game.board.collides(game.current, dir, 0)) {
            const fromX = game.getShiftDisplayX();
            game.current.x += dir;
            game.lastAction = "move";
            game.noteColStep();
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
            if (game.menuSelector === "mode") {
                game.modeController.changeMode(dir);
            } else {
                game.difficultyController.changeDifficulty(dir);
            }
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
        const offsetX = bounds.minX || 0;
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
                game.current.mask = rotatedMask;
                game.current.x += dx;
                game.current.y += dy;
                game.current.rotationState = toState;
                game.lastAction = "rotate";
                game.soundManager.play("rotate");
                if (game.board.collides(game.current, 0, 1)) this.resetLockDelay();

                // Wall-kicked rotations used to tween from (fromX, fromY) to
                // the kicked position, but that starting point is exactly
                // where collides() just rejected the new shape - the whole
                // reason a kick was needed - so the tween's early frames
                // rendered the piece overlapping whatever it got kicked away
                // from (e.g. a piece rotated to point left, kicked off a
                // neighboring stack, briefly looked like it "sank into" that
                // stack). Every rotation - kicked or not, any piece, 90° or
                // 180° - now snaps to its new position instantly instead.
                game.rotationAnim = null;
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

    /**
     * Locks the current piece, called either from a natural lock (the
     * "grounded"/lock-delay window running out in Game.update()) or from
     * hardDrop() (which sets `hardDropUsed` right before calling this - see
     * there). The two get different lock cues so they stay recognizably
     * different at the table: hardDrop() already has its own instant "drop"
     * slam, so a natural lock plays "pieceLock" instead - never both, and
     * never "drop" for a piece that was just sitting on the "grounded" cue.
     */
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

        if (game.modeController.checkSprintComplete()) return;

        game.state = "running";
        this.spawnNext();
    }
}
