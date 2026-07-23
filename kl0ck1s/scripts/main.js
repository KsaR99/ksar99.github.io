"use strict";

import {
    BOARD_BACKGROUNDS,
    BOARD_CONFIG,
    DEFAULT_DIFFICULTY,
    DIFFICULTIES,
    KLOCKOMINO_TYPES,
    KLOCKOMINOS,
    LEVEL_UP_BANNER_DURATION,
    LINE_CLEAR_ANIMATION_DURATION,
    NEXT_PREVIEW_CELL_SIZE,
    SCORING,
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
import {VhsNoise} from "./vhs-noise.js?v=5";
import {Game} from "./game.js";

/** @type {HTMLCanvasElement} */
const boardCanvas = document.getElementById("klockis-board");
const ctx = boardCanvas.getContext("2d");

/** @type {HTMLCanvasElement} */
const nextCanvas = document.getElementById("next-piece-canvas");
const nextCtx = nextCanvas.getContext("2d");
nextCtx.imageSmoothingEnabled = false;

function getVerticalChrome() {
    const board = document.querySelector(".board");
    const bodyStyle = getComputedStyle(document.body);
    const boardStyle = getComputedStyle(board);

    const bodyPadding = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
    const boardBorder = parseFloat(boardStyle.borderTopWidth) + parseFloat(boardStyle.borderBottomWidth);

    return bodyPadding + boardBorder;
}

function resizeBoardCanvas() {
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const availableHeight = viewportHeight - getVerticalChrome();

    BOARD_CONFIG.CELL_SIZE = calculateCellSize({
        availableHeight,
        rows: BOARD_CONFIG.ROWS,
        minCellSize: BOARD_CONFIG.MIN_CELL_SIZE,
        maxCellSize: BOARD_CONFIG.MAX_CELL_SIZE,
    });
    boardCanvas.width = BOARD_CONFIG.CELL_SIZE * BOARD_CONFIG.COLS;
    boardCanvas.height = BOARD_CONFIG.CELL_SIZE * BOARD_CONFIG.ROWS;
    ctx.imageSmoothingEnabled = false;
    vhsNoise.resize(boardCanvas.width, boardCanvas.height);
}

const vhsNoise = new VhsNoise(document.getElementById("vhs-noise-canvas"));

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
const store = new PersistentStore();
const leaderboard = new Leaderboard(store);
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
    settingsStore: store,
    vhsNoise,
});

game.init();

function handleViewportResize() {
    resizeBoardCanvas();
    game.render();
}

window.addEventListener("resize", handleViewportResize);
window.visualViewport?.addEventListener("resize", handleViewportResize);