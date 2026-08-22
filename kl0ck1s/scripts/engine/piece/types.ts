"use strict";

export interface PieceDefinition {
    color: string;
    colorIndex: number;
    width: number;
    height: number;
    states: readonly number[];
}

export type PieceDefinitions<T extends string = string> = Readonly<Record<T, PieceDefinition>>;
