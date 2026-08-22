"use strict";

import type {PieceDefinitions} from "./types.js";

export interface PieceOptions {
    cols?: number;
}

export class Piece<T extends string = string> {
    readonly type: T;
    readonly color: string;
    readonly colorIndex: number;
    readonly width: number;
    readonly height: number;
    readonly pivotX: number;
    readonly pivotY: number;
    readonly definitions: PieceDefinitions<T>;

    rotationState: number;
    mask: number;
    x: number;
    y: number;

    constructor(
        type: T,
        definitions: PieceDefinitions<T>,
        {cols = 10}: PieceOptions = {},
    ) {
        const def = definitions[type];
        if (!def) throw new Error(`Unknown block type: ${String(type)}`);

        this.type = type;
        this.definitions = definitions;
        this.color = def.color;
        this.colorIndex = def.colorIndex;
        this.width = def.width;
        this.height = def.height;
        this.rotationState = 0;

        if (type === "I") {
            this.pivotX = 1.5;
            this.pivotY = 1.5;
        } else if (type === "O") {
            this.pivotX = 0.5;
            this.pivotY = 0.5;
        } else {
            this.pivotX = 1;
            this.pivotY = 1;
        }

        this.mask = def.states[0];
        this.x = Math.floor((cols - this.width) / 2);
        this.y = 0;
    }

    rotated(direction = 1): number {
        const states = this.definitions[this.type].states;
        const index = ((this.rotationState + direction) % states.length + states.length) % states.length;
        return states[index];
    }
}
