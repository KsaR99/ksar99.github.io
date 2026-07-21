"use strict";

import {
    BOARD_CONFIG,
    SCORING,
    LEVEL_UP_BANNER_DURATION,
    LINE_CLEAR_ANIMATION_DURATION,
    DIFFICULTIES,
    DEFAULT_DIFFICULTY,
    BOARD_BACKGROUNDS,
    KLOCKOMINOS,
    KLOCKOMINO_TYPES,
    NEXT_PREVIEW_CELL_SIZE,
    SOUND_FILES,
} from "./config.js";
import {calculateCellSize} from "./board-sizing.js";
import {Board} from "./board.js";
import {PieceBag} from "./piece-bag.js";
import {PersistentStore} from "./persistent-store.js";
import {Leaderboard} from "./leaderboard.js";
import {Screens} from "./screens.js";
import {SpriteCache} from "./sprite-cache.js";
import {SoundManager} from "./sound-manager.js";
import {Renderer} from "./renderer.js";
import {HUD} from "./hud.js";
import {Game} from "./game.js";

const boardCanvas = document.getElementById("klockis-board");
const ctx = boardCanvas.getContext("2d");

const nextCanvas = document.getElementById("next-piece-canvas");
const nextCtx = nextCanvas.getContext("2d");
nextCtx.imageSmoothingEnabled = false;

function resizeBoardCanvas() {
    const wrapPadding = 24;
    const wrapBorder = 2;
    const bodyPadding = 32;
    const availableHeight = window.innerHeight - wrapPadding - wrapBorder - bodyPadding;

    BOARD_CONFIG.CELL_SIZE = calculateCellSize({
        availableHeight,
        rows: BOARD_CONFIG.ROWS,
        minCellSize: BOARD_CONFIG.MIN_CELL_SIZE,
        maxCellSize: BOARD_CONFIG.MAX_CELL_SIZE,
    });
    boardCanvas.width = BOARD_CONFIG.CELL_SIZE * BOARD_CONFIG.COLS;
    boardCanvas.height = BOARD_CONFIG.CELL_SIZE * BOARD_CONFIG.ROWS;
    ctx.imageSmoothingEnabled = false;
}

resizeBoardCanvas();

const spriteCache = new SpriteCache(KLOCKOMINOS, () => document.createElement("canvas"));

const renderer = new Renderer({
    ctx,
    boardCanvas,
    nextCtx,
    nextCanvas,
    spriteCache,
    boardConfig: BOARD_CONFIG,
    klockominos: KLOCKOMINOS,
    nextPreviewCellSize: NEXT_PREVIEW_CELL_SIZE,
});

const hud = new HUD({
    scoreEl: document.getElementById("score-value"),
    levelEl: document.getElementById("level-value"),
    linesEl: document.getElementById("lines-value"),
    bestEl: document.getElementById("best-value"),
    overlayEl: document.getElementById("overlay"),
    nextPieceCardEl: document.querySelector('[data-role="next-piece-card"]'),
    statsStatusEl: document.querySelector('[data-role="stats-status"]'),
});

const soundManager = new SoundManager(SOUND_FILES);
const leaderboard = new Leaderboard(new PersistentStore());
const board = new Board(BOARD_CONFIG.COLS, BOARD_CONFIG.ROWS);
const bag = new PieceBag(KLOCKOMINO_TYPES);

const game = new Game({
    board,
    bag,
    renderer,
    hud,
    soundManager,
    leaderboard,
    screens: Screens,
    difficulties: DIFFICULTIES,
    defaultDifficulty: DEFAULT_DIFFICULTY,
    boardBackgrounds: BOARD_BACKGROUNDS,
    scoring: SCORING,
    levelUpBannerDuration: LEVEL_UP_BANNER_DURATION,
    lineClearAnimationDuration: LINE_CLEAR_ANIMATION_DURATION,
});

game.init();

window.addEventListener("resize", () => {
    resizeBoardCanvas();
    game.render();
});
