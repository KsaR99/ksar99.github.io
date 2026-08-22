"use strict";

import type {Board} from "../board/board.js";
import type {Piece} from "../piece/piece.js";
import {Piece as EnginePiece} from "../piece/piece.js";
import type {PieceBag} from "../piece/bag.js";
import {EngineEventBus} from "../events/event-bus.js";
import {getKickTable} from "../piece/kicks.js";
import type {PieceDefinitions} from "../piece/types.js";
import type {GameAction} from "./actions.js";
import {SimulationState} from "./state.js";
import {type BoardSnapshot, createBoardSnapshot, restoreBoardSnapshot} from "../snapshot/board.js";
import {createPieceSnapshot, type PieceSnapshot, restorePieceSnapshot} from "../snapshot/piece.js";

export interface EngineConfig<T extends string> {
    board: Board;
    bag: PieceBag<T>;
    definitions: PieceDefinitions<T>;
    state?: SimulationState<T>;
    lockDelayMs?: number;
    maxLockDelayResets?: number;
}

export interface EngineStepResult {
    locked: boolean;
    lockReady: boolean;
    cleared: number;
    dropped: boolean;
}

export interface EngineMoveToColumnResult {
    moved: boolean;
    x: number;
}

export interface SimulationSnapshot<T extends string = string> {
    board: BoardSnapshot;
    current: PieceSnapshot | null;
    nextQueue: T[];
    phase: SimulationState<T>["phase"];
    dropCounter: number;
    dropInterval: number;
    lockDelayTimer: number;
    lockDelayResets: number;
    groundedTime: number;
    hardDropUsed: boolean;
    score: number;
    lines: number;
    level: number;
    startLevel: number;
    elapsedMs: number;
    drought: number;
    maxDrought: number;
    droughtTotal: number;
    droughtCount: number;
    burn: number;
    transitionScore: number | null;
    clearCounts: SimulationState<T>["clearCounts"];
    spinCounts: SimulationState<T>["spinCounts"];
    piecesSpawned: number;
    currentCombo: number;
    maxCombo: number;
    cascadeChain: number;
}

export class GameEngine<T extends string = string> {
    readonly board: Board;
    readonly bag: PieceBag<T>;
    readonly definitions: PieceDefinitions<T>;
    readonly state: SimulationState<T>;
    readonly events = new EngineEventBus();

    readonly lockDelayMs: number;
    readonly maxLockDelayResets: number;
    maxGroundedTimeMs = Infinity;

    private groundedPiece: Piece<T> | null = null;
    private groundedPieceY = 0;

    constructor(config: EngineConfig<T>) {
        this.board = config.board;
        this.bag = config.bag;
        this.definitions = config.definitions;
        this.state = config.state ?? new SimulationState<T>();
        this.lockDelayMs = config.lockDelayMs ?? 500;
        this.maxLockDelayResets = config.maxLockDelayResets ?? 15;
    }

    reset(): void {
        this.board.reset();
        this.bag.reset();
        const fresh = new SimulationState<T>();
        const startLevel = this.state.startLevel;
        const target = this.state as any;
        for (const key of [
            "phase", "current", "nextQueue", "dropCounter", "dropInterval",
            "lockDelayTimer", "lockDelayResets", "groundedTime", "isGrounded", "rawGrounded",
            "hardDropUsed", "lastAction", "startLevel", "level", "score", "lines", "elapsedMs",
            "drought", "maxDrought", "droughtTotal", "droughtCount", "burn", "transitionScore",
            "clearCounts", "spinCounts", "piecesSpawned", "currentCombo", "maxCombo", "cascadeChain"
        ]) target[key] = (fresh as any)[key];
        target.startLevel = startLevel;
        target.level = startLevel;
        this.groundedPiece = null;
        this.groundedPieceY = 0;
        this.events.emit({type: "roundReset", startLevel});
    }

    spawn(type?: T): Piece<T> | null {
        const next = type ?? this.bag.next();
        if (!next) return null;

        const PieceCtor = requirePiece();
        const piece = new PieceCtor(next, this.definitions, {cols: this.board.cols}) as Piece<T>;
        this.state.current = piece;
        this.groundedPiece = null;
        this.groundedPieceY = piece.y;
        this.state.piecesSpawned++;
        this.state.hardDropUsed = false;
        this.state.lockDelayTimer = 0;
        this.state.lockDelayResets = 0;
        this.state.groundedTime = 0;
        this.state.isGrounded = false;
        this.state.rawGrounded = false;
        this.state.dropCounter = 0;
        this.state.lastAction = null;
        this.events.emit({type: "pieceSpawned", pieceType: String(next), count: this.state.piecesSpawned});

        if (this.board.collides(piece, 0, 0)) {
            this.state.phase = "gameOver";
        }
        return piece;
    }

    move(direction: -1 | 1): boolean {
        const piece = this.state.current;
        if (!piece || this.board.collides(piece, direction, 0)) return false;
        piece.x += direction;
        this.state.lastAction = "move";
        this.events.emit({type: "pieceMoved", pieceType: String(piece.type), x: piece.x, y: piece.y});
        return true;
    }

    moveToColumn(targetColumn: number): EngineMoveToColumnResult {
        const piece = this.state.current;
        if (!piece) return {moved: false, x: -1};

        let minX = piece.width;
        let maxX = 0;
        for (let row = 0; row < piece.height; row++) {
            for (let col = 0; col < piece.width; col++) {
                if ((piece.mask & (1 << (row * piece.width + col))) === 0) continue;
                minX = Math.min(minX, col);
                maxX = Math.max(maxX, col);
            }
        }
        const width = Math.max(1, maxX - minX + 1);
        targetColumn -= Math.floor((width - 1) / 2);
        targetColumn = Math.max(0, Math.min(targetColumn, this.board.cols - width));
        const targetX = targetColumn - minX;
        const oldX = piece.x;

        while (piece.x < targetX && !this.board.collides(piece, 1, 0)) piece.x++;
        while (piece.x > targetX && !this.board.collides(piece, -1, 0)) piece.x--;

        if (piece.x !== oldX) {
            this.state.lastAction = "move";
            this.events.emit({type: "pieceMoved", pieceType: String(piece.type), x: piece.x, y: piece.y});
        }
        return {moved: piece.x !== oldX, x: piece.x};
    }

    rotate(direction: -1 | 1 | 2): boolean {
        if (direction === 2) {
            const piece = this.state.current;
            if (!piece) return false;

            const snapshot = {
                mask: piece.mask,
                rotationState: piece.rotationState,
                x: piece.x,
                y: piece.y,
                lastAction: this.state.lastAction,
            };

            if (this.rotate(1) && this.rotate(1)) return true;

            piece.mask = snapshot.mask;
            piece.rotationState = snapshot.rotationState;
            piece.x = snapshot.x;
            piece.y = snapshot.y;
            this.state.lastAction = snapshot.lastAction;
            return false;
        }
        const piece = this.state.current;
        if (!piece) return false;

        const fromState = piece.rotationState;
        const normalized = direction < 0 ? -1 : 1;
        const toState = (fromState + normalized + 4) % 4;
        const rotatedMask = piece.rotated(normalized);
        const kicks = getKickTable(String(piece.type))[`${fromState}>${toState}`] ?? [[0, 0]];

        const visible = (dx: number, dy: number) => {
            for (let row = 0; row < piece.height; row++) {
                for (let col = 0; col < piece.width; col++) {
                    if ((rotatedMask & (1 << (row * piece.width + col))) === 0) continue;
                    if (piece.y + row + dy >= 0) return true;
                }
            }
            return false;
        };

        let chosen: readonly [number, number] | null = null;
        for (const kick of kicks) {
            const [dx, dy] = kick;
            if (this.board.collides(piece, dx, dy, rotatedMask)) continue;
            if (!visible(dx, dy)) continue;
            chosen = kick;
            break;
        }
        if (!chosen) return false;

        piece.mask = rotatedMask;
        piece.rotationState = toState;
        piece.x += chosen[0];
        piece.y += chosen[1];
        this.state.lastAction = "rotate";
        this.events.emit({type: "pieceRotated", pieceType: String(piece.type), rotationState: toState});
        return true;
    }

    softDrop(): boolean {
        const piece = this.state.current;
        if (!piece || this.board.collides(piece, 0, 1)) return false;
        piece.y++;
        this.state.lastAction = "move";
        this.state.dropCounter = 0;
        return true;
    }

    hardDrop(): number {
        const piece = this.state.current;
        if (!piece) return 0;
        const distance = this.board.getDropOffset(piece);
        piece.y += distance;
        this.state.hardDropUsed = true;
        this.state.lastAction = "move";
        this.state.dropCounter = 0;
        return distance;
    }

    shiftCurrentY(delta: number): boolean {
        const piece = this.state.current;
        if (!piece || !Number.isFinite(delta) || delta === 0) return false;

        piece.y += Math.trunc(delta);
        this.state.lockDelayTimer = 0;
        this.state.groundedTime = 0;
        this.state.isGrounded = false;
        this.state.rawGrounded = false;
        this.state.lastAction = "move";
        this.groundedPiece = null;
        this.groundedPieceY = piece.y;
        this.events.emit({type: "pieceMoved", pieceType: String(piece.type), x: piece.x, y: piece.y});
        return true;
    }

    resetLockDelay(): boolean {
        if (this.state.lockDelayResets >= this.maxLockDelayResets) return false;
        this.state.lockDelayTimer = 0;
        this.state.lockDelayResets++;
        return true;
    }

    updateGrounded(grounded: boolean, deltaMs: number): void {
        this.state.rawGrounded = grounded;
        if (grounded) {
            this.state.groundedTime += deltaMs;
            this.state.isGrounded = true;
            return;
        }

        this.state.isGrounded = false;

        const piece = this.state.current;
        const temporarilyUngroundedByRotation =
            this.groundedPiece === piece && this.state.lastAction === "rotate";
        if (!temporarilyUngroundedByRotation) {
            this.state.groundedTime = 0;
        }
    }

    lock({clearLines = true}: { clearLines?: boolean } = {}): number[] {
        const piece = this.state.current;
        if (!piece) return [];
        this.board.lockPiece(piece);
        this.state.current = null;
        this.state.isGrounded = false;
        this.state.rawGrounded = false;
        this.events.emit({type: "pieceLocked", pieceType: String(piece.type)});
        if (!clearLines) return this.board.getFullLineIndices();
        const cleared = this.board.clearFullLines();
        if (cleared > 0) {
            this.state.lines += cleared;
            this.events.emit({
                type: "lineClear",
                lines: cleared,
                totalLines: this.state.lines,
                score: this.state.score
            });
        }
        return cleared > 0 ? Array.from({length: cleared}, (_, i) => i) : [];
    }

    snapshot(): SimulationSnapshot<T> {
        return {
            board: createBoardSnapshot(this.board),
            current: createPieceSnapshot(this.state.current),
            nextQueue: [...this.state.nextQueue],
            phase: this.state.phase,
            dropCounter: this.state.dropCounter,
            dropInterval: this.state.dropInterval,
            lockDelayTimer: this.state.lockDelayTimer,
            lockDelayResets: this.state.lockDelayResets,
            groundedTime: this.state.groundedTime,
            hardDropUsed: this.state.hardDropUsed,
            score: this.state.score,
            lines: this.state.lines,
            level: this.state.level,
            startLevel: this.state.startLevel,
            elapsedMs: this.state.elapsedMs,
            drought: this.state.drought,
            maxDrought: this.state.maxDrought,
            droughtTotal: this.state.droughtTotal,
            droughtCount: this.state.droughtCount,
            burn: this.state.burn,
            transitionScore: this.state.transitionScore,
            clearCounts: {...this.state.clearCounts},
            spinCounts: {...this.state.spinCounts},
            piecesSpawned: this.state.piecesSpawned,
            currentCombo: this.state.currentCombo,
            maxCombo: this.state.maxCombo,
            cascadeChain: this.state.cascadeChain,
        };
    }

    restore(snapshot: SimulationSnapshot<T>): void {
        restoreBoardSnapshot(this.board, snapshot.board);
        this.state.current = snapshot.current
            ? restorePieceSnapshot(snapshot.current, this.definitions, this.board.cols)
            : null;
        Object.assign(this.state, {
            nextQueue: [...snapshot.nextQueue], phase: snapshot.phase,
            dropCounter: snapshot.dropCounter, dropInterval: snapshot.dropInterval,
            lockDelayTimer: snapshot.lockDelayTimer, lockDelayResets: snapshot.lockDelayResets,
            groundedTime: snapshot.groundedTime, hardDropUsed: snapshot.hardDropUsed,
            score: snapshot.score, lines: snapshot.lines, level: snapshot.level,
            startLevel: snapshot.startLevel, elapsedMs: snapshot.elapsedMs,
            drought: snapshot.drought, maxDrought: snapshot.maxDrought,
            droughtTotal: snapshot.droughtTotal, droughtCount: snapshot.droughtCount,
            burn: snapshot.burn, transitionScore: snapshot.transitionScore,
            clearCounts: {...snapshot.clearCounts}, spinCounts: {...snapshot.spinCounts},
            piecesSpawned: snapshot.piecesSpawned, currentCombo: snapshot.currentCombo,
            maxCombo: snapshot.maxCombo, cascadeChain: snapshot.cascadeChain,
        });
    }

    dispatch(action: GameAction): boolean {
        switch (action.type) {
            case "move":
                return this.move(action.direction);
            case "rotate":
                return this.rotate(action.direction);
            case "softDrop":
                return this.softDrop();
            case "hardDrop":
                this.hardDrop();
                return true;
            case "pause":
                this.state.phase = "paused";
                return true;
            case "resume":
                this.state.phase = "running";
                return true;
            case "restart":
                this.reset();
                return true;
            case "hold":
                return false;
        }
    }

    step(deltaMs: number): EngineStepResult {
        if (this.state.phase !== "running" || !this.state.current) {
            return {locked: false, lockReady: false, cleared: 0, dropped: false};
        }

        this.state.elapsedMs += deltaMs;
        const piece = this.state.current;

        if (this.groundedPiece === piece && !this.state.hardDropUsed && this.state.lastAction !== "rotate") {
            const unexpectedDelta = piece.y - this.groundedPieceY;
            if (unexpectedDelta > 1) {
                piece.y = this.groundedPieceY;
                this.events.emit({type: "pieceMoved", pieceType: String(piece.type), x: piece.x, y: piece.y});
            }
        }

        const resting = this.board.collides(piece, 0, 1);

        if (resting) {
            this.groundedPiece = piece;
            this.groundedPieceY = piece.y;
            this.state.rawGrounded = true;
            this.state.isGrounded = true;
            this.state.dropCounter = 0;
            this.state.lockDelayTimer += deltaMs;
            this.state.groundedTime += deltaMs;
            const lockReady = this.state.lockDelayTimer >= this.lockDelayMs || this.state.groundedTime >= this.maxGroundedTimeMs;
            return {locked: false, lockReady, cleared: 0, dropped: false};
        }

        this.state.rawGrounded = false;
        this.state.isGrounded = false;

        const temporarilyUngroundedByRotation =
            this.groundedPiece === piece && this.state.lastAction === "rotate";

        if (!temporarilyUngroundedByRotation) {
            this.groundedPiece = null;
            this.state.lockDelayTimer = 0;
            this.state.groundedTime = 0;
        }

        this.state.dropCounter += deltaMs;
        let dropped = false;

        while (
            this.state.dropInterval > 0 &&
            this.state.dropCounter >= this.state.dropInterval
        ) {
            if (this.board.collides(piece, 0, 1)) break;
            this.state.dropCounter -= this.state.dropInterval;
            piece.y++;
            this.state.lastAction = "move";
            dropped = true;
            this.events.emit({type: "pieceMoved", pieceType: String(piece.type), x: piece.x, y: piece.y});
        }

        return {locked: false, lockReady: false, cleared: 0, dropped};
    }
}

function requirePiece() {
    return EnginePiece;
}
