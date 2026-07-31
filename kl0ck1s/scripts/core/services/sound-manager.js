"use strict";

export const SOUND_CATEGORIES = Object.freeze(["sfx", "music"]);

let nextInstanceId = 1;

/**
 * Web Audio API based sound manager. Every playing sound is a real node
 * graph - source -> instance gain -> category bus (sfx/music) -> master gain
 * -> destination - which is what makes the controls below possible. A plain
 * <audio> pool (the previous implementation) can only have its .volume
 * flipped; it has no clean way to pause-and-resume from the exact sample it
 * stopped at, and no notion of pitch independent from an AudioParam.
 *
 * Every method below is safe to call even before the sound files have
 * finished loading, and degrades to a silent no-op in environments without
 * Web Audio (e.g. some test runners) instead of throwing.
 */
export class SoundManager {
    /**
     * @param {Record<string, {src: string, category?: "sfx"|"music"}|string>} soundFiles
     */
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
        /** key -> AudioBuffer[] (usually length 1, more for sounds with several source-file variants). */
        this.buffers = {};
        /** @type {Map<number, object>} */
        this.instances = new Map();

        this.muted = false;
        this.masterVolume = 1;
        this.categoryVolumes = {sfx: 1, music: 1};
        /** Per-sound base multiplier (0..1). Missing key = full volume (1). */
        this.soundVolumes = {};

        this._previewInstance = null;
        this._ready = null;
    }

    get isSupported() {
        return Boolean(this.AudioContextCtor && this.fetchImpl);
    }

    srcFor(key) {
        const def = this.soundFiles[key];
        return typeof def === "string" ? def : def?.src;
    }

    /** Every source file configured for a sound, as an array - a plain string/single src becomes a 1-element array, so callers never have to special-case "does this sound have variants". */
    srcListFor(key) {
        const src = this.srcFor(key);
        if (Array.isArray(src)) return src;
        return src ? [src] : [];
    }

    categoryFor(key) {
        const def = this.soundFiles[key];
        return (typeof def === "object" && def?.category) || "sfx";
    }

    /** Every sound key belonging to a given category, in declaration order. */
    keysInCategory(category) {
        return Object.keys(this.soundFiles).filter((key) => this.categoryFor(key) === category);
    }

    /**
     * Lazily builds the AudioContext and its gain graph. Deferred out of the
     * constructor because most browsers create contexts in a "suspended"
     * state until there's been a user gesture - building it too early just
     * means an extra resume() dance later for no benefit.
     */
    ensureContext() {
        if (this.context || !this.isSupported) return this.context;

        this.context = new this.AudioContextCtor();
        this.masterGain = this.context.createGain();
        this.masterGain.connect(this.context.destination);
        this._applyMasterGain();

        SOUND_CATEGORIES.forEach((category) => {
            const gain = this.context.createGain();
            gain.gain.value = this.categoryVolumes[category] ?? 1;
            gain.connect(this.masterGain);
            this.categoryGains[category] = gain;
        });

        return this.context;
    }

    /** Fetches + decodes every configured sound. Safe to call more than once - later calls just await the first. */
    init() {
        if (this._ready) return this._ready;

        if (!this.isSupported) {
            this._ready = Promise.resolve();
            return this._ready;
        }

        this.ensureContext();

        this._ready = Promise.all(
            Object.keys(this.soundFiles).map(async (key) => {
                const sources = this.srcListFor(key);
                if (sources.length === 0) return;

                const decoded = await Promise.all(sources.map(async (src) => {
                    try {
                        const response = await this.fetchImpl(src);
                        const arrayBuffer = await response.arrayBuffer();
                        return await this.context.decodeAudioData(arrayBuffer);
                    } catch {
                        // A missing/corrupt variant shouldn't take down the
                        // rest - it's just dropped from the pool below.
                        return null;
                    }
                }));

                const buffers = decoded.filter(Boolean);
                if (buffers.length > 0) this.buffers[key] = buffers;
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

    // ---- Playback ---------------------------------------------------------

    /**
     * @param {string} key
     * @param {object} [opts]
     * @param {boolean} [opts.loop]
     * @param {number} [opts.volume] extra one-off multiplier, on top of the sound's/category's/master volume (default 1)
     * @param {number} [opts.playbackRate] 1 = normal speed
     * @param {number} [opts.detune] cents (100 = one semitone), 0 = no pitch shift
     * @returns {number|null} an instance id usable with stop/pause/resume/setInstanceVolume/setPlaybackRate/setDetune, or null if it couldn't play
     */
    play(key, {loop = false, volume = 1, playbackRate = 1, detune = 0} = {}) {
        if (this.muted) return null;

        const context = this.ensureContext();
        const bufferList = this.buffers[key];
        if (!context || !bufferList || bufferList.length === 0) return null;
        this._resumeIfSuspended();

        // Sounds with several source files (e.g. multiple line-clear takes)
        // pick a random one each time - this is what actually gives the
        // effect of "variety" instead of the same clip every time.
        const buffer = bufferList[Math.floor(Math.random() * bufferList.length)];

        const category = this.categoryFor(key);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = loop;
        source.playbackRate.value = playbackRate;
        source.detune.value = detune;

        const gainNode = context.createGain();
        gainNode.gain.value = volume * (this.soundVolumes[key] ?? 1);
        source.connect(gainNode);
        gainNode.connect(this.categoryGains[category] ?? this.masterGain);

        const id = nextInstanceId++;
        const instance = {
            id, key, category, source, gainNode, loop,
            baseVolume: volume, playbackRate, detune,
            startedAt: context.currentTime, offset: 0, paused: false,
        };
        this.instances.set(id, instance);

        source.onended = () => {
            // A paused instance's source is also technically "ended" (we call
            // .stop() on it) - that's not a real end-of-playback, resume()
            // will swap in a new source, so don't drop the instance's state.
            if (!instance.paused) this.instances.delete(id);
        };

        source.start(0);
        return id;
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

    /** Stops every currently playing instance, optionally scoped to one sound key. */
    stopAll(key = null) {
        [...this.instances.values()]
            .filter((instance) => key === null || instance.key === key)
            .forEach((instance) => this.stop(instance.id));
    }

    /**
     * Web Audio buffer sources are one-shot - once stopped they can never be
     * restarted - so "pause" means: remember exactly how far into the buffer
     * playback had gotten, tear the source down, and let resume() build a
     * fresh source that starts from that offset.
     */
    pause(id) {
        const instance = this._instance(id);
        if (!instance || instance.paused || !this.context) return;

        const elapsed = (this.context.currentTime - instance.startedAt) * instance.playbackRate;
        const duration = instance.source.buffer.duration;
        instance.offset = duration ? (instance.offset + elapsed) % duration : 0;
        instance.paused = true;

        try {
            instance.source.onended = null;
            instance.source.stop();
        } catch {
            // already stopped
        }
    }

    /**
     * Web Audio buffer sources are one-shot, so both resuming a paused
     * instance and reseeking a playing one to an explicit position (see
     * alignToRemaining() below) work the same way: tear down the old source
     * and start a fresh one from the desired offset/rate on the same gain
     * node, so per-instance/per-sound volume keeps applying transparently.
     */
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
            if (!instance.paused) this.instances.delete(id);
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
        if (!instance || !instance.paused) return;
        if (!this.ensureContext()) return;
        this._resumeIfSuspended();
        this._startSourceAt(instance, instance.offset, instance.playbackRate);
    }

    /**
     * Reseeks a currently playing (or paused) instance so that, continuing
     * at normal speed/pitch (rate 1) from right now, it finishes in exactly
     * `remainingMs` - i.e. jumps straight to whichever point in the buffer
     * is `remainingMs` from the end, rather than speeding up or slowing down
     * the remaining audio to fit.
     *
     * Speeding up instead (adjusting playbackRate) pitch-shifts the cue -
     * mildly if there's not much left to compress, but badly (audible
     * "chipmunk" effect) if most of the clip is still unplayed and the
     * deadline is short. Jumping keeps the cue's natural pitch throughout;
     * the trade-off is that part of the clip's middle gets skipped instead
     * of heard, in exchange for always sounding like the same clip.
     *
     * `remainingMs` should come from the same real-time game clock that
     * actually decides when the underlying event happens (e.g. a piece
     * lock) - once reseeked here, playback is driven by the audio hardware
     * clock (context.currentTime), which runs in true wall-clock time
     * regardless of any frame drops in the caller's own clock, so the two
     * stay in sync instead of gradually drifting apart.
     *
     * No-ops if remainingMs isn't positive or the instance/buffer is gone.
     */
    alignToRemaining(id, remainingMs) {
        const instance = this._instance(id);
        if (!instance || remainingMs <= 0) return;

        const buffer = instance.source?.buffer;
        if (!buffer) return;

        if (!instance.paused) {
            try {
                instance.source.onended = null;
                instance.source.stop();
            } catch {
                // already stopped
            }
        }

        const offset = Math.max(0, buffer.duration - remainingMs / 1000);
        this._startSourceAt(instance, offset, 1);
    }

    /** Per-instance volume (0..1), independent of every other currently playing instance of the same sound. */
    setInstanceVolume(id, volume) {
        const instance = this._instance(id);
        if (!instance) return;
        instance.baseVolume = volume;
        instance.gainNode.gain.value = volume * (this.soundVolumes[instance.key] ?? 1);
    }

    /** Takes effect immediately, even mid-playback - playbackRate is a live AudioParam, not a one-time setting. */
    setPlaybackRate(id, rate) {
        const instance = this._instance(id);
        if (!instance) return;
        instance.playbackRate = rate;
        instance.source.playbackRate.value = rate;
    }

    /**
     * Pitch shift in cents (100 cents = one semitone), also live. Note this
     * is a simple AudioParam detune, not a phase vocoder - it changes pitch
     * by resampling, so it inevitably nudges the effective speed too (that's
     * how real vinyl/tape pitch controls work as well). Fully decoupling
     * pitch from speed would need a dedicated pitch-shifting DSP node, which
     * is out of scope here.
     */
    setDetune(id, cents) {
        const instance = this._instance(id);
        if (!instance) return;
        instance.detune = cents;
        instance.source.detune.value = cents;
    }

    // ---- Volume levels (settings-facing) -----------------------------------

    setMuted(muted) {
        this.muted = muted;
        this._applyMasterGain();
        if (muted) this.stopAll();
    }

    /** Master volume (0..1), applied on top of every category/sound volume. */
    setVolume(volume) {
        this.masterVolume = Math.min(1, Math.max(0, volume));
        this._applyMasterGain();
    }

    /** Bus volume (0..1) for a whole category ("sfx" or "music"), applied on top of each sound's own volume. */
    setCategoryVolume(category, volume) {
        const clamped = Math.min(1, Math.max(0, volume));
        this.categoryVolumes[category] = clamped;
        this.ensureContext();
        if (this.categoryGains[category]) this.categoryGains[category].gain.value = clamped;
    }

    getCategoryVolume(category) {
        return this.categoryVolumes[category] ?? 1;
    }

    /** Per-sound base multiplier (0..1). Live-updates every currently playing instance of that sound, not just future ones. */
    setSoundVolume(key, volume) {
        const clamped = Math.min(1, Math.max(0, volume));
        this.soundVolumes[key] = clamped;
        this.instances.forEach((instance) => {
            if (instance.key === key) instance.gainNode.gain.value = instance.baseVolume * clamped;
        });
    }

    getSoundVolume(key) {
        return this.soundVolumes[key] ?? 1;
    }

    /**
     * Plays a sound once at its current settings for the options screen's
     * preview buttons. Bypasses mute (there's no point previewing a sound
     * you can't hear) and cuts off any previous preview so repeatedly
     * clicking preview buttons doesn't stack up overlapping echoes.
     */
    preview(key) {
        if (this._previewInstance !== null) this.stop(this._previewInstance);

        const wasMuted = this.muted;
        this.muted = false;
        const id = this.play(key);
        this.muted = wasMuted;

        this._previewInstance = id;
        return id;
    }
}
