"use strict";

import type {Piece} from "./piece.js";
import type {PieceDefinitions} from "./types.js";

export interface PieceCell {
    x: number;
    y: number;
}

export interface PieceTransform {
    x: number;
    y: number;
    rotationState: number;
    mask: number;
}

export function getPieceCells(
    piece: Pick<Piece, "x" | "y" | "width" | "height" | "mask">,
    mask = piece.mask,
): PieceCell[] {
    const cells: PieceCell[] = [];
    for (let row = 0; row < piece.height; row++) {
        for (let col = 0; col < piece.width; col++) {
            if ((mask & (1 << (row * piece.width + col))) === 0) continue;
            cells.push({x: piece.x + col, y: piece.y + row});
        }
    }
    return cells;
}

export function getRotationMask<T extends string>(
    definitions: PieceDefinitions<T>,
    type: T,
    rotationState: number,
): number {
    const states = definitions[type].states;
    return states[((rotationState % states.length) + states.length) % states.length];
}

export function getRotatedTransform<T extends string>(
    piece: Pick<Piece<T>, "type" | "x" | "y" | "rotationState">,
    definitions: PieceDefinitions<T>,
    direction = 1,
): PieceTransform {
    const states = definitions[piece.type].states;
    const rotationState = ((piece.rotationState + direction) % states.length + states.length) % states.length;
    return {
        x: piece.x,
        y: piece.y,
        rotationState,
        mask: states[rotationState],
    };
}

export function getSpawnX<T extends string>(
    definitions: PieceDefinitions<T>,
    type: T,
    cols: number,
): number {
    return Math.floor((cols - definitions[type].width) / 2);
}
