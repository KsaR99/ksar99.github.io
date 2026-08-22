// @ts-nocheck
"use strict";

import type {Game} from "./game.js";
import type {KlockominoType} from "./piece.js";
import {type BoardSnapshot, createBoardSnapshot, restoreBoardSnapshot} from "./board-snapshot.js";
import {createPieceSnapshot, type PieceSnapshot, restorePieceSnapshot} from "./piece-snapshot.js";

export const GAME_SNAPSHOT_VERSION = 1;

export interface GameSnapshotCounters {
    clearCounts: { 1: number; 2: number; 3: number; 4: number };
    spinCounts: { t: number; tMini: number; other: number };
}

export interface GameSnapshot extends GameSnapshotCounters {
    version: number;
    board: BoardSnapshot;
    current: PieceSnapshot | null;
    nextQueue: KlockominoType[];
    score: number;
    lines: number;
    level: number;
    startLevel: number;
    currentCombo: number;
    maxCombo: number;
    cascadeChain: number;
    drought: number;
    maxDrought: number;
    droughtTotal: number;
    droughtCount: number;
    burn: number;
    transitionScore: number | null;
    piecesSpawned: number;
    state: string;
    mode: string;
    difficulty: string;
}

export function createGameSnapshot(game: Game): GameSnapshot {
    const state = game.gameState;
    return {
        version: GAME_SNAPSHOT_VERSION,
        board: createBoardSnapshot(game.board),
        current: createPieceSnapshot(state.current),
        nextQueue: [...state.nextQueue],
        score: state.score,
        lines: state.lines,
        level: state.level,
        startLevel: state.startLevel,
        currentCombo: state.currentCombo,
        maxCombo: state.maxCombo,
        cascadeChain: state.cascadeChain,
        drought: state.drought,
        maxDrought: state.maxDrought,
        droughtTotal: state.droughtTotal,
        droughtCount: state.droughtCount,
        burn: state.burn,
        transitionScore: state.transitionScore,
        piecesSpawned: state.piecesSpawned,
        clearCounts: {...state.clearCounts},
        spinCounts: {...state.spinCounts},
        state: state.state,
        mode: state.mode,
        difficulty: state.difficulty,
    };
}

export function restoreGameSnapshot(game: Game, snapshot: GameSnapshot): void {
    if (snapshot.version !== GAME_SNAPSHOT_VERSION) {
        throw new Error(`Unsupported game snapshot version: ${snapshot.version}`);
    }
    restoreBoardSnapshot(game.board, snapshot.board);
    const state = game.gameState;
    state.current = snapshot.current ? restorePieceSnapshot(snapshot.current, game.board.cols) : null;
    state.nextQueue = [...snapshot.nextQueue];
    state.score = snapshot.score;
    state.lines = snapshot.lines;
    state.level = snapshot.level;
    state.startLevel = snapshot.startLevel;
    state.currentCombo = snapshot.currentCombo;
    state.maxCombo = snapshot.maxCombo;
    state.cascadeChain = snapshot.cascadeChain;
    state.drought = snapshot.drought;
    state.maxDrought = snapshot.maxDrought;
    state.droughtTotal = snapshot.droughtTotal;
    state.droughtCount = snapshot.droughtCount;
    state.burn = snapshot.burn;
    state.transitionScore = snapshot.transitionScore;
    state.piecesSpawned = snapshot.piecesSpawned;
    state.clearCounts = {...snapshot.clearCounts};
    state.spinCounts = {...snapshot.spinCounts};
    state.state = snapshot.state;
    state.mode = snapshot.mode;
    state.difficulty = snapshot.difficulty;
}
