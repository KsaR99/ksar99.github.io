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
        this.currentTier = tier;
        this._crossfadeTo(tier);
    }

    _fadeIn(tier) {
        const key = this.trackKeys[tier];
        if (!key) return;
        const id = this.soundManager.play(key, {loop: true, volume: 0});
        if (id === null) return;
        this.currentInstanceId = id;
        this.soundManager.fadeInstanceVolume(id, 1, this.fadeDurationMs);
    }

    _crossfadeTo(tier) {
        const outgoingId = this.currentInstanceId;
        this.currentInstanceId = null;
        if (outgoingId !== null) this._fadeOutAndStop(outgoingId, this.fadeDurationMs);
        this._fadeIn(tier);
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

        const currentId = this.currentInstanceId;
        this.currentInstanceId = null;
        if (currentId !== null) this._fadeOutAndStop(currentId, durationMs);
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
