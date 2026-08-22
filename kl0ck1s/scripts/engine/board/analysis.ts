"use strict";

export interface BoardMetrics {
    heights: Uint8Array;
    aggregateHeight: number;
    holes: number;
    bumpiness: number;
}

export function analyzeOccupancy(occupancy: Uint32Array, cols: number, rows: number): BoardMetrics {
    const heights = new Uint8Array(cols);
    let holes = 0;
    for (let c = 0; c < cols; c++) {
        let topSeen = false;
        for (let y = 0; y < rows; y++) {
            const filled = (occupancy[y] & (1 << c)) !== 0;
            if (filled && !topSeen) {
                topSeen = true;
                heights[c] = rows - y;
            } else if (!filled && topSeen) {
                holes++;
            }
        }
    }

    let bumpiness = 0;
    for (let c = 0; c < cols - 1; c++) bumpiness += Math.abs(heights[c] - heights[c + 1]);
    return {
        heights,
        aggregateHeight: heights.reduce((sum, height) => sum + height, 0),
        holes,
        bumpiness,
    };
}

export function getColumnHeights(occupancy: Uint32Array, cols: number, rows: number): Uint8Array {
    return analyzeOccupancy(occupancy, cols, rows).heights;
}
