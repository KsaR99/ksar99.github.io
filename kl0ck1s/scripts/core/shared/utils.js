"use strict";

import {SCORING, VOICE_COUNTING_NUMBERS, voiceCountingKey} from "./config.js";

/**
 * Splits a number into the counting-voice numbers needed to say it aloud,
 * e.g. 3 -> [3], 20 -> [20], 21 -> [20, 1], 100 -> [100].
 * Only covers what the counting voice pack has (1-19, tens up to 90, 100).
 */
export function numberToCountingParts(number) {
    if (!Number.isInteger(number) || number <= 0) return [];
    if (VOICE_COUNTING_NUMBERS.includes(number)) return [number];
    if (number > 0 && number < 100) {
        const tens = Math.floor(number / 10) * 10;
        const ones = number % 10;
        if (VOICE_COUNTING_NUMBERS.includes(tens) && VOICE_COUNTING_NUMBERS.includes(ones)) {
            return [tens, ones];
        }
    }
    return [];
}

/** Voice-sound keys (in SOUND_FILES) needed to say a number aloud. */
export function numberToVoiceKeys(number) {
    return numberToCountingParts(number).map(voiceCountingKey);
}

/** Iterates filled cells of a packed shape mask, calling cb(row, col) for each. */
export function forEachShapeCell(mask, width, height, cb) {
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if ((mask >> (r * width + c)) & 1) cb(r, c);
        }
    }
}

/** Tight bounding box of the actually-filled cells within a shape's bounding box. */
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
    return Math.max(
        scoring.MIN_DROP_INTERVAL,
        scoring.BASE_DROP_INTERVAL - (level - 1) * scoring.DROP_INTERVAL_STEP
    );
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

/** Formats a duration in milliseconds as "MM:SS" (or "H:MM:SS" past an hour). */
export function formatDuration(ms) {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");

    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Same as formatDuration() but keeps two extra digits of sub-second
 * precision ("MM:SS.CC", or "H:MM:SS.CC" past an hour) - used wherever a
 * result is actually timed against the clock (Sprint/Cheese Race finishes,
 * their leaderboard entries and best-time display), where whole seconds
 * alone aren't enough to tell two close runs apart.
 */
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
