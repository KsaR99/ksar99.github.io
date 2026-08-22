"use strict";

import {KLOCKOMINOS} from "../shared/config.js";
import {
    getPieceCells,
    getRotatedTransform as engineGetRotatedTransform,
    getRotationMask as engineGetRotationMask,
    getSpawnX as engineGetSpawnX
} from "../../../engine/piece/operations.js";
import type {Piece} from "./piece.js";

export {getPieceCells};
export type {PieceCell, PieceTransform} from "../../../engine/piece/operations.js";

export function getRotationMask(type: import("./piece.js").KlockominoType, rotationState: number): number {
    return engineGetRotationMask(KLOCKOMINOS, type, rotationState);
}

export function getRotatedTransform(piece: Pick<Piece, "type" | "x" | "y" | "rotationState">, direction = 1) {
    return engineGetRotatedTransform(piece as any, KLOCKOMINOS, direction);
}

export function getSpawnX(type: import("./piece.js").KlockominoType, cols: number): number {
    return engineGetSpawnX(KLOCKOMINOS, type, cols);
}
