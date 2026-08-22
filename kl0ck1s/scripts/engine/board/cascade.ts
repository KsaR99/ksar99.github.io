import type {BoardLike, CollapseResult} from "./types.js";
import {getFullLineIndices} from "./lines.js";

export function compactColumns(board: BoardLike, dropGrid: Uint8Array | null = null): boolean {
    let moved = false;

    for (let x = 0; x < board.cols; x++) {
        const bit = 1 << x;
        const stackColors: number[] = [];
        const stackFromRows: number[] = [];
        for (let y = 0; y < board.rows; y++) {
            if (board.occupancy[y] & bit) {
                stackColors.push(board.colors[y * board.cols + x]);
                stackFromRows.push(y);
            }
        }

        const startY = board.rows - stackColors.length;
        for (let y = 0; y < board.rows; y++) {
            const idx = y * board.cols + x;
            if (y >= startY) {
                const i = y - startY;
                const color = stackColors[i];
                if (!(board.occupancy[y] & bit) || board.colors[idx] !== color) moved = true;
                board.occupancy[y] |= bit;
                board.colors[idx] = color;
                if (dropGrid) dropGrid[idx] = y - stackFromRows[i];
            } else if (board.occupancy[y] & bit) {
                moved = true;
                board.occupancy[y] &= ~bit;
                board.colors[idx] = 0;
            }
        }
    }

    if (moved) board.version++;
    return moved;
}

export function compactColumnsAbove(board: BoardLike, boundaryRow: number, dropGrid: Uint8Array | null = null): boolean {
    let moved = false;

    for (let x = 0; x < board.cols; x++) {
        const bit = 1 << x;
        const stackColors: number[] = [];
        const stackFromRows: number[] = [];
        for (let y = 0; y <= boundaryRow; y++) {
            if (board.occupancy[y] & bit) {
                stackColors.push(board.colors[y * board.cols + x]);
                stackFromRows.push(y);
            }
        }

        const startY = boundaryRow + 1 - stackColors.length;
        for (let y = 0; y <= boundaryRow; y++) {
            const idx = y * board.cols + x;
            if (y >= startY) {
                const i = y - startY;
                const color = stackColors[i];
                if (!(board.occupancy[y] & bit) || board.colors[idx] !== color) moved = true;
                board.occupancy[y] |= bit;
                board.colors[idx] = color;
                if (dropGrid) dropGrid[idx] = y - stackFromRows[i];
            } else if (board.occupancy[y] & bit) {
                moved = true;
                board.occupancy[y] &= ~bit;
                board.colors[idx] = 0;
            }
        }
    }

    if (moved) board.version++;
    return moved;
}

export function collapseFullLines(board: BoardLike, hardcore: boolean = false): CollapseResult {
    const rows = getFullLineIndices(board);
    if (rows.length === 0) return {cleared: 0, rows, dropGrid: null};

    for (const y of rows) {
        board.occupancy[y] = 0;
        board.colors.fill(0, y * board.cols, (y + 1) * board.cols);
    }

    const dropGrid = new Uint8Array(board.rows * board.cols);
    if (hardcore) {
        const boundaryRow = Math.min(...rows);
        compactColumnsAbove(board, boundaryRow, dropGrid);
    } else {
        compactColumns(board, dropGrid);
    }
    board.version++;
    return {cleared: rows.length, rows, dropGrid};
}
