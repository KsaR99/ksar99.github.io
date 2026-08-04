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
        this.tierInstances = new Map();

        this._pitchLastTension = null;
        this._pitchAccumMs = 0;
        this._pitchSemitones = 0;
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

    _applyPitch() {
        if (this.currentInstanceId === null) return;
        this.soundManager.rampInstanceDetune(this.currentInstanceId, this._pitchSemitones * 100, this.pitchStepIntervalMs);
    }

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
        this.soundManager.setDetune(id, this._pitchSemitones * 100);
    }

    _crossfadeTo(outgoingTier, tier) {
        const outgoingId = this.currentInstanceId;
        this.currentInstanceId = null;
        if (outgoingId !== null) this._fadeOutAndPause(outgoingId, outgoingTier, this.fadeDurationMs);
        this._fadeIn(tier);
    }

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
