// @ts-nocheck
import type {SoundCategory, SoundFiles} from "./sound-types.js";

export const SOUND_CATEGORIES = Object.freeze(["sfx", "music", "voices"] as const);

export function definitionFor(files: SoundFiles, key: string) {
    return files[key];
}

export function sourceForSound(files: SoundFiles, key: string, lang: string): string | string[] | undefined {
    const def = definitionFor(files, key);
    const src = typeof def === "string" ? def : def?.src;
    if (src && typeof src === "object" && !Array.isArray(src)) {
        return src[lang] ?? src.en ?? Object.values(src)[0];
    }
    return src;
}

export function sourceListForSound(files: SoundFiles, key: string, lang: string): string[] {
    const src = sourceForSound(files, key, lang);
    if (Array.isArray(src)) return src;
    return src ? [src] : [];
}

export function isLocalizedSound(files: SoundFiles, key: string): boolean {
    const def = definitionFor(files, key);
    const src = typeof def === "string" ? def : def?.src;
    return Boolean(src) && typeof src === "object" && !Array.isArray(src);
}

export function categoryForSound(files: SoundFiles, key: string): SoundCategory {
    const def = definitionFor(files, key);
    return typeof def === "object" && def.category ? def.category : "sfx";
}
