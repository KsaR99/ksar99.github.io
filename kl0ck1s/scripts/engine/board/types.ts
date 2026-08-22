import type {Piece} from "../piece/piece.js";

export interface CornerFlags {
    topLeft: boolean;
    topRight: boolean;
    bottomLeft: boolean;
    bottomRight: boolean;
}

export interface CollapseResult {
    cleared: number;
    rows: number[];
    dropGrid: Uint8Array | null;
}

export interface OverflowRow {
    occ: number;
    colors: Uint8Array;
}

export interface BoardLike {
    cols: number;
    rows: number;
    fullRowMask: number;
    version: number;
    occupancy: Uint32Array;
    colors: Uint8Array;
    overflowBuffer: OverflowRow[];

    isInsideCols(x: number): boolean;

    isAboveFloor(y: number): boolean;

    isCellFree(x: number, y: number): boolean;

    isCornerBlocked(x: number, y: number): boolean;

    getCornerFlags(piece: Piece): CornerFlags;

    collides(piece: Piece, offsetX: number, offsetY: number, mask?: number): boolean;

    getFullLineIndices(): number[];

    compactColumns(dropGrid?: Uint8Array | null): boolean;

    compactColumnsAbove(boundaryRow: number, dropGrid?: Uint8Array | null): boolean;

    emptyRowsFromTop(limit?: number): number;
}
