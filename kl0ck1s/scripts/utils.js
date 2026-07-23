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

export function dropIntervalForLevel(level, scoring = SCORING) {
    return Math.max(
        scoring.MIN_DROP_INTERVAL,
        scoring.BASE_DROP_INTERVAL - (level - 1) * scoring.DROP_INTERVAL_STEP
    );
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