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
import {MultiplayerController} from "../core/controllers/multiplayer-controller.js";
import {BootLoader} from "./boot-loader.js";

const bodyEl = document.querySelector('body');

// Disable right click, for the mouse.
const appEl = bodyEl.querySelector(".app");
appEl.addEventListener('contextmenu', event => event.preventDefault());

const bootScreenEl = document.getElementById("boot-screen");
const boot = new BootLoader({
    rootEl: bootScreenEl,
    fillEl: bootScreenEl.querySelector("#boot-bar-fill"),
    statusEl: bootScreenEl.querySelector("#boot-status"),
});

const i18n = new I18n();
const partials = Promise.all(
    ["options", "menu", "gameover", "leaderboard", "multiplayer"].map((name) =>
        fetch(`partials/${name}.html`).then((response) => response.text())
    )
);
await i18n.init();
(await partials).forEach((html) => bodyEl.insertAdjacentHTML("beforeend", html));
i18n.applyStatic(bodyEl);


const boardStage = bodyEl.querySelector(".board__stage");
const boardDiv = boardStage.parentElement;
const sidebarStatsEl = bodyEl.querySelector(".sidebar--stats");
const statsCardEl = sidebarStatsEl.querySelector('[data-role="stats-card"]');
const statusCardEl = sidebarStatsEl.querySelector('[data-role="status-card"]');
const nextPieceCardEl = sidebarStatsEl.querySelector('[data-role="next-piece-card"]');

/** @type {HTMLCanvasElement} */
const boardCanvas = boardStage.querySelector("#klockis-board");
const ctx = boardCanvas.getContext("2d");

/** @type {Array<HTMLCanvasElement>} */
const nextCanvases = Array.from(nextPieceCardEl.querySelectorAll(".next-piece__canvas"));
const nextCtxs = nextCanvases.map((canvas) => {
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    return context;
});

function getSidebarInlineFootprint() {
    const sidebars = bodyEl.querySelectorAll(".app__sidebar");
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
    const bodyStyle = getComputedStyle(bodyEl);
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

const themeCanvas = boardStage.querySelector("#filter-canvas");
const themeCtx = themeCanvas.getContext("2d");

const spriteCache = new SpriteCache(KLOCKOMINOS, () => document.createElement("canvas"));
const nextSpriteCache = new SpriteCache(KLOCKOMINOS, () => document.createElement("canvas"));

const renderer = new Renderer({
    bodyEl,
    boardEl: boardStage,
    ctx,
    boardCanvas,
    nextCtxs,
    nextCanvases,
    spriteCache,
    nextSpriteCache,
    boardConfig: BOARD_CONFIG,
    klockominos: KLOCKOMINOS,
    colorPalette: COLOR_PALETTE,
    nextPreviewCellSize: NEXT_PREVIEW_CELL_SIZE,
    i18n,
});

const hud = new HUD({
    scoreEl: statsCardEl.querySelector("#score-value"),
    linesEl: statsCardEl.querySelector("#lines-value"),
    linesRowEl: statsCardEl.querySelector('[data-role="lines-stat"]'),
    bestEl: statsCardEl.querySelector("#best-value"),
    bestRowEl: statsCardEl.querySelector('[data-role="best-stat"]'),
    overlayEl: boardStage.querySelector("#overlay"),
    nextPieceCardEl,
    statsStatusEl: statusCardEl.querySelector('[data-role="stats-status"]'),
    difficultyEl: statsCardEl.querySelector("#difficulty-value"),
    difficultyBarEl: statsCardEl.querySelector("#difficulty-bar"),
    difficultyRowEl: statsCardEl.querySelector('[data-role="difficulty-stat"]'),
    statsCardEl,
    statusCardEl,
    i18n,
    timeEl: statusCardEl.querySelector("#time-value"),
    droughtEl: statsCardEl.querySelector("#drought-value"),
    tetrisRateEl: statsCardEl.querySelector("#trt-value"),
    ppsEl: statsCardEl.querySelector("#pps-value"),
    objectiveEl: statsCardEl.querySelector("#objective-value"),
    objectiveRowEl: statsCardEl.querySelector('[data-role="objective-stat"]'),
    objectiveBarEl: statsCardEl.querySelector("#objective-bar"),
    objectiveBarTrackEl: statsCardEl.querySelector("#objective-bar-track"),
});

const soundManager = new SoundManager(SOUND_FILES, {lang: i18n.lang});
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

const multiplayerController = new MultiplayerController(game, document, i18n);
game.multiplayerController = multiplayerController;
multiplayerController.init();

const fabControlsBtn = bodyEl.querySelector('[data-role="fab-controls"]');
if (fabControlsBtn) {
    fabControlsBtn.addEventListener("click", () => {
        game.screenFlow.toggleOptions();
    });
}

const settingsShortcutBtn = sidebarStatsEl.querySelector('[data-role="settings-shortcut"]');
if (settingsShortcutBtn) {
    settingsShortcutBtn.addEventListener("click", () => {
        game.screenFlow.toggleOptions();
    });
}

const muteToggleBtn = sidebarStatsEl.querySelector('[data-role="mute-toggle"]');
if (muteToggleBtn) {
    muteToggleBtn.addEventListener("click", () => {
        game.settingsController.toggleSound();
    });
}

bodyEl.querySelectorAll('[data-role="exit-match-button"]').forEach((btn) => {
    btn.addEventListener("click", () => {
        game.screenFlow.exitToMenu();
    });
});

function handleViewportResize() {
    resizeBoardCanvas();
    game.render();
}

(window?.visualViewport || window).addEventListener("resize", handleViewportResize);

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        if (game.state === "running" && !game.multiplayerConnected) game.screenFlow.togglePause();
    } else {
        game.soundManager.unlock();
    }
});

["pointerdown", "keydown", "touchstart"].forEach((type) => {
    window.addEventListener(type, () => game.soundManager.unlock(), {passive: true});
});
