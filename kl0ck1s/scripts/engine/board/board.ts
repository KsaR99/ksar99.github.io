"use strict";

import {
    collides as boardCollides,
    countBlockedCorners as boardCountBlockedCorners,
    getCornerFlags as boardGetCornerFlags,
    getDropOffset as boardGetDropOffset,
    isAboveFloor as boardIsAboveFloor,
    isCellFree as boardIsCellFree,
    isCornerBlocked as boardIsCornerBlocked,
    isInsideCols as boardIsInsideCols,
} from "./collision.js";
import {
    clearFullLines as boardClearFullLines,
    getFullLineIndices as boardGetFullLineIndices,
    getHighestOccupiedRow as boardGetHighestOccupiedRow,
    lockPiece as boardLockPiece,
} from "./lines.js";
import {
    collapseFullLines as boardCollapseFullLines,
    compactColumns as boardCompactColumns,
    compactColumnsAbove as boardCompactColumnsAbove,
} from "./cascade.js";
import {
    addGarbageLines as boardAddGarbageLines,
    emptyRowsFromTop as boardEmptyRowsFromTop,
    shiftDown as boardShiftDown,
    shiftUp as boardShiftUp,
} from "./garbage.js";
import type {Piece} from "../piece/piece.js";
import type {CollapseResult, CornerFlags, OverflowRow} from "./types.js";
import {type BoardSnapshot, createBoardSnapshot, restoreBoardSnapshot} from "../snapshot/board.js";

export type {CornerFlags, CollapseResult} from "./types.js";

export class Board {
    cols!: number;
    rows!: number;
    fullRowMask!: number;
    version!: number;
    occupancy!: Uint32Array;
    colors!: Uint8Array;
    overflowBuffer!: OverflowRow[];
    readonly garbageColorIndex: number;

    constructor(cols: number, rows: number, options: { garbageColorIndex?: number } = {}) {
        this.cols = cols;
        this.rows = rows;
        this.garbageColorIndex = options.garbageColorIndex ?? 1;
        this.fullRowMask = (1 << cols) - 1;
        this.version = 0;
        this.reset();
    }

    reset(): void {
        this.occupancy = new Uint32Array(this.rows);
        this.colors = new Uint8Array(this.rows * this.cols);
        this.overflowBuffer = [];
        ++this.version;
    }

    isInsideCols(x: number): boolean {
        return boardIsInsideCols(this, x);
    }

    isAboveFloor(y: number): boolean {
        return boardIsAboveFloor(this, y);
    }

    isCellFree(x: number, y: number): boolean {
        return boardIsCellFree(this, x, y);
    }

    collides(piece: Piece, offsetX: number, offsetY: number, mask: number = piece.mask): boolean {
        return boardCollides(this, piece, offsetX, offsetY, mask);
    }

    isCornerBlocked(x: number, y: number): boolean {
        return boardIsCornerBlocked(this, x, y);
    }

    getCornerFlags(piece: Piece): CornerFlags {
        return boardGetCornerFlags(this, piece);
    }

    countBlockedCorners(piece: Piece): number {
        return boardCountBlockedCorners(this, piece);
    }

    getDropOffset(piece: Piece): number {
        return boardGetDropOffset(this, piece);
    }

    getFullLineIndices(): number[] {
        return boardGetFullLineIndices(this);
    }

    getHighestOccupiedRow(): number {
        return boardGetHighestOccupiedRow(this);
    }

    lockPiece(piece: Piece): void {
        boardLockPiece(this, piece);
    }

    clearFullLines(): number {
        return boardClearFullLines(this);
    }

    compactColumns(dropGrid: Uint8Array | null = null): boolean {
        return boardCompactColumns(this, dropGrid);
    }

    compactColumnsAbove(boundaryRow: number, dropGrid: Uint8Array | null = null): boolean {
        return boardCompactColumnsAbove(this, boundaryRow, dropGrid);
    }

    collapseFullLines(hardcore: boolean = false): CollapseResult {
        return boardCollapseFullLines(this, hardcore);
    }

    addGarbageLines(count: number): { toppedOut: boolean } {
        return boardAddGarbageLines(this, count, this.garbageColorIndex);
    }

    emptyRowsFromTop(limit: number = this.rows): number {
        return boardEmptyRowsFromTop(this, limit);
    }

    shiftDown(amount: number): number {
        return boardShiftDown(this, amount);
    }

    shiftUp(amount: number): number {
        return boardShiftUp(this, amount);
    }

    createSnapshot(): BoardSnapshot {
        return createBoardSnapshot(this);
    }

    restoreSnapshot(snapshot: BoardSnapshot): void {
        restoreBoardSnapshot(this, snapshot);
    }
}
