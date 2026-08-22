"use strict";

import {Piece} from "./piece.js";
import {createPieceSnapshot as createEngineSnapshot} from "../../../engine/snapshot/piece.js";

export type {PieceSnapshot} from "../../../engine/snapshot/piece.js";

export function createPieceSnapshot(piece: Piece | null) {
    return createEngineSnapshot(piece as any);
}

export function restorePieceSnapshot(
    snapshot: import("../../../engine/snapshot/piece.js").PieceSnapshot,
    cols: number,
): Piece {
    const piece = new Piece(snapshot.type as Piece["type"], {cols});
    piece.rotationState = snapshot.rotationState;
    piece.mask = snapshot.mask;
    piece.x = snapshot.x;
    piece.y = snapshot.y;
    return piece;
}
