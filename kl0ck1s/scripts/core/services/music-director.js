"use strict";

import {MUSIC_TENSION} from "../shared/config.js";

export class MusicDirector {
    constructor(soundManager, {
        trackKeys = MUSIC_TENSION.TRACK_KEYS,
        thresholds = MUSIC_TENSION.THRESHOLDS,
        hysteresis = MUSIC_TENSION.HYSTERESIS,
        fadeDurationMs = MUSIC_TENSION.FADE_DURATION_MS,
        stopFadeDurationMs = MUSIC_TENSION.STOP_FADE_DURATION_MS,
        pitchStepSemitones = MUSIC_TENSION.PITCH_STEP_SEMITONES,
        pitchMaxSemitones = MUSIC_TENSION.PITCH_MAX_SEMITONES,
        pitchStepIntervalMs = MUSIC_TENSION.PITCH_STEP_INTERVAL_MS,
        pitchReturnMs = MUSIC_TENSION.PITCH_RETURN_MS,
    } = {}) {
        this.soundManager = soundManager;
        this.trackKeys = trackKeys;
        this.thresholds = thresholds;
        this.hysteresis = hysteresis;
        this.fadeDurationMs = fadeDurationMs;
        this.stopFadeDurationMs = stopFadeDurationMs;
        this.pitchStepSemitones = pitchStepSemitones;
        this.pitchMaxSemitones = pitchMaxSemitones;
        this.pitchStepIntervalMs = pitchStepIntervalMs;
        this.pitchReturnMs = pitchReturnMs;

        this.enabled = false;
        this.currentTier = null;
        this.currentInstanceId = null;
        this.fadingOutIds = new Set();
        this._fadeTimeouts = new Map();
        /**
         * tier -> instance id of that tier's track. An instance stays in
         * here (paused, not stopped) after its tier is faded out, so coming
         * back to the same tier later resumes it from the offset it left
         * off at instead of restarting the track from 0 - see _fadeIn()/
         * _fadeOutAndPause() below.
         */
        this.tierInstances = new Map();

        // --- Tension-trend pitch modulation state - see _updatePitch(). ---
        /** Last tension value sampled at a pitch-step boundary; null until the first sample after start(). */
        this._pitchLastTension = null;
        /** Accumulates update()'s delta between pitch-step checks. */
        this._pitchAccumMs = 0;
        /** Current pitch offset in semitones, -pitchMaxSemitones..+pitchMaxSemitones. */
        this._pitchSemitones = 0;
        /** Set the instant tension stops trending, so the steady-glide-to-0 below always covers the same pitchReturnMs span regardless of where it started from. */
        this._pitchDecayFrom = 0;
        this._pitchDecayElapsedMs = 0;
        this._pitchSteady = true;
    }

    static tensionFor(board) {
        if (!board || !board.rows) return 0;

        let highestFilledRow = board.rows;
        for (let y = 0; y < board.rows; y++) {
            if (board.occupancy[y] !== 0) {
                highestFilledRow = y;
                break;
            }
        }

        return Math.min(1, (board.rows - highestFilledRow) / board.rows);
    }

    _tierForTension(tension) {
        let tier = this.currentTier ?? 0;

        while (tier < this.thresholds.length - 1 && tension >= this.thresholds[tier + 1]) {
            tier++;
        }
        while (tier > 0 && tension < this.thresholds[tier] - this.hysteresis) {
            tier--;
        }
        return tier;
    }

    start(board) {
        this.stop(0);
        this.enabled = true;
        this._pitchLastTension = MusicDirector.tensionFor(board);
        this._pitchAccumMs = 0;
        this._pitchSemitones = 0;
        this._pitchDecayFrom = 0;
        this._pitchDecayElapsedMs = 0;
        this._pitchSteady = true;
        this.currentTier = this._tierForTension(this._pitchLastTension);
        this._fadeIn(this.currentTier);
    }

    /** @param {number} [delta] ms since the last update() call - drives the pitch-trend stepping in _updatePitch(); tier switching itself is not time-based. */
    update(board, delta = 0) {
        if (!this.enabled) return;
        const tension = MusicDirector.tensionFor(board);

        const tier = this._tierForTension(tension);
        if (tier !== this.currentTier) {
            const outgoingTier = this.currentTier;
            this.currentTier = tier;
            this._crossfadeTo(outgoingTier, tier);
        }

        this._updatePitch(tension, delta);
    }

    /**
     * Nudges the currently playing track's pitch based on which way tension
     * (board.rows, i.e. stack height) is trending - independent of the
     * tier/track it's on. Every pitchStepIntervalMs: tension higher than last
     * sample steps pitch up by pitchStepSemitones (capped at
     * +pitchMaxSemitones), tension lower steps it down (capped at
     * -pitchMaxSemitones). Tension holding steady instead glides pitch back
     * to 0 linearly over pitchReturnMs, starting fresh from wherever pitch
     * was the moment it stopped trending - so a later resumed trend and a
     * later steady stretch both restart from the actual current value
     * rather than assuming it was at the max.
     */
    _updatePitch(tension, delta) {
        if (this._pitchLastTension === null) {
            this._pitchLastTension = tension;
            return;
        }

        this._pitchAccumMs += delta;
        let changed = false;

        while (this._pitchAccumMs >= this.pitchStepIntervalMs) {
            this._pitchAccumMs -= this.pitchStepIntervalMs;

            if (tension > this._pitchLastTension) {
                this._pitchSemitones = Math.min(this.pitchMaxSemitones, this._pitchSemitones + this.pitchStepSemitones);
                this._pitchSteady = false;
                changed = true;
            } else if (tension < this._pitchLastTension) {
                this._pitchSemitones = Math.max(-this.pitchMaxSemitones, this._pitchSemitones - this.pitchStepSemitones);
                this._pitchSteady = false;
                changed = true;
            } else {
                if (!this._pitchSteady) {
                    // Tension just stopped trending - start the glide back
                    // to 0 fresh from whatever pitch actually is right now.
                    this._pitchSteady = true;
                    this._pitchDecayFrom = this._pitchSemitones;
                    this._pitchDecayElapsedMs = 0;
                }
                if (this._pitchSemitones !== 0) {
                    this._pitchDecayElapsedMs += this.pitchStepIntervalMs;
                    const t = Math.min(1, this._pitchDecayElapsedMs / this.pitchReturnMs);
                    this._pitchSemitones = this._pitchDecayFrom * (1 - t);
                    changed = true;
                }
            }

            this._pitchLastTension = tension;
        }

        if (changed) this._applyPitch();
    }

    /** Ramps the currently playing instance's detune to match _pitchSemitones, over one pitch-step interval so it glides rather than snapping on every step. */
    _applyPitch() {
        if (this.currentInstanceId === null) return;
        this.soundManager.rampInstanceDetune(this.currentInstanceId, this._pitchSemitones * 100, this.pitchStepIntervalMs);
    }

    /**
     * Starts (or resumes) `tier`'s track, faded in from silence. If that
     * tier still has a paused instance waiting in the background (from an
     * earlier fade-out - see _fadeOutAndPause()), picks up from there
     * instead of starting over; falls back to a fresh play() if there's
     * nothing to resume (first time this tier is reached, or its instance
     * already ran past its own end - resume() itself guards against that).
     */
    _fadeIn(tier) {
        const key = this.trackKeys[tier];
        if (!key) return;

        const pendingId = this.tierInstances.get(tier);
        if (pendingId != null) {
            const pendingTimeout = this._fadeTimeouts.get(pendingId);
            if (pendingTimeout) {
                clearTimeout(pendingTimeout);
                this._fadeTimeouts.delete(pendingId);
            }
            this.fadingOutIds.delete(pendingId);

            if (this.soundManager.resume(pendingId)) {
                this.soundManager.setInstanceVolume(pendingId, 0);
                this.soundManager.fadeInstanceVolume(pendingId, 1, this.fadeDurationMs);
                this.currentInstanceId = pendingId;
                this.soundManager.setDetune(pendingId, this._pitchSemitones * 100);
                return;
            }
        }

        const id = this.soundManager.play(key, {loop: true, volume: 0});
        if (id === null) return;
        this.currentInstanceId = id;
        this.tierInstances.set(tier, id);
        this.soundManager.fadeInstanceVolume(id, 1, this.fadeDurationMs);
        // Carry the current tension-trend pitch offset over to the new
        // instance too, so switching tiers doesn't reset pitch to 0 - see
        // _updatePitch()/_applyPitch() above.
        this.soundManager.setDetune(id, this._pitchSemitones * 100);
    }

    _crossfadeTo(outgoingTier, tier) {
        const outgoingId = this.currentInstanceId;
        this.currentInstanceId = null;
        if (outgoingId !== null) this._fadeOutAndPause(outgoingId, outgoingTier, this.fadeDurationMs);
        this._fadeIn(tier);
    }

    /**
     * Fades `id` (the track belonging to `tier`) out, then pauses it rather
     * than stopping it for good, so _fadeIn() can resume it later if tension
     * comes back to `tier`. If `tier` was re-entered with a *different*
     * fresh instance before this fade-out finished (tension bounced back
     * and forth faster than fadeDurationMs), this instance is not the one
     * left in tierInstances anymore - stop it outright instead of pausing
     * it, so it doesn't linger silently forever.
     */
    _fadeOutAndPause(id, tier, durationMs) {
        this.soundManager.fadeInstanceVolume(id, 0, durationMs);
        this.fadingOutIds.add(id);
        const timeoutId = setTimeout(() => {
            this.fadingOutIds.delete(id);
            this._fadeTimeouts.delete(id);
            if (this.tierInstances.get(tier) === id) {
                this.soundManager.pause(id);
            } else {
                this.soundManager.stop(id);
            }
        }, durationMs + 50);
        this._fadeTimeouts.set(id, timeoutId);
    }

    /** Fades `id` out and discards it for good - used by stop() below, never for a tier crossfade (see _fadeOutAndPause()). */
    _fadeOutAndStop(id, durationMs) {
        this.soundManager.fadeInstanceVolume(id, 0, durationMs);
        this.fadingOutIds.add(id);
        const timeoutId = setTimeout(() => {
            this.soundManager.stop(id);
            this.fadingOutIds.delete(id);
            this._fadeTimeouts.delete(id);
        }, durationMs + 50);
        this._fadeTimeouts.set(id, timeoutId);
    }

    stop(durationMs = this.stopFadeDurationMs) {
        this.enabled = false;
        this.currentTier = null;
        this._pitchLastTension = null;
        this._pitchAccumMs = 0;
        this._pitchSemitones = 0;
        this._pitchDecayFrom = 0;
        this._pitchDecayElapsedMs = 0;
        this._pitchSteady = true;

        const currentId = this.currentInstanceId;
        this.currentInstanceId = null;
        if (currentId !== null) this._fadeOutAndStop(currentId, durationMs);

        // Discard every other tier's background-paused instance too - a new
        // round starts fresh, nothing should resume mid-track from a
        // previous one.
        this.tierInstances.forEach((id) => {
            if (id !== currentId) this.soundManager.stop(id);
        });
        this.tierInstances.clear();
    }

    pause() {
        if (this.currentInstanceId !== null) this.soundManager.pause(this.currentInstanceId);
        this.fadingOutIds.forEach((id) => this.soundManager.pause(id));
    }

    resume() {
        if (this.currentInstanceId !== null) this.soundManager.resume(this.currentInstanceId);
        this.fadingOutIds.forEach((id) => this.soundManager.resume(id));
    }
}
