import type {BoardLike} from "./types.js";

export const DEFAULT_GARBAGE_COLOR_INDEX = 1;

function emptyGrid(board: BoardLike) {
    return {
        occupancy: new Uint32Array(board.rows),
        colors: new Uint8Array(board.rows * board.cols),
    };
}

function copyRowColors(board: BoardLike, target: Uint8Array, srcY: number, destY: number): void {
    target.set(board.colors.subarray(srcY * board.cols, (srcY + 1) * board.cols), destY * board.cols);
}

export function addGarbageLines(board: BoardLike, count: number, garbageColorIndex: number = DEFAULT_GARBAGE_COLOR_INDEX): {
    toppedOut: boolean
} {
    if (count <= 0) return {toppedOut: false};

    let toppedOut = false;
    for (let y = 0; y < Math.min(count, board.rows); y++) {
        if (board.occupancy[y] !== 0) toppedOut = true;
    }

    const {occupancy: newOccupancy, colors: newColors} = emptyGrid(board);

    for (let y = count; y < board.rows; y++) {
        newOccupancy[y - count] = board.occupancy[y];
        copyRowColors(board, newColors, y, y - count);
    }

    const gapCol = Math.floor(Math.random() * board.cols);
    for (let i = 0; i < Math.min(count, board.rows); i++) {
        const y = board.rows - count + i;
        let rowMask = 0;
        for (let x = 0; x < board.cols; x++) {
            if (x === gapCol) continue;
            rowMask |= (1 << x);
            newColors[y * board.cols + x] = garbageColorIndex;
        }
        newOccupancy[y] = rowMask;
    }

    board.occupancy = newOccupancy;
    board.colors = newColors;
    ++board.version;
    return {toppedOut};
}

export function emptyRowsFromTop(board: BoardLike, limit: number = board.rows): number {
    let count = 0;
    for (let y = 0; y < board.rows && count < limit; y++) {
        if (board.occupancy[y] !== 0) break;
        count++;
    }
    return count;
}

export function shiftDown(board: BoardLike, amount: number): number {
    if (amount <= 0) return 0;
    const shift = Math.min(amount, board.rows);
    if (shift <= 0) return 0;

    const hiddenRows: Array<{ occ: number; colors: Uint8Array }> = [];
    for (let y = board.rows - shift; y < board.rows; y++) {
        hiddenRows.push({
            occ: board.occupancy[y],
            colors: board.colors.slice(y * board.cols, (y + 1) * board.cols),
        });
    }
    board.overflowBuffer.unshift(...hiddenRows);

    const {occupancy: newOccupancy, colors: newColors} = emptyGrid(board);
    for (let y = 0; y < board.rows - shift; y++) {
        newOccupancy[y + shift] = board.occupancy[y];
        copyRowColors(board, newColors, y, y + shift);
    }

    board.occupancy = newOccupancy;
    board.colors = newColors;
    ++board.version;
    return shift;
}

export function shiftUp(board: BoardLike, amount: number): number {
    if (amount <= 0) return 0;
    const shift = Math.min(amount, board.rows, emptyRowsFromTop(board, amount), board.overflowBuffer.length);
    if (shift <= 0) return 0;

    const {occupancy: newOccupancy, colors: newColors} = emptyGrid(board);
    for (let y = shift; y < board.rows; y++) {
        newOccupancy[y - shift] = board.occupancy[y];
        copyRowColors(board, newColors, y, y - shift);
    }

    const restoredRows = board.overflowBuffer.splice(0, shift);
    for (let i = 0; i < shift; i++) {
        const y = board.rows - shift + i;
        newOccupancy[y] = restoredRows[i].occ;
        newColors.set(restoredRows[i].colors, y * board.cols);
    }

    board.occupancy = newOccupancy;
    board.colors = newColors;
    ++board.version;
    return shift;
}
