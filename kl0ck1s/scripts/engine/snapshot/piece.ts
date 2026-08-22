"use strict";

import type {Piece} from "../piece/piece.js";
import {Piece as EnginePiece} from "../piece/piece.js";
import type {PieceDefinitions} from "../piece/types.js";

export interface PieceSnapshot {
    type: string;
    color: string;
    colorIndex: number;
    width: number;
    height: number;
    rotationState: number;
    pivotX: number;
    pivotY: number;
    mask: number;
    x: number;
    y: number;
}

export function createPieceSnapshot(piece: Piece | null): PieceSnapshot | null {
    if (!piece) return null;
    return {
        type: piece.type,
        color: piece.color,
        colorIndex: piece.colorIndex,
        width: piece.width,
        height: piece.height,
        rotationState: piece.rotationState,
        pivotX: piece.pivotX,
        pivotY: piece.pivotY,
        mask: piece.mask,
        x: piece.x,
        y: piece.y,
    };
}

export function restorePieceSnapshot<T extends string>(
    snapshot: PieceSnapshot,
    definitions: PieceDefinitions<T>,
    cols: number,
): Piece<T> {
    const piece = new (requirePiece())(snapshot.type as T, definitions, {cols}) as Piece<T>;
    piece.rotationState = snapshot.rotationState;
    piece.mask = snapshot.mask;
    piece.x = snapshot.x;
    piece.y = snapshot.y;
    return piece;
}

function requirePiece() {
    return EnginePiece;
}
