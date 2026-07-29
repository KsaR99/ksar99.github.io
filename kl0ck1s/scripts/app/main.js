"use strict";

import {
    BOARD_BACKGROUNDS,
    BOARD_CONFIG,
    COLOR_PALETTE,
    DEFAULT_DIFFICULTY,
    DIFFICULTIES,
    KLOCKOMINO_TYPES,
    KLOCKOMINOS,
    LEVEL_UP_BANNER_DURATION_MS,
    LINE_CLEAR_ANIMATION_DURATION_MS,
    NEXT_PREVIEW_CELL_SIZE,
    SCORING,
    SOUND_FILES,
} from "../core/shared/config.js";

import {calculateCellSize} from "../core/rendering/board-sizing.js";
import {Board} from "../core/game/board.js";
import {PieceBag} from "../core/game/piece-bag.js";
import {PersistentStore} from "../core/services/persistent-store.js";
import {Leaderboard} from "../core/ui/leaderboard.js";
import {Screens} from "../core/ui/screens.js";
import {SpriteCache} from "../core/rendering/sprite-cache.js";
import {SoundManager} from "../core/services/sound-manager.js";
import {Renderer} from "../core/rendering/renderer.js";
import {HUD} from "../core/ui/hud.js";
import {Game} from "../core/game/game.js";
import {I18n} from "../core/services/i18n.js";

// Disable right click, for the mouse.
const appEl = document.querySelector(".app");
appEl.addEventListener('contextmenu', event => event.preventDefault());

const i18n = new I18n();
await i18n.init();
i18n.applyStatic(document);

const boardDiv = document.querySelector(".board");

/** @type {HTMLCanvasElement} */
const boardCanvas = document.getElementById("klockis-board");
const ctx = boardCanvas.getContext("2d");

/** @type {HTMLCanvasElement} */
const nextCanvas = document.getElementById("next-piece-canvas");
const nextCtx = nextCanvas.getContext("2d");
nextCtx.imageSmoothingEnabled = false;

function getSidebarInlineFootprint() {
    // Sidebars only eat into the board's available width when they're
    // laid out in normal flow (desktop's 3-column row). On mobile
    // they're position:fixed off-canvas drawers, so they take zero
    // width away from the board — checking computed position (instead
    // of hardcoding a breakpoint) keeps this correct even if the
    // mobile/desktop cutoff in main.css ever changes.
    const sidebars = document.querySelectorAll(".app__sidebar");
    let width = 0;
    let count = 0;
    sidebars.forEach((el) => {
        if (getComputedStyle(el).position !== "fixed") {
            width += el.getBoundingClientRect().width;
            count += 1;
        }
    });
    return {width, count};
}

function getChrome() {
    const bodyStyle = getComputedStyle(document.body);
    const boardWrapStyle = getComputedStyle(boardDiv.parentElement); // .app__board
    const boardStyle = getComputedStyle(boardDiv);
    const appStyle = getComputedStyle(appEl);

    const verticalChrome =
        parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom) +
        parseFloat(boardWrapStyle.paddingTop) + parseFloat(boardWrapStyle.paddingBottom) +
        parseFloat(boardStyle.borderTopWidth) + parseFloat(boardStyle.borderBottomWidth);

    const {width: sidebarsWidth, count: inFlowSidebars} = getSidebarInlineFootprint();
    const rowGap = parseFloat(appStyle.columnGap) || 0;

    const horizontalChrome =
        parseFloat(bodyStyle.paddingLeft) + parseFloat(bodyStyle.paddingRight) +
        parseFloat(boardWrapStyle.paddingLeft) + parseFloat(boardWrapStyle.paddingRight) +
        parseFloat(boardStyle.borderLeftWidth) + parseFloat(boardStyle.borderRightWidth) +
        sidebarsWidth + rowGap * inFlowSidebars;

    return {verticalChrome, horizontalChrome};
}

function resizeBoardCanvas() {
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const {verticalChrome, horizontalChrome} = getChrome();
    const availableHeight = viewportHeight - verticalChrome;
    const availableWidth = viewportWidth - horizontalChrome;

    BOARD_CONFIG.CELL_SIZE = calculateCellSize({
        availableHeight,
        availableWidth,
        rows: BOARD_CONFIG.ROWS,
        cols: BOARD_CONFIG.COLS,
        minCellSize: BOARD_CONFIG.MIN_CELL_SIZE,
        maxCellSize: BOARD_CONFIG.MAX_CELL_SIZE,
    });
    boardCanvas.width = BOARD_CONFIG.CELL_SIZE * BOARD_CONFIG.COLS;
    boardCanvas.height = BOARD_CONFIG.CELL_SIZE * BOARD_CONFIG.ROWS;
    ctx.imageSmoothingEnabled = false;
    game.effectOverlay.resize(boardCanvas.width, boardCanvas.height);
}

const effectCanvas = document.getElementById("filter-canvas");
const effectCtx = effectCanvas.getContext("2d", {colorSpace: "display-p3", willReadFrequently: true});

const spriteCache = new SpriteCache(KLOCKOMINOS, () => document.createElement("canvas"));

const renderer = new Renderer({
    boardDiv,
    ctx,
    boardCanvas,
    nextCtx,
    nextCanvas,
    spriteCache,
    boardConfig: BOARD_CONFIG,
    klockominos: KLOCKOMINOS,
    colorPalette: COLOR_PALETTE,
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
    effectCanvas,
    effectCtx,
    i18n,
});

resizeBoardCanvas();
void game.init().catch(console.error);

function handleViewportResize() {
    resizeBoardCanvas();
    game.render();
}

(window?.visualViewport || window).addEventListener("resize", handleViewportResize);
