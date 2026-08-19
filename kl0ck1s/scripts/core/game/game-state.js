"use strict";

import {FALL_TRAIL_MAX_LENGTH} from "./game-constants.js";

export const GAME_STATE_KEYS = [
    "activeTheme",
    "previousStateBeforeOptions",
    "isPlayingSession",
    "multiplayerOptionsOverlayOpen",
    "state",
    "menuSelector",
    "countdownIndex",
    "countdownTimer",
    "playerName",
    "currentIdleList",
    "currentGameOverEntry",
    "pointerClientX",
    "pointerClientY",
    "difficulty",
    "mode",
    "modeState",
    "current",
    "nextQueue",
    "rotationAnim",
    "shiftAnim",
    "dropCounter",
    "dropInterval",
    "lockDelayTimer",
    "lockDelayResets",
    "groundedTime",
    "hardDropUsed",
    "isGrounded",
    "rawGrounded",
    "groundedSoundId",
    "groundedGraceTimer",
    "groundedSoundRate",
    "fallingSoundId",
    "lastAction",
    "pendingSpin",
    "clearingLines",
    "clearingFragments",
    "clearingDropRows",
    "clearingDropGrid",
    "clearingTimer",
    "fallTrail",
    "fallTrailHead",
    "fallTrailCount",
    "_trailPieceRef",
    "hardDropTrail",
    "hardDropImpactFlash",
    "lockImpactFlash",
    "zenShiftAnim",
    "lastRowStepTime",
    "effectiveDropIntervalMs",
    "lastColStepTime",
    "effectiveShiftIntervalMs",
    "startLevel",
    "level",
    "levelTier",
    "levelUpTimer",
    "levelUpLevel",
    "comboBannerTimer",
    "comboBannerCombo",
    "score",
    "lines",
    "elapsedMs",
    "drought",
    "maxDrought",
    "droughtTotal",
    "droughtCount",
    "burn",
    "transitionScore",
    "clearCounts",
    "piecesSpawned",
    "spinCounts",
    "currentCombo",
    "maxCombo",
    "cascadeChain",
    "cascadeFalling",
    "cascadeStepCleared",
    "settings",
    "_hudUpdateAcc",
];

export class GameState {
    constructor({defaultDifficulty, defaultMode} = {}) {
        this.activeTheme = "none";
        this.previousStateBeforeOptions = null;
        this.isPlayingSession = false;
        this.multiplayerOptionsOverlayOpen = false;

        this.state = "idle";
        this.menuSelector = "mode";
        this.countdownIndex = 0;
        this.countdownTimer = 0;
        this.playerName = "";
        this.currentIdleList = null;
        this.currentGameOverEntry = null;
        this.pointerClientX = null;
        this.pointerClientY = null;

        this.difficulty = defaultDifficulty;
        this.mode = defaultMode;
        this.modeState = {garbageTimer: 0};

        this.current = null;
        this.nextQueue = [];
        this.rotationAnim = null;
        this.shiftAnim = null;
        this.dropCounter = 0;
        this.dropInterval = 0;
        this.lockDelayTimer = 0;
        this.lockDelayResets = 0;
        this.groundedTime = 0;
        this.hardDropUsed = false;
        this.isGrounded = false;
        this.rawGrounded = false;
        this.groundedSoundId = null;
        this.groundedGraceTimer = 0;
        this.groundedSoundRate = 1;
        this.fallingSoundId = null;
        this.lastAction = null;
        this.pendingSpin = null;
        this.clearingLines = [];
        this.clearingFragments = [];
        this.clearingDropRows = [];
        this.clearingDropGrid = null;
        this.clearingTimer = 0;

        this.fallTrail = Array.from({length: FALL_TRAIL_MAX_LENGTH}, () => ({
            x: 0, y: 0, mask: null, width: 0, height: 0, color: null,
        }));
        this.fallTrailHead = 0;
        this.fallTrailCount = 0;
        this._trailPieceRef = null;
        this.hardDropTrail = null;
        this.hardDropImpactFlash = null;
        this.lockImpactFlash = null;
        this.zenShiftAnim = null;

        this.lastRowStepTime = 0;
        this.effectiveDropIntervalMs = Infinity;

        this.lastColStepTime = 0;
        this.effectiveShiftIntervalMs = Infinity;

        this.startLevel = 0;
        this.level = 0;
        this.levelTier = null;
        this.levelUpTimer = 0;
        this.levelUpLevel = null;
        this.comboBannerTimer = 0;
        this.comboBannerCombo = null;
        this.score = 0;
        this.lines = 0;
        this.elapsedMs = 0;
        this.drought = 0;
        this.maxDrought = 0;
        this.droughtTotal = 0;
        this.droughtCount = 0;
        this.burn = 0;
        this.transitionScore = null;
        this.clearCounts = {1: 0, 2: 0, 3: 0, 4: 0};
        this.piecesSpawned = 0;
        this.spinCounts = {t: 0, tMini: 0, other: 0};
        this.currentCombo = 0;
        this.maxCombo = 0;
        this.cascadeChain = 0;
        this.cascadeFalling = false;
        this.cascadeStepCleared = 0;

        this.settings = null;
        this._hudUpdateAcc = 0;
    }
}
