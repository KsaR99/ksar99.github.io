"use strict";

import {MUSIC_TENSION} from "../shared/config.js";

export class MusicDirector {
    constructor(soundManager, {
        trackKeys = MUSIC_TENSION.TRACK_KEYS,
        thresholds = MUSIC_TENSION.THRESHOLDS,
        hysteresis = MUSIC_TENSION.HYSTERESIS,
        fadeDurationMs = MUSIC_TENSION.FADE_DURATION_MS,
        stopFadeDurationMs = MUSIC_TENSION.STOP_FADE_DURATION_MS,
    } = {}) {
        this.soundManager = soundManager;
        this.trackKeys = trackKeys;
        this.thresholds = thresholds;
        this.hysteresis = hysteresis;
        this.fadeDurationMs = fadeDurationMs;
        this.stopFadeDurationMs = stopFadeDurationMs;

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
        this.currentTier = this._tierForTension(MusicDirector.tensionFor(board));
        this._fadeIn(this.currentTier);
    }

    update(board) {
        if (!this.enabled) return;
        const tier = this._tierForTension(MusicDirector.tensionFor(board));
        if (tier === this.currentTier) return;
        const outgoingTier = this.currentTier;
        this.currentTier = tier;
        this._crossfadeTo(outgoingTier, tier);
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
                return;
            }
        }

        const id = this.soundManager.play(key, {loop: true, volume: 0});
        if (id === null) return;
        this.currentInstanceId = id;
        this.tierInstances.set(tier, id);
        this.soundManager.fadeInstanceVolume(id, 1, this.fadeDurationMs);
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
