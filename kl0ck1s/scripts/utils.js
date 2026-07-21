"use strict";

import {SCORING} from "./config.js";

export function cloneShape(shape) {
    return shape.map((row) => row.slice());
}

export function rotateMatrixClockwise(matrix) {
    const rows = matrix.length;
    const cols = matrix[0].length;
    const rotated = Array.from({length: cols}, () => Array(rows).fill(0));

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            rotated[c][rows - 1 - r] = matrix[r][c];
        }
    }

    return rotated;
}

export function escapeHtml(str) {
    const map = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"};
    return String(str).replace(/[&<>"']/g, (ch) => map[ch]);
}

export function withAlpha(hslColor, alpha) {
    return hslColor.replace(/\)$/, ` / ${alpha})`);
}

export function dropIntervalForLevel(level, scoring = SCORING) {
    return Math.max(
        scoring.MIN_DROP_INTERVAL,
        scoring.BASE_DROP_INTERVAL - (level - 1) * scoring.DROP_INTERVAL_STEP
    );
}
