"use strict";

import type {Board} from "../board/board.js";

export interface BoardSnapshot {
    cols: number;
    rows: number;
    occupancy: number[];
    colors: number[];
}

export function createBoardSnapshot(board: Board): BoardSnapshot {
    return {
        cols: board.cols,
        rows: board.rows,
        occupancy: Array.from(board.occupancy),
        colors: Array.from(board.colors),
    };
}

export function restoreBoardSnapshot(board: Board, snapshot: BoardSnapshot): void {
    if (snapshot.cols !== board.cols || snapshot.rows !== board.rows) {
        throw new Error(`Board snapshot dimensions ${snapshot.cols}x${snapshot.rows} do not match ${board.cols}x${board.rows}`);
    }
    board.occupancy = Uint32Array.from(snapshot.occupancy);
    board.colors = Uint8Array.from(snapshot.colors);
    board.overflowBuffer = [];
    ++board.version;
}
