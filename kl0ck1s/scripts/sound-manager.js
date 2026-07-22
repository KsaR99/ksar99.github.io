"use strict";

export class SoundManager {
    constructor(soundFiles, {AudioCtor = (typeof Audio !== "undefined" ? Audio : null), volume = 1.0} = {}) {
        this.soundFiles = soundFiles;
        this.AudioCtor = AudioCtor;
        this.muted = false;
        this.volume = volume;
        this.players = {};
    }

    init() {
        if (!this.AudioCtor) return;
        Object.entries(this.soundFiles).forEach(([key, src]) => {
            const audio = new this.AudioCtor(src);
            audio.preload = "auto";
            audio.volume = this.volume;
            this.players[key] = audio;
        });
    }

    play(key) {
        if (this.muted) return;
        const base = this.players[key];
        if (!base) return;

        const instance = base.cloneNode();
        instance.volume = this.volume;
        instance.play().catch(() => {
        });
    }

    setMuted(muted) {
        this.muted = muted;
    }

    setVolume(volume) {
        this.volume = Math.min(1, Math.max(0, volume));
        Object.values(this.players).forEach((audio) => {
            audio.volume = this.volume;
        });
    }
}
