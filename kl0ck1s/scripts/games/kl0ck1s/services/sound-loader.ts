import type {SoundFiles} from "./sound-types.js";
import {isLocalizedSound, sourceListForSound} from "./sound-sources.js";

const SOUND_LOAD_TIMEOUT_MS = 8000;

export interface SoundLoaderHost {
    soundFiles: SoundFiles;
    lang: string;
    context: AudioContext | null;
    fetchImpl: typeof fetch | null;
    buffers: Record<string, AudioBuffer[]>;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
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

export async function decodeSound(host: SoundLoaderHost, src: string): Promise<AudioBuffer | null> {
    const fetchImpl = host.fetchImpl;
    const context = host.context;
    if (!fetchImpl || !context) return null;
    return withTimeout(
        (async () => {
            const response = await fetchImpl(src);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            return await context.decodeAudioData(arrayBuffer);
        })().catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[SoundManager] Failed to load "${src}":`, message);
            return null;
        }),
        SOUND_LOAD_TIMEOUT_MS
    );
}

export async function loadSoundKey(host: SoundLoaderHost, key: string): Promise<void> {
    const def = host.soundFiles[key];
    const rawSrc = typeof def === "string" ? def : def?.src;

    if (rawSrc && typeof rawSrc === "object" && !Array.isArray(rawSrc)) {
        const primary = rawSrc[host.lang];
        const fallback = rawSrc.en;
        const candidates = [...new Set([primary, fallback].filter((value): value is string => Boolean(value)))];

        for (const src of candidates) {
            const buffer = await decodeSound(host, src);
            if (buffer) {
                host.buffers[key] = [buffer];
                if (src !== primary) {
                    console.warn(`[SoundManager] Missing "${host.lang}" audio for "${key}" (expected "${primary}"), using "${src}" instead.`);
                }
                return;
            }
        }
        console.warn(`[SoundManager] No playable audio found for "${key}".`);
        return;
    }

    const sources = sourceListForSound(host.soundFiles, key, host.lang);
    if (sources.length === 0) return;

    const decoded = await Promise.all(sources.map((src) => decodeSound(host, src)));
    const buffers = decoded.filter((buffer): buffer is AudioBuffer => buffer !== null);
    if (buffers.length > 0) host.buffers[key] = buffers;
}

export async function reloadLocalizedSounds(host: SoundLoaderHost): Promise<void> {
    const keys = Object.keys(host.soundFiles).filter((key) => isLocalizedSound(host.soundFiles, key));
    await Promise.all(keys.map((key) => loadSoundKey(host, key)));
}

export async function loadAllSounds(host: SoundLoaderHost, onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const keys = Object.keys(host.soundFiles);
    let loaded = 0;
    await Promise.all(keys.map(async (key) => {
        await loadSoundKey(host, key);
        onProgress?.(++loaded, keys.length);
    }));
}
