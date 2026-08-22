export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue } | Uint8Array;

export interface MultiplayerPayload {
    kind?: string;
    score?: number;
    lines?: number | number[];
    tetrisRatePercent?: number;
    pps?: number;
    efficiency?: number;
    maxCombo?: number;
    burn?: number;
    maxDrought?: number;
    droughtTotal?: number;
    droughtAvg?: number;
    drought?: number;
    objective?: number | null;
    objectiveLabelKey?: string;
    objectivePercent?: number | null;
    objectiveColorMode?: string;
    objectiveUrgency?: string;
    hasLevelProgress?: boolean;
    difficultyTier?: string;
    difficultyLevel?: number;
    difficultyPercent?: number;
    mode?: string;
    difficulty?: string;
    name?: string;
    theme?: string;
    blockType?: string;
    ghostType?: string;
    pieceType?: string;
    ghostY?: number;
    cells?: Uint8Array;
    entries?: JsonValue[];
    duration?: number;
    flashEntry?: JsonValue;
    flashDuration?: number;
    cleared?: boolean;
    x?: number;
    y?: number;
    rotation?: number;
    mask?: number;
    width?: number;
    height?: number;
    colorIndex?: number;
    pieceIndex?: number;
    pivotX?: number;
    pivotY?: number;
    linesCleared?: number[];
    dropRows?: number[];

    [key: string]: JsonValue | undefined;
}

export interface MultiplayerJoinRequest {
    requestId: string;
    hostName?: string;

    [key: string]: JsonValue | undefined;
}
