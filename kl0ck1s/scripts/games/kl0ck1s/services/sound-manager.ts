// @ts-nocheck
"use strict";

import {
    categoryForSound,
    isLocalizedSound,
    SOUND_CATEGORIES,
    sourceForSound,
    sourceListForSound
} from "./sound-sources.js";
import {decodeSound, loadSoundKey} from "./sound-loader.js";
import type {SoundCategory, SoundFiles} from "./sound-types.js";

let nextInstanceId = 1;

type AudioInstance = {
    id: number;
    key: string;
    category: string;
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    loop: boolean;
    baseVolume: number;
    playbackRate: number;
    detune: number;
    startedAt: number;
    offset: number;
    paused: boolean;
    onEnded: (() => void) | null;
};

type AudioContextConstructor = typeof AudioContext;
type SoundMapNumber = Record<string, number>;
type SoundMapBoolean = Record<string, boolean>;

export {SOUND_CATEGORIES} from "./sound-sources.js";
export type {SoundFiles, SoundDefinition, SoundCategory} from "./sound-types.js";

export class SoundManager {

    soundFiles: SoundFiles;
    AudioContextCtor: AudioContextConstructor | null;
    fetchImpl: typeof fetch | null;
    lang: string;
    context: AudioContext | null;
    masterGain: GainNode | null;
    categoryGains: Record<string, GainNode>;
    buffers: Record<string, AudioBuffer[]>;
    instances: Map<number, AudioInstance>;
    muted: boolean;
    masterVolume: number;
    categoryVolumes: Record<string, number>;
    categoryMuted: SoundMapBoolean;
    soundVolumes: SoundMapNumber;
    soundMuted: SoundMapBoolean;
    _previewInstance: number | null;
    _previewKey: string | null;
    _ready: Promise<void> | null;
    _keyPromises: Record<string, Promise<void>>;
    _allReady: Promise<void> | null;
    _gameplayAudioReady: boolean;

    constructor(soundFiles: SoundFiles, {
        AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null,
        fetchImpl = globalThis.fetch?.bind(globalThis) ?? null,
        lang = "en",
    }: { AudioContextCtor?: AudioContextConstructor | null; fetchImpl?: typeof fetch | null; lang?: string } = {}) {
        this.soundFiles = soundFiles;
        this.AudioContextCtor = AudioContextCtor;
        this.fetchImpl = fetchImpl;
        this.lang = lang;

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
        this._keyPromises = {};
        this._allReady = null;
        this._gameplayAudioReady = false;
    }

    get isSupported() {
        return Boolean(this.AudioContextCtor && this.fetchImpl);
    }

    _effectiveSoundVolume(key: string): number {
        if (this.soundMuted[key]) return 0;
        return this.soundVolumes[key] ?? 1;
    }

    isLocalizedSrc(key: string): boolean {
        return isLocalizedSound(this.soundFiles, key);
    }

    srcFor(key: string): string {
        return sourceForSound(this.soundFiles, key, this.lang);
    }

    srcListFor(key: string): string[] {
        return sourceListForSound(this.soundFiles, key, this.lang);
    }

    categoryFor(key: string): SoundCategory {
        return categoryForSound(this.soundFiles, key);
    }

    keysInCategory(category: string): string[] {
        return Object.keys(this.soundFiles).filter((key) => this.categoryFor(key) === category);
    }

    ensureContext(): AudioContext | null {
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

    async _decode(src: string): Promise<AudioBuffer | null> {
        return decodeSound(this, src);
    }

    async _loadKey(key: string): Promise<void> {
        await loadSoundKey(this, key);
    }

    initKey(key: string): Promise<void> {
        if (!key || !this.soundFiles[key]) return Promise.resolve();
        if (this._keyPromises[key]) return this._keyPromises[key];

        if (!this.isSupported) {
            this._keyPromises[key] = Promise.resolve();
            return this._keyPromises[key];
        }

        this.ensureContext();
        this._keyPromises[key] = this._loadKey(key).catch((err) => {
            console.warn(`[SoundManager] Failed to initialize sound \"${key}\":`, err);
        });
        return this._keyPromises[key];
    }

    loadCategory(category: string, onProgress: ((loaded: number, total: number) => void) | null = null): Promise<void> {
        return this.initCategory(category, onProgress);
    }

    initCategory(category: string, onProgress: ((loaded: number, total: number) => void) | null = null): Promise<void> {
        const keys = this.keysInCategory(category);
        const total = keys.length;
        if (total === 0) {
            onProgress?.(0, 0);
            return Promise.resolve();
        }
        return this._loadKeysLimited(keys, onProgress);
    }

    init(onProgress: ((loaded: number, total: number) => void) | null = null): Promise<void> {
        if (this._ready) return this._ready;

        const keys = Object.keys(this.soundFiles);
        const total = keys.length;

        if (!this.isSupported) {
            onProgress?.(total, total);
            this._ready = Promise.resolve();
            this._allReady = this._ready;
            return this._ready;
        }

        this.ensureContext();

        let loaded = 0;
        const reportProgress = () => onProgress?.(++loaded, total);

        this._ready = Promise.all(
            keys.map((key) => this.initKey(key).then(reportProgress))
        ).then(() => undefined);
        this._allReady = this._ready;

        return this._ready;
    }

    initIdle(onProgress: ((loaded: number, total: number) => void) | null = null): Promise<void> {
        return this.initKey("idleSong").then(() => onProgress?.(1, 1));
    }

    initForGameplay(onProgress: ((loaded: number, total: number) => void) | null = null): Promise<void> {
        if (this._gameplayAudioReady) return Promise.resolve();
        if (this._allReady) return this._allReady;
        this._gameplayAudioReady = false;
        const categories = ["sfx", "voices", "music"];
        const totals = categories.map((category) => this.keysInCategory(category).length);
        const total = totals.reduce((sum, value) => sum + value, 0);
        if (total === 0 || !this.isSupported) {
            onProgress?.(total, total);
            this._allReady = Promise.resolve();
            return this._allReady;
        }
        this.ensureContext();
        let loaded = 0;
        this._allReady = (async () => {
            for (const category of categories) {
                await this.initCategory(category, () => onProgress?.(++loaded, total));
            }
            this._gameplayAudioReady = true;
        })();
        return this._allReady;
    }

    initSfx(onProgress: ((loaded: number, total: number) => void) | null = null): Promise<void> {
        return this.initCategory("sfx", onProgress);
    }

    initVoices(onProgress: ((loaded: number, total: number) => void) | null = null): Promise<void> {
        return this.initCategory("voices", onProgress);
    }

    initMusic(onProgress: ((loaded: number, total: number) => void) | null = null): Promise<void> {
        return this.initCategory("music", onProgress);
    }

    readyForGameplay(): Promise<void> {
        return this._allReady ?? this.initForGameplay();
    }

    isGameplayAudioReady(): boolean {
        return this._gameplayAudioReady;
    }

    gameplayAudioStatus(): { ready: boolean; category: string; loaded: number; total: number } {
        if (this._gameplayAudioReady) {
            return {ready: true, category: "", loaded: 0, total: 0};
        }

        const categories = ["sfx", "voices", "music"];
        for (const category of categories) {
            const keys = this.keysInCategory(category);
            const loaded = keys.filter((key) => Boolean(this.buffers[key]?.length)).length;
            const pending = keys.some((key) => !this._keyPromises[key]);

            if (pending || loaded < keys.length) {
                return {
                    ready: false,
                    category,
                    loaded,
                    total: keys.length,
                };
            }
        }

        return {
            ready: false,
            category: "music",
            loaded: 0,
            total: this.keysInCategory("music").length,
        };
    }

    async setLanguage(lang: string): Promise<void> {
        if (this.lang === lang) return;
        this.lang = lang;
        if (!this.context) return;

        const keys = Object.keys(this.soundFiles).filter((key) => this.isLocalizedSrc(key));
        await Promise.all(keys.map((key) => this._loadKey(key)));
    }

    _applyMasterGain() {
        if (!this.masterGain) return;
        this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
    }

    _resumeIfSuspended(): void {
        if (this.context?.state === "suspended") this.context.resume().catch(() => {
        });
    }

    play(key: string, {loop = false, volume = 1, playbackRate = 1, detune = 0, onEnded = null}: {
        loop?: boolean; volume?: number; playbackRate?: number; detune?: number; onEnded?: (() => void) | null;
    } = {}): number | null {
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

    playSequence(keys: string[], opts: {
        loop?: boolean; volume?: number; playbackRate?: number; detune?: number; onEnded?: (() => void) | null;
    } = {}): number | null {
        const [first, ...rest] = keys;
        if (!first) return null;
        if (rest.length === 0) return this.play(first, opts);
        return this.play(first, {...opts, onEnded: () => this.playSequence(rest, opts)});
    }

    _instance(id: number): AudioInstance | null {
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

    stopAll(key: string | null = null): void {
        [...this.instances.values()]
            .filter((instance) => key === null || instance.key === key)
            .forEach((instance) => this.stop(instance.id));
    }

    stopCategory(category: string): void {
        [...this.instances.values()]
            .filter((instance) => instance.category === category)
            .forEach((instance) => this.stop(instance.id));
    }

    unlock() {
        const context = this.ensureContext();
        if (context) this._resumeIfSuspended();
        return context;
    }

    pause(id: number): void {
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

    _startSourceAt(instance: AudioInstance, offset: number, rate: number): void {
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

    resume(id: number): boolean {
        const instance = this._instance(id);
        if (!instance || !instance.paused) return false;
        const buffer = instance.source?.buffer;
        if (buffer && instance.offset >= buffer.duration) return false;
        if (!this.ensureContext()) return false;
        this._resumeIfSuspended();
        this._startSourceAt(instance, instance.offset, instance.playbackRate);
        return true;
    }

    isPlaying(id: number): boolean {
        const instance = this._instance(id);
        return Boolean(instance && !instance.paused);
    }

    getInstanceKey(id: number): string | null {
        return this._instance(id)?.key ?? null;
    }

    getInstanceElapsedMs(id: number): number | null {
        const instance = this._instance(id);
        if (!instance || !this.context) return null;
        if (instance.paused) return instance.offset * 1000;
        return Math.max(0, instance.offset + (this.context.currentTime - instance.startedAt) * instance.playbackRate) * 1000;
    }

    setInstanceVolume(id: number, volume: number): void {
        const instance = this._instance(id);
        if (!instance) return;
        instance.baseVolume = volume;
        instance.gainNode.gain.value = volume * this._effectiveSoundVolume(instance.key);
    }

    fadeInstanceVolume(id: number, volume: number, durationMs = 0): void {
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

    rampInstanceDetune(id: number, cents: number, durationMs = 0): void {
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

    setPlaybackRate(id: number, rate: number): void {
        const instance = this._instance(id);
        if (!instance) return;
        instance.playbackRate = rate;
        instance.source.playbackRate.value = rate;
    }

    setDetune(id: number, cents: number): void {
        const instance = this._instance(id);
        if (!instance) return;
        instance.detune = cents;
        instance.source.detune.value = cents;
    }

    setMuted(muted: boolean): void {
        this.muted = muted;
        this._applyMasterGain();
    }

    setVolume(volume: number): void {
        this.masterVolume = Math.min(1, Math.max(0, volume));
        this._applyMasterGain();
    }

    setCategoryVolume(category: string, volume: number): void {
        const clamped = Math.min(1, Math.max(0, volume));
        this.categoryVolumes[category] = clamped;
        this.ensureContext();
        if (this.categoryGains[category] && !this.categoryMuted[category]) {
            this.categoryGains[category].gain.value = clamped;
        }
    }

    setCategoryMuted(category: string, muted: boolean): void {
        this.categoryMuted[category] = muted;
        this.ensureContext();
        if (this.categoryGains[category]) {
            this.categoryGains[category].gain.value = muted ? 0 : (this.categoryVolumes[category] ?? 1);
        }
    }

    getCategoryVolume(category: string): number {
        return this.categoryVolumes[category] ?? 1;
    }

    setSoundVolume(key: string, volume: number): void {
        const clamped = Math.min(1, Math.max(0, volume));
        this.soundVolumes[key] = clamped;
        this.instances.forEach((instance) => {
            if (instance.key === key) instance.gainNode.gain.value = instance.baseVolume * this._effectiveSoundVolume(key);
        });
    }

    getSoundVolume(key: string): number {
        return this.soundVolumes[key] ?? 1;
    }

    setSoundMuted(key: string, muted: boolean): void {
        this.soundMuted[key] = muted;
        this.instances.forEach((instance) => {
            if (instance.key === key) instance.gainNode.gain.value = instance.baseVolume * this._effectiveSoundVolume(key);
        });
    }

    getDuration(key: string): number | null {
        const buffer = this.buffers[key]?.[0];
        return buffer ? buffer.duration : null;
    }

    preview(key: string): number | null {
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

    previewToggle(key: string, onEnded: (() => void) | null, opts: {
        loop?: boolean; volume?: number; playbackRate?: number; detune?: number;
    } = {}): "playing" | "paused" {
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

    private async _loadKeysLimited(keys: string[], onProgress: ((loaded: number, total: number) => void) | null = null, concurrency = 2): Promise<void> {
        let next = 0;
        let loaded = 0;
        const worker = async () => {
            while (true) {
                const index = next++;
                if (index >= keys.length) return;
                await this.initKey(keys[index]);
                onProgress?.(++loaded, keys.length);
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
        };
        await Promise.all(Array.from({length: Math.min(concurrency, keys.length)}, () => worker()));
    }
}
