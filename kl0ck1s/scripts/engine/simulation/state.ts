"use strict";

import type {Piece} from "../piece/piece.js";

export interface ClearCounters {
    1: number;
    2: number;
    3: number;
    4: number;
}

export interface SpinCounters {
    t: number;
    tMini: number;
    other: number;
}

export type SimulationPhase = "idle" | "countdown" | "running" | "grounded" | "clearing" | "paused" | "gameOver";

export class SimulationState<T extends string = string> {
    phase: SimulationPhase = "idle";
    current: Piece<T> | null = null;
    nextQueue: T[] = [];

    dropCounter = 0;
    dropInterval = 0;
    lockDelayTimer = 0;
    lockDelayResets = 0;
    groundedTime = 0;
    isGrounded = false;
    rawGrounded = false;
    hardDropUsed = false;
    lastAction: string | null = null;

    startLevel = 0;
    level = 0;
    score = 0;
    lines = 0;
    elapsedMs = 0;

    drought = 0;
    maxDrought = 0;
    droughtTotal = 0;
    droughtCount = 0;
    burn = 0;
    transitionScore: number | null = null;

    clearCounts: ClearCounters = {1: 0, 2: 0, 3: 0, 4: 0};
    spinCounts: SpinCounters = {t: 0, tMini: 0, other: 0};
    piecesSpawned = 0;

    currentCombo = 0;
    maxCombo = 0;
    cascadeChain = 0;
}
