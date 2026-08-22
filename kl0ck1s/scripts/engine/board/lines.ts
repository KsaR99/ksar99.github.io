import type {Piece} from "../piece/piece.js";
import type {BoardLike} from "./types.js";

function emptyGrid(board: BoardLike) {
    return {
        occupancy: new Uint32Array(board.rows),
        colors: new Uint8Array(board.rows * board.cols),
    };
}

function copyRowColors(board: BoardLike, target: Uint8Array, srcY: number, destY: number): void {
    target.set(board.colors.subarray(srcY * board.cols, (srcY + 1) * board.cols), destY * board.cols);
}

export function getFullLineIndices(board: BoardLike): number[] {
    const indices: number[] = [];
    for (let y = 0; y < board.rows; y++) {
        if (board.occupancy[y] === board.fullRowMask) indices.push(y);
    }
    return indices;
}

export function getHighestOccupiedRow(board: BoardLike): number {
    for (let y = 0; y < board.rows; y++) {
        if (board.occupancy[y] !== 0) return y;
    }
    return board.rows;
}

export function lockPiece(board: BoardLike, piece: Piece): void {
    const {width, height, mask, colorIndex} = piece;

    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (!((mask >> (r * width + c)) & 1)) continue;

            const y = piece.y + r;
            const x = piece.x + c;
            if (y < 0) continue;

            board.occupancy[y] |= (1 << x);
            board.colors[y * board.cols + x] = colorIndex;
        }
    }

    board.version++;
}

export function clearFullLines(board: BoardLike): number {
    const keptRows: number[] = [];
    for (let y = 0; y < board.rows; y++) {
        if (board.occupancy[y] !== board.fullRowMask) keptRows.push(y);
    }

    const cleared = board.rows - keptRows.length;
    if (cleared === 0) return 0;

    const {occupancy: newOccupancy, colors: newColors} = emptyGrid(board);

    let dest = board.rows - 1;
    for (let i = keptRows.length - 1; i >= 0; i--, dest--) {
        const src = keptRows[i];
        newOccupancy[dest] = board.occupancy[src];
        copyRowColors(board, newColors, src, dest);
    }

    board.occupancy = newOccupancy;
    board.colors = newColors;
    board.version++;
    return cleared;
}
