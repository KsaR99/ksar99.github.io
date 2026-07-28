"use strict";

import {SCORING} from "./config.js";

export function cloneShape(shape) {
    return shape.map((row) => row.slice());
}

export function trimShape(shape) {
    const rows = shape.map((row, r) => (row.some(Boolean) ? r : -1)).filter((r) => r !== -1);
    const cols = shape[0].map((_, c) => (shape.some((row) => row[c]) ? c : -1)).filter((c) => c !== -1);
    return rows.map((r) => cols.map((c) => shape[r][c]));
}

export function withAlpha(color, alpha) {
    return color.replace(/\)$/, ` / ${alpha})`);
}

export function lightenOklch(color, amount = 0.16, maxLightness = 0.82) {
    const match = color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
    if (!match) return color;

    const [, l, c, h] = match;
    const lightened = Math.min(maxLightness, parseFloat(l) + amount);
    const fadedChroma = parseFloat(c) * 0.55;
    return `oklch(${lightened} ${fadedChroma} ${h})`;
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