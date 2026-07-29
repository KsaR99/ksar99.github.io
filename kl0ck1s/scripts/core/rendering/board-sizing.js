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
    // availableWidth/cols are optional so existing callers keep working
    // unchanged; without them the board is sized by height alone, same
    // as before.
    const byWidth = (availableWidth != null && cols)
        ? Math.floor(availableWidth / cols)
        : Infinity;
    const rawSize = Math.min(byHeight, byWidth);
    return Math.min(maxCellSize, Math.max(minCellSize, rawSize));
}
