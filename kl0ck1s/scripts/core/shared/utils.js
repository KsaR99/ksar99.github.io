"use strict";

import {SCORING} from "./config.js";

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

/** High-resolution timestamp (ms), falling back to Date.now() where performance isn't available. */
export function nowMs() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Exponentially-smoothed elapsed time between successive calls to a
 * once-per-step event (a row drop, a DAS column step). Returns the
 * {lastTime, effectiveMs} pair the caller should store for next time;
 * effectiveMs is Infinity until a second call establishes a real interval.
 */
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
