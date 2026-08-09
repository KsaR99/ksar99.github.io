"use strict";

export const SOUND_CATEGORIES = Object.freeze(["sfx", "music", "voices"]);

let nextInstanceId = 1;

const SOUND_LOAD_TIMEOUT_MS = 8000;

function withTimeout(promise, ms) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            () => {
                clearTimeout(timer);
                resolve(null);
            }
        );
    });
}

export class SoundManager {
    constructor(soundFiles, {
        AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null,
        fetchImpl = globalThis.fetch?.bind(globalThis) ?? null,
    } = {}) {
        this.soundFiles = soundFiles;
        this.AudioContextCtor = AudioContextCtor;
        this.fetchImpl = fetchImpl;

        this.context = null;
        this.masterGain = null;
        this.categoryGains = {};
        this.buffers = {};
        this.instances = new Map();

        this.muted = false;
        this.masterVolume = 1;
        this.categoryVolumes = {sfx: 1, music: 1};
        this.categoryMuted = {};
        this.soundVolumes = {};
        this.soundMuted = {};

        this._previewInstance = null;
        this._previewKey = null;
        this._ready = null;
    }

    get isSupported() {
        return Boolean(this.AudioContextCtor && this.fetchImpl);
    }

    _effectiveSoundVolume(key) {
        if (this.soundMuted[key]) return 0;
        return this.soundVolumes[key] ?? 1;
    }

    srcFor(key) {
        const def = this.soundFiles[key];
        return typeof def === "string" ? def : def?.src;
    }

    srcListFor(key) {
        const src = this.srcFor(key);
        if (Array.isArray(src)) return src;
        return src ? [src] : [];
    }

    categoryFor(key) {
        const def = this.soundFiles[key];
        return (typeof def === "object" && def?.category) || "sfx";
    }

    keysInCategory(category) {
        return Object.keys(this.soundFiles).filter((key) => this.categoryFor(key) === category);
    }

    ensureContext() {
        if (this.context || !this.isSupported) return this.context;

        this.context = new this.AudioContextCtor();
        this.masterGain = this.context.createGain();
        this.masterGain.connect(this.context.destination);
        this._applyMasterGain();

        SOUND_CATEGORIES.forEach((category) => {
            const gain = this.context.createGain();
            gain.gain.value = this.categoryMuted[category] ? 0 : (this.categoryVolumes[category] ?? 1);
            gain.connect(this.masterGain);
            this.categoryGains[category] = gain;
        });

        return this.context;
    }

    init(onProgress = null) {
        if (this._ready) return this._ready;

        const keys = Object.keys(this.soundFiles);
        const total = keys.length;

        if (!this.isSupported) {
            onProgress?.(total, total);
            this._ready = Promise.resolve();
            return this._ready;
        }

        this.ensureContext();

        let loaded = 0;
        const reportProgress = () => onProgress?.(++loaded, total);

        this._ready = Promise.all(
            keys.map(async (key) => {
                const sources = this.srcListFor(key);
                if (sources.length === 0) {
                    reportProgress();
                    return;
                }

                const decoded = await Promise.all(sources.map((src) => withTimeout(
                    (async () => {
                        const response = await this.fetchImpl(src);
                        const arrayBuffer = await response.arrayBuffer();
                        return await this.context.decodeAudioData(arrayBuffer);
                    })().catch(() => null),
                    SOUND_LOAD_TIMEOUT_MS
                )));

                const buffers = decoded.filter(Boolean);
                if (buffers.length > 0) this.buffers[key] = buffers;
                reportProgress();
            })
        ).then(() => undefined);

        return this._ready;
    }

    _applyMasterGain() {
        if (!this.masterGain) return;
        this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
    }

    _resumeIfSuspended() {
        if (this.context?.state === "suspended") this.context.resume().catch(() => {
        });
    }

    play(key, {loop = false, volume = 1, playbackRate = 1, detune = 0, onEnded = null} = {}) {
        if (this.muted) return null;

        const context = this.ensureContext();
        const bufferList = this.buffers[key];
        if (!context || !bufferList || bufferList.length === 0) return null;
        this._resumeIfSuspended();

        const buffer = bufferList[0];

        const category = this.categoryFor(key);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = loop;
        source.playbackRate.value = playbackRate;
        source.detune.value = detune;

        const gainNode = context.createGain();
        gainNode.gain.value = volume * this._effectiveSoundVolume(key);
        source.connect(gainNode);
        gainNode.connect(this.categoryGains[category] ?? this.masterGain);

        const id = nextInstanceId++;
        const instance = {
            id, key, category, source, gainNode, loop,
            baseVolume: volume, playbackRate, detune,
            startedAt: context.currentTime, offset: 0, paused: false,
            onEnded,
        };
        this.instances.set(id, instance);

        source.onended = () => {
            if (!instance.paused) {
                this.instances.delete(id);
                instance.onEnded?.();
            }
        };

        source.start(0);
        return id;
    }

    playSequence(keys, opts = {}) {
        const [first, ...rest] = keys;
        if (!first) return null;
        if (rest.length === 0) return this.play(first, opts);
        return this.play(first, {...opts, onEnded: () => this.playSequence(rest, opts)});
    }

    _instance(id) {
        return this.instances.get(id) ?? null;
    }

    stop(id) {
        const instance = this._instance(id);
        if (!instance) return;
        instance.paused = false;
        try {
            instance.source.onended = null;
            instance.source.stop();
        } catch {
            // already stopped
        }
        this.instances.delete(id);
    }

    stopAll(key = null) {
        [...this.instances.values()]
            .filter((instance) => key === null || instance.key === key)
            .forEach((instance) => this.stop(instance.id));
    }

    stopCategory(category) {
        [...this.instances.values()]
            .filter((instance) => instance.category === category)
            .forEach((instance) => this.stop(instance.id));
    }

    unlock() {
        const context = this.ensureContext();
        if (context) this._resumeIfSuspended();
        return context;
    }

    pause(id) {
        const instance = this._instance(id);
        if (!instance || instance.paused || !this.context) return;

        const elapsed = (this.context.currentTime - instance.startedAt) * instance.playbackRate;
        const duration = instance.source.buffer.duration;
        let offset = instance.offset + elapsed;
        if (duration) {
            offset = instance.source.loop ? offset % duration : Math.min(offset, duration);
        } else {
            offset = 0;
        }
        instance.offset = offset;
        instance.paused = true;

        try {
            instance.source.onended = null;
            instance.source.stop();
        } catch {
            // already stopped
        }
    }

    _startSourceAt(instance, offset, rate) {
        const context = this.ensureContext();
        if (!context) return;

        const source = context.createBufferSource();
        source.buffer = instance.source.buffer;
        source.loop = instance.loop;
        source.playbackRate.value = rate;
        source.detune.value = instance.detune;
        source.connect(instance.gainNode);

        const id = instance.id;
        source.onended = () => {
            if (!instance.paused) {
                this.instances.delete(id);
                instance.onEnded?.();
            }
        };

        instance.source = source;
        instance.playbackRate = rate;
        instance.offset = offset;
        instance.startedAt = context.currentTime;
        instance.paused = false;
        source.start(0, offset);
    }

    resume(id) {
        const instance = this._instance(id);
        if (!instance || !instance.paused) return false;
        const buffer = instance.source?.buffer;
        if (buffer && instance.offset >= buffer.duration) return false;
        if (!this.ensureContext()) return false;
        this._resumeIfSuspended();
        this._startSourceAt(instance, instance.offset, instance.playbackRate);
        return true;
    }

    setInstanceVolume(id, volume) {
        const instance = this._instance(id);
        if (!instance) return;
        instance.baseVolume = volume;
        instance.gainNode.gain.value = volume * this._effectiveSoundVolume(instance.key);
    }

    fadeInstanceVolume(id, volume, durationMs = 0) {
        const instance = this._instance(id);
        if (!instance) return;
        const context = this.ensureContext();
        if (!context) return;

        const target = Math.min(1, Math.max(0, volume)) * this._effectiveSoundVolume(instance.key);
        instance.baseVolume = volume;

        const param = instance.gainNode.gain;
        const now = context.currentTime;
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        if (durationMs <= 0) {
            param.setValueAtTime(target, now);
        } else {
            param.linearRampToValueAtTime(target, now + durationMs / 1000);
        }
    }

    rampInstanceDetune(id, cents, durationMs = 0) {
        const instance = this._instance(id);
        if (!instance) return;
        const context = this.ensureContext();
        if (!context) return;

        instance.detune = cents;

        const param = instance.source.detune;
        const now = context.currentTime;
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        if (durationMs <= 0) {
            param.setValueAtTime(cents, now);
        } else {
            param.linearRampToValueAtTime(cents, now + durationMs / 1000);
        }
    }

    setPlaybackRate(id, rate) {
        const instance = this._instance(id);
        if (!instance) return;
        instance.playbackRate = rate;
        instance.source.playbackRate.value = rate;
    }

    setDetune(id, cents) {
        const instance = this._instance(id);
        if (!instance) return;
        instance.detune = cents;
        instance.source.detune.value = cents;
    }

    setMuted(muted) {
        this.muted = muted;
        this._applyMasterGain();
        if (muted) this.stopAll();
    }

    setVolume(volume) {
        this.masterVolume = Math.min(1, Math.max(0, volume));
        this._applyMasterGain();
    }

    setCategoryVolume(category, volume) {
        const clamped = Math.min(1, Math.max(0, volume));
        this.categoryVolumes[category] = clamped;
        this.ensureContext();
        if (this.categoryGains[category] && !this.categoryMuted[category]) {
            this.categoryGains[category].gain.value = clamped;
        }
    }

    setCategoryMuted(category, muted) {
        this.categoryMuted[category] = muted;
        this.ensureContext();
        if (this.categoryGains[category]) {
            this.categoryGains[category].gain.value = muted ? 0 : (this.categoryVolumes[category] ?? 1);
        }
    }

    getCategoryVolume(category) {
        return this.categoryVolumes[category] ?? 1;
    }

    setSoundVolume(key, volume) {
        const clamped = Math.min(1, Math.max(0, volume));
        this.soundVolumes[key] = clamped;
        this.instances.forEach((instance) => {
            if (instance.key === key) instance.gainNode.gain.value = instance.baseVolume * this._effectiveSoundVolume(key);
        });
    }

    getSoundVolume(key) {
        return this.soundVolumes[key] ?? 1;
    }

    setSoundMuted(key, muted) {
        this.soundMuted[key] = muted;
        this.instances.forEach((instance) => {
            if (instance.key === key) instance.gainNode.gain.value = instance.baseVolume * this._effectiveSoundVolume(key);
        });
    }

    getDuration(key) {
        const buffer = this.buffers[key]?.[0];
        return buffer ? buffer.duration : null;
    }

    preview(key) {
        if (this._previewInstance !== null) this.stop(this._previewInstance);

        const wasMuted = this.muted;
        this.muted = false;
        const id = this.play(key);
        this.muted = wasMuted;

        this._previewInstance = id;
        return id;
    }

    stopPreview() {
        if (this._previewInstance == null) return;
        this.stop(this._previewInstance);
        this._previewInstance = null;
        this._previewKey = null;
    }

    previewToggle(key, onEnded, opts = {}) {
        if (this._previewKey === key && this._previewInstance != null) {
            const instance = this._instance(this._previewInstance);
            if (instance) {
                if (instance.paused) {
                    this.resume(this._previewInstance);
                    return "playing";
                }
                this.pause(this._previewInstance);
                return "paused";
            }
        }

        if (this._previewInstance !== null) this.stop(this._previewInstance);

        const wasMuted = this.muted;
        this.muted = false;
        const id = this.play(key, {...opts, onEnded});
        this.muted = wasMuted;

        this._previewInstance = id;
        this._previewKey = key;
        return "playing";
    }
}
