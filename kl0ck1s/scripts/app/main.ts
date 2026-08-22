// @ts-nocheck
"use strict";

import {
    BOARD_CONFIG,
    COLOR_PALETTE,
    COMBO_BANNER_DURATION_MS,
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
} from "../games/kl0ck1s/shared/config.js";

import {Board} from "../games/kl0ck1s/game/board.js";
import {PieceBag} from "../games/kl0ck1s/game/piece-bag.js";
import {PersistentStore} from "../games/kl0ck1s/services/persistent-store.js";
import {Leaderboard} from "../games/kl0ck1s/ui/leaderboard.js";
import {Screens} from "../games/kl0ck1s/ui/screens.js";
import {SpriteCache} from "../games/kl0ck1s/rendering/sprite-cache.js";
import {SoundManager} from "../games/kl0ck1s/services/sound-manager.js";
import {Renderer} from "../games/kl0ck1s/rendering/renderer.js";
import {HUD} from "../games/kl0ck1s/ui/hud.js";
import {Game} from "../games/kl0ck1s/game/game.js";
import {I18n} from "../games/kl0ck1s/services/i18n.js";
import {MultiplayerController} from "../games/kl0ck1s/controllers/multiplayer-controller.js";
import {BootLoader} from "./boot-loader.js";
import {collectAppDom} from "./dom-elements.js";
import {AppLayout} from "./app-layout.js";
import {StatTooltipController} from "../games/kl0ck1s/controllers/stat-tooltip-controller.js";

const dom = collectAppDom();
const {
    body: bodyEl,
    app: appEl,
    bootScreen: bootScreenEl,
    bootBarFill: bootBarFillEl,
    bootStatus: bootStatusEl,
    boardStage,
    board: boardDiv,
    boardCanvas,
    boardContext: ctx,
    themeCanvas,
    themeContext: themeCtx,
    sidebarStats: sidebarStatsEl,
    statsCard: statsCardEl,
    statusCard: statusCardEl,
    nextPieceCard: nextPieceCardEl,
    nextCanvases,
    nextContexts: nextCtxs,
} = dom;

// Disable right click, for the mouse.
appEl.addEventListener("contextmenu", event => event.preventDefault());

const boot = new BootLoader({
    rootEl: bootScreenEl,
    fillEl: bootBarFillEl,
    statusEl: bootStatusEl,
});

const i18n = new I18n();
const statTooltipController = new StatTooltipController(document);
const partials = Promise.all(
    ["options", "menu", "gameover", "leaderboard", "multiplayer"].map((name) =>
        fetch(`partials/${name}.html`).then((response) => response.text())
    )
);
await i18n.init();
(await partials).forEach((html) => bodyEl.insertAdjacentHTML("beforeend", html));
i18n.applyStatic(bodyEl);


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
    comboBannerDuration: COMBO_BANNER_DURATION_MS,
    lineClearAnimationDuration: LINE_CLEAR_ANIMATION_DURATION_MS,
    settingsStore: store,
    themeCanvas,
    themeCtx,
    i18n,
});

const appLayout = new AppLayout(bodyEl, appEl, boardDiv, boardCanvas, ctx, BOARD_CONFIG, renderer, game);
appLayout.resizeBoardCanvas();

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
renderer.game = game;
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
    appLayout.resizeBoardCanvas();
    game.render();
}

(window?.visualViewport || window).addEventListener("resize", handleViewportResize);

if (typeof ResizeObserver !== "undefined") {
    let skipFirstObservation = true;
    const bodyResizeObserver = new ResizeObserver(() => {
        if (skipFirstObservation) {
            skipFirstObservation = false;
            return;
        }
        handleViewportResize();
    });
    bodyResizeObserver.observe(bodyEl);
}

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
