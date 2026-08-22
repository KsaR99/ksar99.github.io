// @ts-nocheck
"use strict";

export function calculateCellSize({
                                      availableHeight,
                                      availableWidth,
                                      rows,
                                      cols,
                                      minCellSize,
                                      maxCellSize = Infinity,
                                  }) {
    const byHeight = Math.floor(availableHeight / rows);
    const byWidth = (availableWidth != null && cols)
        ? Math.floor(availableWidth / cols)
        : Infinity;
    const rawSize = Math.min(byHeight, byWidth);
    return Math.min(maxCellSize, Math.max(minCellSize, rawSize));
}
