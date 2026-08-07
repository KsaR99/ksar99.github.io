"use strict";

import {
    BOARD_CONFIG,
    COLOR_PALETTE,
    DEFAULT_DIFFICULTY,
    DEFAULT_MODE,
    DIFFICULTIES,
    GAME_MODES,
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
import {BootLoader} from "./boot-loader.js";

// Disable right click, for the mouse.
const appEl = document.querySelector(".app");
appEl.addEventListener('contextmenu', event => event.preventDefault());

const boot = new BootLoader({
    rootEl: document.getElementById("boot-screen"),
    fillEl: document.getElementById("boot-bar-fill"),
    statusEl: document.getElementById("boot-status"),
});

const i18n = new I18n();
await i18n.init();
i18n.applyStatic(document);

const bodyEl = document.querySelector('body');
const boardStage = document.querySelector(".board__stage");
const boardDiv = boardStage.parentElement;

/** @type {HTMLCanvasElement} */
const boardCanvas = document.getElementById("klockis-board");
const ctx = boardCanvas.getContext("2d");

/** @type {HTMLCanvasElement} */
const nextCanvas = document.getElementById("next-piece-canvas");
const nextCtx = nextCanvas.getContext("2d");
nextCtx.imageSmoothingEnabled = false;

function getSidebarInlineFootprint() {
    const sidebars = document.querySelectorAll(".app__sidebar");
    let width = 0;
    let count = 0;
    sidebars.forEach((el) => {
        if (getComputedStyle(el).position !== "fixed") {
            width += el.getBoundingClientRect().width;
            ++count;
        }
    });
    return {width, count};
}

function getChrome() {
    const bodyStyle = getComputedStyle(document.body);
    const boardWrapStyle = getComputedStyle(boardDiv.parentElement);
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
    game.themeOverlay.resize(boardCanvas.width, boardCanvas.height);
}

const themeCanvas = document.getElementById("filter-canvas");
const themeCtx = themeCanvas.getContext("2d", {willReadFrequently: true});

const spriteCache = new SpriteCache(KLOCKOMINOS, () => document.createElement("canvas"));
const nextSpriteCache = new SpriteCache(KLOCKOMINOS, () => document.createElement("canvas"));

const renderer = new Renderer({
    bodyEl,
    boardEl: boardStage,
    ctx,
    boardCanvas,
    nextCtx,
    nextCanvas,
    spriteCache,
    nextSpriteCache,
    boardConfig: BOARD_CONFIG,
    klockominos: KLOCKOMINOS,
    colorPalette: COLOR_PALETTE,
    nextPreviewCellSize: NEXT_PREVIEW_CELL_SIZE,
    i18n,
});

const hud = new HUD({
    scoreEl: document.getElementById("score-value"),
    linesEl: document.getElementById("lines-value"),
    linesRowEl: document.querySelector('[data-role="lines-stat"]'),
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
    objectiveEl: document.getElementById("objective-value"),
    objectiveRowEl: document.querySelector('[data-role="objective-stat"]'),
    objectiveBarEl: document.getElementById("objective-bar"),
    objectiveBarTrackEl: document.getElementById("objective-bar-track"),
    settingsShortcutMenuEl: document.querySelector('[data-role="settings-shortcut-menu"]'),
    settingsShortcutGameEl: document.querySelector('[data-role="settings-shortcut-game"]'),
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
    gameModes: GAME_MODES,
    defaultMode: DEFAULT_MODE,
    scoring: SCORING,
    levelUpBannerDuration: LEVEL_UP_BANNER_DURATION_MS,
    lineClearAnimationDuration: LINE_CLEAR_ANIMATION_DURATION_MS,
    settingsStore: store,
    themeCanvas,
    themeCtx,
    i18n,
});

resizeBoardCanvas();

const bootStepText = {
    settings: i18n.t("boot.settings"),
    sprites: i18n.t("boot.sprites"),
    audio: i18n.t("boot.audio"),
    finalize: i18n.t("boot.finalize"),
};

const BOOT_WATCHDOG_MS = 12000;
const bootWatchdog = setTimeout(() => {
    console.warn("Boot sequence took too long, revealing the app anyway.");
    boot.finish();
}, BOOT_WATCHDOG_MS);

game.init({
    onStep: (step) => boot.step(step, bootStepText[step]),
    onAudioProgress: (loaded, total) => boot.audioProgress(loaded, total),
}).then(() => boot.finish()).catch((err) => {
    console.error(err);
    boot.finish();
}).finally(() => clearTimeout(bootWatchdog));

const fabControlsBtn = document.querySelector('[data-role="fab-controls"]');
if (fabControlsBtn) {
    fabControlsBtn.addEventListener("click", () => {
        game.screenFlow.toggleOptions();
    });
}

document.querySelectorAll('[data-role="settings-shortcut-menu"], [data-role="settings-shortcut-game"]').forEach((btn) => {
    btn.addEventListener("click", () => {
        game.screenFlow.toggleOptions();
    });
});

function handleViewportResize() {
    resizeBoardCanvas();
    game.render();
}

(window?.visualViewport || window).addEventListener("resize", handleViewportResize);

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        if (game.state === "running") game.screenFlow.togglePause();
    } else {
        game.soundManager.unlock();
    }
});

["pointerdown", "keydown", "touchstart"].forEach((type) => {
    window.addEventListener(type, () => game.soundManager.unlock(), {passive: true});
});
