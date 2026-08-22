"use strict";

export type EngineEvent =
    | { type: "scoreChanged"; points: number; total: number }
    | { type: "pieceSpawned"; pieceType: string; count: number }
    | { type: "pieceMoved"; pieceType: string; x: number; y: number }
    | { type: "pieceRotated"; pieceType: string; rotationState: number }
    | { type: "pieceLocked"; pieceType: string }
    | { type: "lineClear"; lines: number; totalLines: number; score: number }
    | { type: "spin"; pieceType: string; cleared: number; mini: boolean; points: number }
    | { type: "levelUp"; level: number; previousLevel: number; score: number }
    | { type: "garbageAdded"; count: number }
    | { type: "roundReset"; startLevel: number };

export type EngineEventType = EngineEvent["type"];
export type EngineEventOf<T extends EngineEventType> = Extract<EngineEvent, { type: T }>;
export type EngineEventListener<T extends EngineEventType> = (event: EngineEventOf<T>) => void;

export class EngineEventBus {
    private readonly listeners = new Map<EngineEventType, Set<EngineEventListener<EngineEventType>>>();

    on<T extends EngineEventType>(type: T, listener: EngineEventListener<T>): () => void {
        let listeners = this.listeners.get(type) as Set<EngineEventListener<T>> | undefined;
        if (!listeners) {
            listeners = new Set();
            this.listeners.set(type, listeners as unknown as Set<EngineEventListener<EngineEventType>>);
        }
        listeners.add(listener);
        return () => this.off(type, listener);
    }

    off<T extends EngineEventType>(type: T, listener: EngineEventListener<T>): void {
        const listeners = this.listeners.get(type) as Set<EngineEventListener<T>> | undefined;
        listeners?.delete(listener);
        if (listeners?.size === 0) this.listeners.delete(type);
    }

    emit<T extends EngineEventType>(event: EngineEventOf<T>): void {
        const listeners = this.listeners.get(event.type) as Set<EngineEventListener<T>> | undefined;
        if (!listeners) return;
        for (const listener of [...listeners]) listener(event);
    }

    clear(): void {
        this.listeners.clear();
    }
}
