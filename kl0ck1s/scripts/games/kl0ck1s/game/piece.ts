"use strict";

import {KLOCKOMINOS} from "../shared/config.js";
import {Piece as EnginePiece} from "../../../engine/piece/piece.js";
import {getRotationMask as engineGetRotationMask} from "../../../engine/piece/operations.js";

export type KlockominoType = Extract<keyof typeof KLOCKOMINOS, string>;

export interface PieceOptions {
    cols?: number;
}

export class Piece extends EnginePiece<KlockominoType> {
    constructor(type: KlockominoType, options: PieceOptions = {}) {
        super(type, KLOCKOMINOS, options);
    }

    rotated(dir = 1): number {
        return engineGetRotationMask(KLOCKOMINOS, this.type, this.rotationState + dir);
    }
}
