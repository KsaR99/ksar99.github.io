// @ts-nocheck
import type {SoundManager} from "./sound-manager.js";
import {MUSIC_TENSION} from "../shared/config.js";

export class MusicDirector {
    soundManager: SoundManager;
    trackKeys: string[];
    thresholds: number[];
    hysteresis: number;
    fadeDurationMs: number;
    stopFadeDurationMs: number;
    tensionChangeFadeInMs: number;
    sameTrackResumeDelayMs: number;
    sameTrackMinPlayMs: number;
    pitchStepSemitones: number;
    pitchMaxSemitones: number;
    pitchStepIntervalMs: number;
    pitchReturnMs: number;
    enabled: boolean;
    currentTier: number | null;
    currentInstanceId: number | null;
    _pitchLastTension: number | null;
    _pitchAccumMs: number;
    _pitchSemitones: number;
    _pitchDecayFrom: number;
    _pitchDecayElapsedMs: number;
    _pitchSteady: boolean;
    _resumeTimeout: ReturnType<typeof setTimeout> | null;
    _resumeInstanceId: number | null;
    _resumeTier: number | null;
    lowerTensionCheckIntervalMs: number;
    lowerTensionMaxWaits: number;
    lowerTensionVolumeFactor: number;
    _pendingLowerTier: number | null;
    _pendingLowerWaits: number;
    _lowerCheckTimeout: ReturnType<typeof setTimeout> | null;
    _lowerVolumeFactor: number;
    tensionSwitchCount: number;

    constructor(soundManager: SoundManager, {
        trackKeys = MUSIC_TENSION.TRACK_KEYS,
        thresholds = MUSIC_TENSION.THRESHOLDS,
        hysteresis = MUSIC_TENSION.HYSTERESIS,
        fadeDurationMs = MUSIC_TENSION.FADE_DURATION_MS,
        stopFadeDurationMs = MUSIC_TENSION.STOP_FADE_DURATION_MS,
        tensionChangeFadeInMs = MUSIC_TENSION.TENSION_CHANGE_FADE_IN_MS,
        sameTrackResumeDelayMs = MUSIC_TENSION.SAME_TRACK_RESUME_DELAY_MS,
        sameTrackMinPlayMs = MUSIC_TENSION.SAME_TRACK_MIN_PLAY_MS,
        lowerTensionCheckIntervalMs = MUSIC_TENSION.LOWER_TENSION_CHECK_INTERVAL_MS,
        lowerTensionMaxWaits = MUSIC_TENSION.LOWER_TENSION_MAX_WAITS,
        lowerTensionVolumeFactor = MUSIC_TENSION.LOWER_TENSION_VOLUME_FACTOR,
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
        this.tensionChangeFadeInMs = tensionChangeFadeInMs;
        this.sameTrackResumeDelayMs = sameTrackResumeDelayMs;
        this.sameTrackMinPlayMs = sameTrackMinPlayMs;
        this.lowerTensionCheckIntervalMs = lowerTensionCheckIntervalMs;
        this.lowerTensionMaxWaits = lowerTensionMaxWaits;
        this.lowerTensionVolumeFactor = lowerTensionVolumeFactor;
        this.pitchStepSemitones = pitchStepSemitones;
        this.pitchMaxSemitones = pitchMaxSemitones;
        this.pitchStepIntervalMs = pitchStepIntervalMs;
        this.pitchReturnMs = pitchReturnMs;
        this.enabled = false;
        this.currentTier = null;
        this.currentInstanceId = null;
        this._pitchLastTension = null;
        this._pitchAccumMs = 0;
        this._pitchSemitones = 0;
        this._pitchDecayFrom = 0;
        this._pitchDecayElapsedMs = 0;
        this._pitchSteady = true;
        this._resumeTimeout = null;
        this._resumeInstanceId = null;
        this._resumeTier = null;
        this._pendingLowerTier = null;
        this._pendingLowerWaits = 0;
        this._lowerCheckTimeout = null;
        this._lowerVolumeFactor = 1;
        this.tensionSwitchCount = 0;
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
        while (tier < this.thresholds.length - 1 && tension >= this.thresholds[tier + 1]) tier++;
        while (tier > 0 && tension < this.thresholds[tier] - this.hysteresis) tier--;
        return tier;
    }

    _clearPendingResume(stopInstance = true) {
        if (this._resumeTimeout !== null) clearTimeout(this._resumeTimeout);
        if (stopInstance && this._resumeInstanceId !== null) this.soundManager.stop(this._resumeInstanceId);
        this._resumeTimeout = null;
        this._resumeInstanceId = null;
        this._resumeTier = null;
    }

    _clearPendingLowerTension() {
        if (this._lowerCheckTimeout !== null) clearTimeout(this._lowerCheckTimeout);
        this._lowerCheckTimeout = null;
        this._pendingLowerTier = null;
        this._pendingLowerWaits = 0;
        this._lowerVolumeFactor = 1;
    }

    _restoreCurrentVolume() {
        if (this.currentInstanceId === null) return;
        this.soundManager.fadeInstanceVolume(this.currentInstanceId, 1, this.tensionChangeFadeInMs);
        this._lowerVolumeFactor = 1;
    }

    _scheduleLowerTensionCheck() {
        if (this._lowerCheckTimeout !== null) clearTimeout(this._lowerCheckTimeout);
        this._lowerCheckTimeout = setTimeout(() => {
            this._lowerCheckTimeout = null;
            if (!this.enabled || this._pendingLowerTier === null) return;
            const targetTier = this._pendingLowerTier;
            const currentTier = this.currentTier;
            if (currentTier === null || targetTier === null || targetTier >= currentTier) {
                this._clearPendingLowerTension();
                return;
            }
            this._pendingLowerWaits += 1;
            if (this._pendingLowerWaits >= this.lowerTensionMaxWaits) {
                const tier = this._pendingLowerTier;
                this._clearPendingLowerTension();
                this.currentTier = tier;
                this._changeTension(currentTier, tier, true);
                return;
            }
            this._lowerVolumeFactor *= this.lowerTensionVolumeFactor;
            if (this.currentInstanceId !== null) {
                this.soundManager.fadeInstanceVolume(this.currentInstanceId, this._lowerVolumeFactor, this.lowerTensionCheckIntervalMs);
            }
            this._scheduleLowerTensionCheck();
        }, this.lowerTensionCheckIntervalMs);
    }

    start(board) {
        this.stop(0);
        this._clearPendingLowerTension();
        this.tensionSwitchCount = 0;
        this.enabled = true;
        this._pitchLastTension = MusicDirector.tensionFor(board);
        this._pitchAccumMs = 0;
        this._pitchSemitones = 0;
        this._pitchDecayFrom = 0;
        this._pitchDecayElapsedMs = 0;
        this._pitchSteady = true;
        this.currentTier = this._tierForTension(this._pitchLastTension);
        this._fadeIn(this.currentTier, this.fadeDurationMs);
    }

    update(board, delta = 0) {
        if (!this.enabled) return;
        const tension = MusicDirector.tensionFor(board);
        const tier = this._tierForTension(tension);
        if (this.currentTier !== null) {
            const activeTier = this.currentTier;

            if (tier > activeTier) {
                this._clearPendingLowerTension();
                this.currentTier = tier;
                this._changeTension(activeTier, tier, true);
            } else if (tier < activeTier) {
                const shouldStartWaiting = this._pendingLowerTier === null;
                if (this._pendingLowerTier === null || tier < this._pendingLowerTier) {
                    this._pendingLowerTier = tier;
                }
                if (shouldStartWaiting) {
                    this._pendingLowerWaits = 0;
                    this._scheduleLowerTensionCheck();
                }
            } else if (this._pendingLowerTier !== null) {
                this._clearPendingLowerTension();
                this._restoreCurrentVolume();
            }
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

    _fadeIn(tier, durationMs = this.tensionChangeFadeInMs) {
        const key = this.trackKeys[tier];
        if (!key) return;
        const id = this.soundManager.play(key, {loop: true, volume: 0});
        if (id === null) {
            void this.soundManager.loadCategory("music").then(() => {
                if (this.enabled && this.currentTier === tier && this.currentInstanceId === null) this._fadeIn(tier, durationMs);
            });
            return;
        }
        this.currentInstanceId = id;
        this.soundManager.setDetune(id, this._pitchSemitones * 100);
        this.soundManager.fadeInstanceVolume(id, 1, durationMs);
    }

    _changeTension(outgoingTier, tier, force = false) {
        this._clearPendingResume();
        if (!force && outgoingTier === tier) return;
        this.tensionSwitchCount += 1;

        const outgoingId = this.currentInstanceId;
        this.currentInstanceId = null;
        const outgoingKey = outgoingId === null ? null : this.soundManager.getInstanceKey(outgoingId);
        const targetKey = this.trackKeys[tier] ?? null;
        const elapsedMs = outgoingId === null ? null : this.soundManager.getInstanceElapsedMs(outgoingId);

        if (outgoingId !== null) this.soundManager.pause(outgoingId);

        if (
            outgoingId !== null &&
            outgoingKey !== null &&
            outgoingKey === targetKey &&
            elapsedMs !== null &&
            elapsedMs >= this.sameTrackMinPlayMs
        ) {
            this._resumeInstanceId = outgoingId;
            this._resumeTier = tier;
            this._resumeTimeout = setTimeout(() => {
                this._resumeTimeout = null;
                const id = this._resumeInstanceId;
                const pendingTier = this._resumeTier;
                this._resumeInstanceId = null;
                this._resumeTier = null;
                if (!this.enabled || this.currentTier !== pendingTier || id === null) return;
                if (this.soundManager.resume(id)) {
                    this.currentInstanceId = id;
                    this.soundManager.setDetune(id, this._pitchSemitones * 100);
                } else {
                    this._fadeIn(pendingTier, this.tensionChangeFadeInMs);
                }
            }, this.sameTrackResumeDelayMs);
            return;
        }

        if (outgoingId !== null) this.soundManager.stop(outgoingId);
        this._fadeIn(tier, this.tensionChangeFadeInMs);
    }

    stop(durationMs = this.stopFadeDurationMs) {
        this.enabled = false;
        this._clearPendingResume();
        this._clearPendingLowerTension();
        this.currentTier = null;
        this._pitchLastTension = null;
        this._pitchAccumMs = 0;
        this._pitchSemitones = 0;
        this._pitchDecayFrom = 0;
        this._pitchDecayElapsedMs = 0;
        this._pitchSteady = true;

        const currentId = this.currentInstanceId;
        this.currentInstanceId = null;
        if (currentId !== null) {
            if (durationMs <= 0) this.soundManager.stop(currentId);
            else this._fadeOutAndStop(currentId, durationMs);
        }
    }

    _fadeOutAndStop(id, durationMs) {
        this.soundManager.fadeInstanceVolume(id, 0, durationMs);
        setTimeout(() => this.soundManager.stop(id), durationMs + 50);
    }

    pause() {
        if (this.currentInstanceId !== null) this.soundManager.pause(this.currentInstanceId);
    }

    resume() {
        if (this.currentInstanceId !== null) this.soundManager.resume(this.currentInstanceId);
    }
}
