"use strict";

import {
    BOARD_BACKGROUNDS,
    BOARD_CONFIG,
    DEFAULT_DIFFICULTY,
    DIFFICULTIES,
    KLOCKOMINO_TYPES,
    KLOCKOMINOS,
    LEVEL_UP_BANNER_DURATION_MS,
    LINE_CLEAR_ANIMATION_DURATION_MS,
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
import {VhsNoise} from "./vhs-noise.js";
import {MatrixRain} from "./matrix-rain.js";
import {Rain} from "./rain.js";
import {Snow} from "./snow.js";
import {Game} from "./game.js";
import {I18n} from "./i18n.js";

const i18n = new I18n();
await i18n.init();
i18n.applyStatic(document);

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
    matrixRain.resize(boardCanvas.width, boardCanvas.height);
    rain.resize(boardCanvas.width, boardCanvas.height);
    snow.resize(boardCanvas.width, boardCanvas.height);
}

const effectCanvas = document.getElementById("filter-canvas");
const effectCtx = effectCanvas.getContext("2d", {colorSpace: "display-p3", willReadFrequently: true});
const vhsNoise = new VhsNoise(effectCanvas, effectCtx);
const matrixRain = new MatrixRain(effectCanvas, effectCtx);
const rain = new Rain(effectCanvas, effectCtx);
const snow = new Snow(effectCanvas, effectCtx);

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
    i18n,
});

const hud = new HUD({
    scoreEl: document.getElementById("score-value"),
    linesEl: document.getElementById("lines-value"),
    bestEl: document.getElementById("best-value"),
    overlayEl: document.getElementById("overlay"),
    nextPieceCardEl: document.querySelector('[data-role="next-piece-card"]'),
    statsStatusEl: document.querySelector('[data-role="stats-status"]'),
    difficultyEl: document.getElementById("difficulty-value"),
    difficultyBarEl: document.getElementById("difficulty-bar"),
    statsCardEl: document.querySelector('[data-role="stats-card"]'),
    i18n,
    timeEl: document.getElementById("time-value"),
    droughtEl: document.getElementById("drought-value"),
    tetrisRateEl: document.getElementById("trt-value"),
    ppsEl: document.getElementById("pps-value"),
});

const soundManager = new SoundManager(SOUND_FILES);
const store = new PersistentStore();
const leaderboard = new Leaderboard(store, document, i18n);
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
    levelUpBannerDuration: LEVEL_UP_BANNER_DURATION_MS,
    lineClearAnimationDuration: LINE_CLEAR_ANIMATION_DURATION_MS,
    settingsStore: store,
    vhsNoise,
    matrixRain,
    rain,
    snow,
    i18n,
});

void game.init().catch(console.error);

function handleViewportResize() {
    resizeBoardCanvas();
    game.render();
}

(window?.visualViewport || window).addEventListener("resize", handleViewportResize);