"use strict";

import {SCORING, VOICE_COUNTING_NUMBERS, voiceCountingKey, voiceOrdinalKey} from "./config.js";

export function numberToCountingParts(number) {
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

export function numberToVoiceKeys(number, lang = "en") {
    const parts = numberToCountingParts(number);
    if (lang !== "pl") return parts.map(voiceCountingKey);

    return parts.map((part, index) => {
        const isHundredPrefix = part === 100 && index < parts.length - 1;
        return isHundredPrefix ? voiceCountingKey(part) : voiceOrdinalKey(part);
    });
}

export function isCascadeMode(mode) {
    return mode === "cascade" || mode === "cascadeHardcore";
}

export function forEachShapeCell(mask, width, height, cb) {
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if ((mask >> (r * width + c)) & 1) cb(r, c);
        }
    }
}

export function rollSurvivalGarbageCount(def, random = Math.random) {
    const span = def.garbageLinesMax - def.garbageLinesMin + 1;
    return def.garbageLinesMin + Math.floor(random() * span);
}

export function getTightBounds(mask, width, height) {
    let minX = width, maxX = -1, minY = height, maxY = -1;

    forEachShapeCell(mask, width, height, (r, c) => {
        if (c < minX) minX = c;
        if (c > maxX) maxX = c;
        if (r < minY) minY = r;
        if (r > maxY) maxY = r;
    });

    return {minX, minY, width: maxX - minX + 1, height: maxY - minY + 1};
}

export function withAlpha(color, alpha) {
    return color.replace(/\s*\/\s*[^)]+\)$/, ")").replace(/\)$/, ` / ${alpha})`);
}

export function lightenOklch(color, amount = 0.9, maxLightness = 0.7) {
    const match = color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)/);
    if (!match) return color;

    const [, l, c, h, a] = match;
    const lightened = Math.min(maxLightness, parseFloat(l) + amount);
    const fadedChroma = parseFloat(c) * 0.55;
    const alphaSuffix = a ? ` / ${a}` : "";
    return `oklch(${lightened} ${fadedChroma} ${h}${alphaSuffix})`;
}

export function dropIntervalForLevel(level, scoring = SCORING) {
    const base = Math.max(0.001, scoring.GUIDELINE_DROP_BASE - (level - 1) * scoring.GUIDELINE_DROP_STEP);
    const seconds = base ** (level - 1);
    return Math.max(scoring.MIN_DROP_INTERVAL, seconds * 1000);
}

export function tierForLevel(level, difficulties) {
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

export function nowMs() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function smoothedInterval(lastTime, effectiveMs, now, smoothing = 0.7) {
    if (lastTime <= 0) return {lastTime: now, effectiveMs};
    const interval = now - lastTime;
    const nextEffectiveMs = effectiveMs === Infinity
        ? interval
        : effectiveMs * smoothing + interval * (1 - smoothing);
    return {lastTime: now, effectiveMs: nextEffectiveMs};
}

export function formatNumber(number, decimals = 1) {
    const units = [
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

export function formatDuration(ms) {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");

    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDurationPrecise(ms) {
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

export function isMobileViewport() {
    return typeof globalThis.matchMedia === "function" ? globalThis.matchMedia("(width < 48rem)").matches : false;
}

export async function copyTextToClipboard(text) {
    try {
        await globalThis.navigator?.clipboard?.writeText(text);
        return true;
    } catch {
        return false;
    }
}

export function debounce(fn, delayMs = 200) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delayMs);
    };
}

