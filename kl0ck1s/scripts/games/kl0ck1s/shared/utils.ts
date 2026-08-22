"use strict";

import {SCORING, VOICE_COUNTING_NUMBERS, voiceCountingKey, voiceOrdinalKey} from "./config.js";

export function numberToCountingParts(number: number): number[] {
    if (!Number.isInteger(number) || number <= 0) return [];
    if (VOICE_COUNTING_NUMBERS.includes(number)) return [number];
    if (number > 100 && number < 200) {
        const rest = numberToCountingParts(number - 100);
        return rest.length > 0 ? [100, ...rest] : [100];
    }
    if (number > 0 && number < 100) {
        const tens = Math.floor(number / 10) * 10;
        const ones = number % 10;
        if (VOICE_COUNTING_NUMBERS.includes(tens) && VOICE_COUNTING_NUMBERS.includes(ones)) {
            return [tens, ones];
        }
    }
    return [];
}

export function numberToVoiceKeys(number: number, lang: string = "en"): string[] {
    const parts = numberToCountingParts(number);
    if (lang !== "pl") return parts.map(voiceCountingKey);

    return parts.map((part, index) => {
        const isHundredPrefix = part === 100 && index < parts.length - 1;
        return isHundredPrefix ? voiceCountingKey(part) : voiceOrdinalKey(part);
    });
}

export function isCascadeMode(mode: string): boolean {
    return mode === "cascade" || mode === "cascadeHardcore";
}

export function forEachShapeCell(mask: number, width: number, height: number, cb: (row: number, col: number) => void): void {
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if ((mask >> (r * width + c)) & 1) cb(r, c);
        }
    }
}

export function rollSurvivalGarbageCount(def: {
    garbageLinesMin: number;
    garbageLinesMax: number
}, random: () => number = Math.random): number {
    const span = def.garbageLinesMax - def.garbageLinesMin + 1;
    return def.garbageLinesMin + Math.floor(random() * span);
}

export function getTightBounds(mask: number, width: number, height: number): {
    minX: number;
    minY: number;
    width: number;
    height: number
} {
    let minX = width, maxX = -1, minY = height, maxY = -1;

    forEachShapeCell(mask, width, height, (r, c) => {
        if (c < minX) minX = c;
        if (c > maxX) maxX = c;
        if (r < minY) minY = r;
        if (r > maxY) maxY = r;
    });

    return {minX, minY, width: maxX - minX + 1, height: maxY - minY + 1};
}

export function withAlpha(color: string, alpha: number): string {
    return color.replace(/\s*\/\s*[^)]+\)$/, ")").replace(/\)$/, ` / ${alpha})`);
}

export function lightenOklch(color: string, amount: number = 0.9, maxLightness: number = 0.7): string {
    const match = color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)/);
    if (!match) return color;

    const [, l, c, h, a] = match;
    const lightened = Math.min(maxLightness, parseFloat(l) + amount);
    const fadedChroma = parseFloat(c) * 0.55;
    const alphaSuffix = a ? ` / ${a}` : "";
    return `oklch(${lightened} ${fadedChroma} ${h}${alphaSuffix})`;
}

export function dropIntervalForLevel(level: number, scoring = SCORING): number {
    const base = Math.max(0.001, scoring.GUIDELINE_DROP_BASE - (level - 1) * scoring.GUIDELINE_DROP_STEP);
    const seconds = base ** (level - 1);
    return Math.max(scoring.MIN_DROP_INTERVAL, seconds * 1000);
}

export function tierForLevel(level: number, difficulties: Record<string, { startLevel: number }>): string | null {
    let tier = null;
    let bestStart = -Infinity;

    for (const [key, def] of Object.entries(difficulties)) {
        if (def.startLevel <= level && def.startLevel > bestStart) {
            bestStart = def.startLevel;
            tier = key;
        }
    }

    return tier;
}

export function nowMs(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function smoothedInterval(lastTime: number, effectiveMs: number, now: number, smoothing: number = 0.7): {
    lastTime: number;
    effectiveMs: number
} {
    if (lastTime <= 0) return {lastTime: now, effectiveMs};
    const interval = now - lastTime;
    const nextEffectiveMs = effectiveMs === Infinity
        ? interval
        : effectiveMs * smoothing + interval * (1 - smoothing);
    return {lastTime: now, effectiveMs: nextEffectiveMs};
}

export function formatNumber(number: number, decimals: number = 1): string {
    const units: readonly (readonly [string, number])[] = [
        ["b", 1e9],
        ["m", 1e6],
        ["k", 1e3],
    ];

    for (const [suffix, value] of units) {
        if (number >= value) {
            return (number / value)
                    .toFixed(decimals)
                    .replace(/\.0$/, "")
                + suffix;
        }
    }

    return String(number);
}

export function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");

    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDurationPrecise(ms: number): string {
    const clamped = Math.max(0, ms);
    const totalCentiseconds = Math.floor(clamped / 10);
    const totalSeconds = Math.floor(totalCentiseconds / 100);
    const centiseconds = totalCentiseconds % 100;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    const cc = String(centiseconds).padStart(2, "0");

    return hours > 0 ? `${hours}:${mm}:${ss}.${cc}` : `${mm}:${ss}.${cc}`;
}

export function isMobileViewport(): boolean {
    return typeof globalThis.matchMedia === "function" ? globalThis.matchMedia("(width < 48rem)").matches : false;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
    try {
        await globalThis.navigator?.clipboard?.writeText(text);
        return true;
    } catch {
        return false;
    }
}

export function debounce<T extends (...args: any[]) => void>(fn: T, delayMs: number = 200): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args) => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delayMs);
    };
}

