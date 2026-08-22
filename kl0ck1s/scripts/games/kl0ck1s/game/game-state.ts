"use strict";

import type {KlockominoType, Piece} from "./piece.js";
import type {KeyBindingMap} from "../shared/key-bindings.js";
import {FALL_TRAIL_MAX_LENGTH} from "./game-constants.js";

export const GAME_STATE_KEYS = [
    "activeTheme", "previousStateBeforeOptions", "isPlayingSession", "multiplayerOptionsOverlayOpen",
    "state", "menuSelector", "menuChoiceFocusActive", "countdownIndex", "countdownTimer", "playerName", "currentIdleList",
    "currentGameOverEntry", "pointerClientX", "pointerClientY", "difficulty", "mode", "modeState",
    "current", "nextQueue", "rotationAnim", "shiftAnim", "dropCounter", "dropInterval", "lockDelayTimer",
    "lockDelayResets", "groundedTime", "hardDropUsed", "isGrounded", "rawGrounded", "groundedSoundId",
    "groundedGraceTimer", "groundedSoundRate", "fallingSoundId", "lastAction", "pendingSpin", "clearingLines",
    "clearingFragments", "clearingDropRows", "clearingDropGrid", "clearingTimer", "fallTrail", "fallTrailHead",
    "fallTrailCount", "_trailPieceRef", "hardDropTrail", "hardDropImpactFlash", "lockImpactFlash", "zenShiftAnim",
    "lastRowStepTime", "effectiveDropIntervalMs", "lastColStepTime", "effectiveShiftIntervalMs", "startLevel", "level",
    "levelTier", "levelUpTimer", "levelUpLevel", "comboBannerTimer", "comboBannerCombo", "score", "lines", "elapsedMs",
    "idleMusicId", "idleMusicWasPlayingBeforeOptions", "drought", "maxDrought", "droughtTotal", "droughtCount", "burn", "transitionScore", "clearCounts", "piecesSpawned",
    "spinCounts", "currentCombo", "maxCombo", "cascadeChain", "cascadeFalling", "cascadeStepCleared", "settings", "_hudUpdateAcc",
] as const;

export interface GameOverEntryState {
    list: unknown[];
    entry: unknown;
    todayBestBeforeThisGame: unknown;
    reason: string;
}

export interface GameSettings {
    volume: number;
    muted: boolean;
    glow: boolean;
    transparency: boolean;
    theme: string;
    hudRight: boolean;
    ghostType: string;
    ghostOpacity: Record<string, number>;
    gridLines: boolean;
    screenShake: boolean;
    heightSaturation: boolean;
    skipCountdown: boolean;
    skipModeInfo: boolean;
    showFirstGameTutorial: boolean;
    mouseControl: boolean;
    mouseSensitivity: number;
    touchSensitivity: number | null;
    keyboardDAS: number;
    keyboardARR: number;
    fallTrail: boolean;
    hardDropFlash: boolean;
    outlineBlocks: boolean;
    categoryVolumes: Record<string, number>;
    categoryMuted: Record<string, boolean>;
    soundVolumes: Record<string, number>;
    soundMuted: Record<string, boolean>;
    keyBindings: KeyBindingMap;

    [key: string]: unknown;
}

export interface ModeState {
    garbageTimer: number;

    [key: string]: unknown;
}

export interface TrailPoint {
    x: number;
    y: number;
    alpha: number;
    mask: number | null;
    width: number;
    height: number;
    color: string | null;
}

export interface ClearingFragment {
    x: number;
    y: number;
    alpha: number;
}

export interface AnimationState {
    [key: string]: unknown;
}

export interface ImpactFlash {
    entry: { x: number; y: number; mask: number; width: number; height: number };
    elapsed: number;
    duration: number;
}

export interface HardDropTrail {
    entries: Array<{ x: number; y: number; mask: number; width: number; height: number; color: string }>;
    elapsed: number;
    duration: number;
}

export class GameState {
    phase: "idle" | "countdown" | "running" | "grounded" | "clearing" | "paused" | "gameOver" = "idle";
    activeTheme: string = "none";
    previousStateBeforeOptions: string | null = null;
    isPlayingSession = false;
    multiplayerOptionsOverlayOpen = false;
    state: "idle" | "countdown" | "running" | "clearing" | "paused" | "options" | "modeInfo" | "gameOver-entry" = "idle";
    menuSelector = "entry";
    menuChoiceFocusActive = false;
    countdownIndex = 0;
    countdownTimer = 0;
    playerName = "";
    currentIdleList: unknown[] | null = null;
    currentGameOverEntry: GameOverEntryState | null = null;
    pointerClientX: number | null = null;
    pointerClientY: number | null = null;
    difficulty: string;
    mode: string;
    modeState: ModeState = {garbageTimer: 0};
    current: Piece | null = null;
    nextQueue: KlockominoType[] = [];
    rotationAnim: AnimationState | null = null;
    shiftAnim: AnimationState | null = null;
    dropCounter = 0;
    dropInterval = 0;
    lockDelayTimer = 0;
    lockDelayResets = 0;
    groundedTime = 0;
    hardDropUsed = false;
    isGrounded = false;
    rawGrounded = false;
    groundedSoundId: string | null = null;
    groundedGraceTimer = 0;
    groundedSoundRate = 1;
    fallingSoundId: string | null = null;
    lastAction: string | null = null;
    pendingSpin: string | null = null;
    clearingLines: number[] = [];
    clearingFragments: ClearingFragment[] = [];
    clearingDropRows = new Uint8Array(0);
    clearingDropGrid: Uint8Array | null = null;
    clearingTimer = 0;
    fallTrail: TrailPoint[] = Array.from({length: FALL_TRAIL_MAX_LENGTH}, () => ({
        x: 0,
        y: 0,
        alpha: 0,
        mask: null,
        width: 0,
        height: 0,
        color: null
    }));
    fallTrailHead = 0;
    fallTrailCount = 0;
    _trailPieceRef: Piece | null = null;
    hardDropTrail: HardDropTrail | null = null;
    hardDropImpactFlash: ImpactFlash | null = null;
    lockImpactFlash: ImpactFlash | null = null;
    zenShiftAnim: AnimationState | null = null;
    lastRowStepTime = 0;
    effectiveDropIntervalMs = Infinity;
    lastColStepTime = 0;
    effectiveShiftIntervalMs = Infinity;
    startLevel = 0;
    level = 0;
    levelTier: string | null = null;
    levelUpTimer = 0;
    levelUpLevel: number | null = null;
    comboBannerTimer = 0;
    comboBannerCombo: number | null = null;
    score = 0;
    lines = 0;
    elapsedMs = 0;
    idleMusicId: string | null = null;
    idleMusicWasPlayingBeforeOptions = false;
    drought = 0;
    maxDrought = 0;
    droughtTotal = 0;
    droughtCount = 0;
    burn = 0;
    transitionScore: number | null = null;
    clearCounts = {1: 0, 2: 0, 3: 0, 4: 0};
    piecesSpawned = 0;
    spinCounts = {t: 0, tMini: 0, other: 0};
    currentCombo = 0;
    maxCombo = 0;
    cascadeChain = 0;
    cascadeFalling = false;
    cascadeStepCleared = 0;
    settings: GameSettings | null = null;
    _hudUpdateAcc = 0;

    constructor({defaultDifficulty, defaultMode}: { defaultDifficulty?: string; defaultMode?: string } = {}) {
        this.difficulty = defaultDifficulty ?? "medium";
        this.mode = defaultMode ?? "zen";
    }
}
