import type {Piece} from "../piece/piece.js";
import type {BoardLike, CornerFlags} from "./types.js";

export function isInsideCols(board: BoardLike, x: number): boolean {
    return x >= 0 && x < board.cols;
}

export function isAboveFloor(board: BoardLike, y: number): boolean {
    return y < board.rows;
}

export function isCellFree(board: BoardLike, x: number, y: number): boolean {
    if (y < 0) return true;
    return (board.occupancy[y] & (1 << x)) === 0;
}

export function collides(board: BoardLike, piece: Piece, offsetX: number, offsetY: number, mask: number = piece.mask): boolean {
    const {width, height} = piece;

    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (!((mask >> (r * width + c)) & 1)) continue;

            const x = piece.x + c + offsetX;
            const y = piece.y + r + offsetY;

            if (!board.isInsideCols(x) || !board.isAboveFloor(y)) return true;
            if (!board.isCellFree(x, y)) return true;
        }
    }
    return false;
}

export function isCornerBlocked(board: BoardLike, x: number, y: number): boolean {
    if (!board.isInsideCols(x)) return true;
    if (!board.isAboveFloor(y)) return true;
    return !board.isCellFree(x, y);
}

export function getCornerFlags(board: BoardLike, piece: Piece): CornerFlags {
    const {width, height} = piece;
    return {
        topLeft: board.isCornerBlocked(piece.x - 1, piece.y - 1),
        topRight: board.isCornerBlocked(piece.x + width, piece.y - 1),
        bottomLeft: board.isCornerBlocked(piece.x - 1, piece.y + height),
        bottomRight: board.isCornerBlocked(piece.x + width, piece.y + height),
    };
}

export function countBlockedCorners(board: BoardLike, piece: Piece): number {
    return Object.values(board.getCornerFlags(piece)).filter(Boolean).length;
}

export function getDropOffset(board: BoardLike, piece: Piece): number {
    let offset = 0;
    while (!board.collides(piece, 0, offset + 1)) {
        ++offset;
    }
    return offset;
}
