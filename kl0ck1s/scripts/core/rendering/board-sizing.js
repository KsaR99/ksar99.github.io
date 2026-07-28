"use strict";

export function calculateCellSize({
                                      availableHeight,
                                      rows,
                                      minCellSize,
                                      maxCellSize = Infinity,
                                  }) {
    const rawSize = Math.floor(availableHeight / rows);
    return Math.min(maxCellSize, Math.max(minCellSize, rawSize));
}
