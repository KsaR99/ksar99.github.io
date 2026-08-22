// @ts-nocheck
import {BOARD_CONFIG, KLOCKOMINOS} from "../shared/config.js";
import type {SpriteCache} from "./sprite-cache.js";
import {GHOST_OPACITY_DEFAULTS, SATURATION_LEVELS} from "./sprite-cache.js";
import {CachedCanvasLayer} from "./cached-canvas-layer.js";
import {WebGLBoardRenderer} from "./webgl-board-renderer.js";
import {BoardRenderer} from "./board-renderer.js";
import {PieceRenderer} from "./piece-renderer.js";
import {EffectRenderer} from "./effect-renderer.js";
import {BannerRenderer} from "./banner-renderer.js";

"use strict";


export class Renderer {
    game: any;
    readonly boardRenderer: BoardRenderer;
    readonly pieceRenderer: PieceRenderer;
    readonly effectRenderer: EffectRenderer;
    readonly bannerRenderer: BannerRenderer;

    bodyEl: HTMLBodyElement;
    boardEl: HTMLElement | null;
    ctx: CanvasRenderingContext2D;
    boardCanvas: HTMLCanvasElement;
    nextCtxs: CanvasRenderingContext2D[];
    nextCanvases: HTMLCanvasElement[];
    spriteCache: SpriteCache;
    nextSpriteCache: SpriteCache;
    boardConfig: typeof BOARD_CONFIG;
    klockominos: typeof KLOCKOMINOS;
    colorPalette: string[];
    nextPreviewCellSize: number;
    i18n: import("../services/i18n.js").I18n | null;
    glowEnabled: boolean;
    transparencyEnabled: boolean;
    ghostType: "white" | "colorful" | "radioactive" | "ascii";
    ghostOpacities: { colorful: number; radioactive: number; white: number; ascii: number; };
    gridEnabled: boolean;
    shakeEnabled: boolean;
    heightSaturationEnabled: boolean;
    particlesEnabled: boolean;
    outlineBlocksEnabled: boolean;
    asciiFallingPiecesEnabled: boolean;
    _boardOffsetX: number;
    _boardOffsetY: number;
    boardCanvasRect: null;
    _boardScaleX: number;
    webglCanvas: null | HTMLCanvasElement;
    webgl: null | WebGLBoardRenderer;
    _onWindowResize: () => void;
    _shakeTimer: number = 0;
    _squashTimerA: number = 0;
    _squashTimerB: number = 0;

    constructor({
                    bodyEl,
                    boardEl = null,
                    ctx,
                    boardCanvas,
                    nextCtxs = [],
                    nextCanvases = [],
                    spriteCache,
                    nextSpriteCache = spriteCache,
                    boardConfig,
                    klockominos,
                    colorPalette,
                    nextPreviewCellSize,
                    i18n = null
                }) {
        this.bodyEl = bodyEl;
        this.boardEl = boardEl;
        this.ctx = ctx;
        this.boardCanvas = boardCanvas;
        this.nextCtxs = nextCtxs;
        this.nextCanvases = nextCanvases;
        this.game = null;
        this.spriteCache = spriteCache;
        this.nextSpriteCache = nextSpriteCache;
        this.boardConfig = boardConfig;
        this.klockominos = klockominos;
        this.colorPalette = colorPalette;
        this.nextPreviewCellSize = nextPreviewCellSize;
        this.i18n = i18n;
        this.boardRenderer = new BoardRenderer(this);
        this.pieceRenderer = new PieceRenderer(this);
        this.effectRenderer = new EffectRenderer(this);
        this.bannerRenderer = new BannerRenderer(this);
        this.glowEnabled = true;
        this.transparencyEnabled = true;
        this.ghostType = "white";
        this.ghostOpacities = {...GHOST_OPACITY_DEFAULTS};
        this.gridEnabled = true;
        this.shakeEnabled = true;
        this.heightSaturationEnabled = true;
        this.particlesEnabled = true;
        this.outlineBlocksEnabled = false;
        this.asciiFallingPiecesEnabled = false;
        this._boardOffsetX = 0;
        this._boardOffsetY = 0;
        this.boardCanvasRect = null;
        this._boardScaleX = 1;

        Object.assign(this, this.createSurface(ctx, boardCanvas));

        this.webglCanvas = null;
        this.webgl = null;
        try {
            this.webglCanvas = document.createElement("canvas");
            this.webglCanvas.className = "board__webgl";
            this.webglCanvas.setAttribute("aria-hidden", "true");
            this.webglCanvas.width = boardCanvas.width;
            this.webglCanvas.height = boardCanvas.height;
            boardCanvas.parentElement?.insertBefore(this.webglCanvas, boardCanvas);
            this.webgl = new WebGLBoardRenderer(this.webglCanvas, {
                cols: boardConfig.COLS,
                rows: boardConfig.ROWS,
            });
        } catch (error) {
            this.webglCanvas?.remove();
            this.webglCanvas = null;
            this.webgl = null;
            console.warn("WebGL renderer unavailable; using Canvas 2D.", error);
        }

        this._onWindowResize = () => this.refreshBoardCanvasRect();
        window.addEventListener("resize", this._onWindowResize);
    }

    get ghostOpacity() {
        return this.ghostOpacities[this.ghostType] ?? GHOST_OPACITY_DEFAULTS.colorful;
    }

    createSurface(ctx, boardCanvas) {
        return {
            ctx,
            boardCanvas,

            background: new CachedCanvasLayer(),
            _bgVersion: -1,
            _bgSize: 0,
            _bgGrid: null,
            _bgRows: 0,
            _bgCols: 0,
            _bgSat: null,
            _bgOutline: null,

            clearingStatic: new CachedCanvasLayer(),
            _clearingStaticVersion: -1,
            _clearingStaticSize: 0,
            _clearingStaticFromRow: -1,
            _clearingStaticSat: null,
            _clearingStaticOutline: null,

            clearingAbove: new CachedCanvasLayer(),
            _clearingAboveVersion: -1,
            _clearingAboveSize: 0,
            _clearingAboveSat: null,
            _clearingAboveOutline: null,
            _clearingAboveLineIndicesRef: null,
            _clearingAboveDropRowsRef: null,
            _clearingAboveSegments: [],

            clearingGrid: new CachedCanvasLayer(),
            _clearingGridSize: 0,
            _clearingGridRows: 0,
            _clearingGridCols: 0,

            cascadeDrop: new CachedCanvasLayer(),
            _cascadeDropVersion: -1,
            _cascadeDropSize: 0,
            _cascadeDropSat: null,
            _cascadeDropOutline: null,
            _cascadeDropGridRef: null,
            _cascadeDropSegments: [],

            zenBlocks: new CachedCanvasLayer(),
            _zenBlocksVersion: -1,
            _zenBlocksSize: 0,
            _zenBlocksSat: null,
            _zenBlocksOutline: null,
        };
    }

    clearVisuals() {
        this.ctx.clearRect(0, 0, this.boardCanvas.width, this.boardCanvas.height);
        for (const ctx of this.nextCtxs) {
            const canvas = ctx.canvas;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        this.resetBoardTransform();
        this.invalidateGridCaches();
    }

    flushWebGL(surface = this) {
        surface.webgl?.flush();
    }

    resizeBoardSurface(width, height) {
        if (this.webglCanvas) {
            this.webglCanvas.width = width;
            this.webglCanvas.height = height;
        }
        this.webgl?.resize(width, height);
    }

    refreshBoardCanvasRect() {
        this.boardCanvasRect = this.boardCanvas.getBoundingClientRect();
        this._boardScaleX = this.boardCanvas.width / this.boardCanvasRect.width;
    }

    destroy() {
        window.removeEventListener("resize", this._onWindowResize);
        clearTimeout(this._shakeTimer);
        clearTimeout(this._squashTimerA);
        clearTimeout(this._squashTimerB);
        this.webgl?.destroy();
        this.webglCanvas?.remove();
    }

    setGlowEnabled(enabled) {
        this.glowEnabled = enabled;
    }

    setTransparencyEnabled(enabled) {
        this.transparencyEnabled = enabled;
    }

    setGhostType(type) {
        this.ghostType = type;
    }

    setAsciiFallingPiecesEnabled(enabled) {
        const next = Boolean(enabled);
        if (this.asciiFallingPiecesEnabled === next) {
            if (this.webglCanvas) this.webglCanvas.style.visibility = next ? "hidden" : "visible";
            return;
        }
        this.asciiFallingPiecesEnabled = next;

        if (this.webglCanvas) {
            this.webglCanvas.style.visibility = next ? "hidden" : "visible";
        }
        if (next) {
            this.webgl?.clear();
        }
        this.invalidateGridCaches();
    }

    setGhostOpacities(opacities) {
        const clamp = (value) => Math.min(1, Math.max(0, value));
        this.ghostOpacities = {
            colorful: clamp(opacities?.colorful ?? this.ghostOpacities.colorful),
            ascii: clamp(opacities?.ascii ?? this.ghostOpacities.ascii ?? 0.5),
            radioactive: clamp(opacities?.radioactive ?? this.ghostOpacities.radioactive),
            white: clamp(opacities?.white ?? this.ghostOpacities.white),
        };
    }

    setGridEnabled(enabled) {
        this.gridEnabled = enabled;
        this.invalidateGridCaches();
    }

    invalidateGridCaches() {
        this._bgVersion = -1;
        this._clearingGridSize = 0;
        this._clearingGridRows = 0;
        this._clearingGridCols = 0;
        this.webgl?.invalidateGrid();
    }

    setShakeEnabled(enabled) {
        this.shakeEnabled = enabled;
        if (!enabled) this.resetBoardTransform();
    }

    setParticlesEnabled(enabled) {
        this.particlesEnabled = enabled;
    }

    setHeightSaturationEnabled(enabled) {
        if (this.heightSaturationEnabled === enabled) return;
        this.heightSaturationEnabled = enabled;

        const size = this.boardConfig.CELL_SIZE;
        if (size) {
            this.spriteCache.warmGlow(size, enabled);
            this.spriteCache.warmHardDropTrail(size, enabled);
            this.spriteCache.warmParticleColors(size, enabled);
        }
    }

    setOutlineBlocksEnabled(enabled) {
        this.outlineBlocksEnabled = enabled;
    }

    warmSpriteCache() {
        const size = this.boardConfig.CELL_SIZE;
        if (size) {
            this.spriteCache.getGridCell(size);
            this.spriteCache.warmGlow(size, this.heightSaturationEnabled);
            this.spriteCache.warmHardDropTrail(size, this.heightSaturationEnabled);
            this.spriteCache.warmFallTrail(size);
            this.spriteCache.warmParticleColors(size, this.heightSaturationEnabled);
        }
        if (this.nextPreviewCellSize && this.nextSpriteCache !== this.spriteCache) {
            this.nextSpriteCache.warmGlow(this.nextPreviewCellSize, this.heightSaturationEnabled);
        }
    }

    saturationLevelForRow(y, rows) {
        if (!this.heightSaturationEnabled) return 0;
        const distanceFromBottom = (rows - 1) - y;
        return Math.max(0, Math.min(SATURATION_LEVELS - 1, distanceFromBottom));
    }

    particleColorForRow(color, y, rows) {
        return this.spriteCache.getParticleColor(color, this.saturationLevelForRow(y, rows));
    }

    columnFromClientX(clientX) {
        this.refreshBoardCanvasRect();

        const x = (clientX - this.boardCanvasRect.left) * this._boardScaleX;
        return Math.floor(x / this.boardConfig.CELL_SIZE);
    }

    setTheme(theme) {
        const bodyClasses = this.bodyEl.classList;
        bodyClasses.remove(
            "body--theme-none",
            "body--theme-matrix",
            "body--theme-rain",
            "body--theme-snow",
            "body--theme-volcano",
            "body--theme-vhs"
        );
        bodyClasses.add(`body--theme-${theme || "none"}`);
    }

    buildClearFragments(...args: Parameters<EffectRenderer["buildClearFragments"]>): ReturnType<EffectRenderer["buildClearFragments"]> {
        return this.effectRenderer.buildClearFragments(...args);
    }

    drawFragments(...args: Parameters<EffectRenderer["drawFragments"]>): ReturnType<EffectRenderer["drawFragments"]> {
        return this.effectRenderer.drawFragments(...args);
    }

    resetBoardTransform(...args: Parameters<EffectRenderer["resetBoardTransform"]>): ReturnType<EffectRenderer["resetBoardTransform"]> {
        return this.effectRenderer.resetBoardTransform(...args);
    }

    _applyBoardOffset(...args: Parameters<EffectRenderer["_applyBoardOffset"]>): ReturnType<EffectRenderer["_applyBoardOffset"]> {
        return this.effectRenderer._applyBoardOffset(...args);
    }

    _ensureZenBlocksCache(...args: Parameters<EffectRenderer["_ensureZenBlocksCache"]>): ReturnType<EffectRenderer["_ensureZenBlocksCache"]> {
        return this.effectRenderer._ensureZenBlocksCache(...args);
    }

    drawZenShiftFrame(...args: Parameters<EffectRenderer["drawZenShiftFrame"]>): ReturnType<EffectRenderer["drawZenShiftFrame"]> {
        return this.effectRenderer.drawZenShiftFrame(...args);
    }

    shakeMove(...args: Parameters<EffectRenderer["shakeMove"]>): ReturnType<EffectRenderer["shakeMove"]> {
        return this.effectRenderer.shakeMove(...args);
    }

    shakeHardDrop(...args: Parameters<EffectRenderer["shakeHardDrop"]>): ReturnType<EffectRenderer["shakeHardDrop"]> {
        return this.effectRenderer.shakeHardDrop(...args);
    }

    drawClearingFlash(...args: Parameters<EffectRenderer["drawClearingFlash"]>): ReturnType<EffectRenderer["drawClearingFlash"]> {
        return this.effectRenderer.drawClearingFlash(...args);
    }

    drawGrid(...args: Parameters<BoardRenderer["drawGrid"]>): ReturnType<BoardRenderer["drawGrid"]> {
        return this.boardRenderer.drawGrid(...args);
    }

    _backgroundConfigCurrent(...args: Parameters<BoardRenderer["_backgroundConfigCurrent"]>): ReturnType<BoardRenderer["_backgroundConfigCurrent"]> {
        return this.boardRenderer._backgroundConfigCurrent(...args);
    }

    _stampBackgroundConfig(...args: Parameters<BoardRenderer["_stampBackgroundConfig"]>): ReturnType<BoardRenderer["_stampBackgroundConfig"]> {
        return this.boardRenderer._stampBackgroundConfig(...args);
    }

    updateBoardBackground(...args: Parameters<BoardRenderer["updateBoardBackground"]>): ReturnType<BoardRenderer["updateBoardBackground"]> {
        return this.boardRenderer.updateBoardBackground(...args);
    }

    notifyPieceLocked(...args: Parameters<BoardRenderer["notifyPieceLocked"]>): ReturnType<BoardRenderer["notifyPieceLocked"]> {
        return this.boardRenderer.notifyPieceLocked(...args);
    }

    notifyLinesCleared(...args: Parameters<BoardRenderer["notifyLinesCleared"]>): ReturnType<BoardRenderer["notifyLinesCleared"]> {
        return this.boardRenderer.notifyLinesCleared(...args);
    }

    _ensureClearingStaticBackground(...args: Parameters<BoardRenderer["_ensureClearingStaticBackground"]>): ReturnType<BoardRenderer["_ensureClearingStaticBackground"]> {
        return this.boardRenderer._ensureClearingStaticBackground(...args);
    }

    _ensureClearingGridCache(...args: Parameters<BoardRenderer["_ensureClearingGridCache"]>): ReturnType<BoardRenderer["_ensureClearingGridCache"]> {
        return this.boardRenderer._ensureClearingGridCache(...args);
    }

    drawBoard(...args: Parameters<BoardRenderer["drawBoard"]>): ReturnType<BoardRenderer["drawBoard"]> {
        return this.boardRenderer.drawBoard(...args);
    }

    drawHardcoreMask(...args: Parameters<BoardRenderer["drawHardcoreMask"]>): ReturnType<BoardRenderer["drawHardcoreMask"]> {
        return this.boardRenderer.drawHardcoreMask(...args);
    }

    _ensureClearingAboveCache(...args: Parameters<BoardRenderer["_ensureClearingAboveCache"]>): ReturnType<BoardRenderer["_ensureClearingAboveCache"]> {
        return this.boardRenderer._ensureClearingAboveCache(...args);
    }

    _ensureCascadeDropCache(...args: Parameters<BoardRenderer["_ensureCascadeDropCache"]>): ReturnType<BoardRenderer["_ensureCascadeDropCache"]> {
        return this.boardRenderer._ensureCascadeDropCache(...args);
    }

    drawCascadeFallFrame(...args: Parameters<BoardRenderer["drawCascadeFallFrame"]>): ReturnType<BoardRenderer["drawCascadeFallFrame"]> {
        return this.boardRenderer.drawCascadeFallFrame(...args);
    }

    drawClearingFrame(...args: Parameters<BoardRenderer["drawClearingFrame"]>): ReturnType<BoardRenderer["drawClearingFrame"]> {
        return this.boardRenderer.drawClearingFrame(...args);
    }

    drawCell(...args: Parameters<PieceRenderer["drawCell"]>): ReturnType<PieceRenderer["drawCell"]> {
        return this.pieceRenderer.drawCell(...args);
    }

    drawRotationIndicator(...args: Parameters<PieceRenderer["drawRotationIndicator"]>): ReturnType<PieceRenderer["drawRotationIndicator"]> {
        return this.pieceRenderer.drawRotationIndicator(...args);
    }

    drawPiece(...args: Parameters<PieceRenderer["drawPiece"]>): ReturnType<PieceRenderer["drawPiece"]> {
        return this.pieceRenderer.drawPiece(...args);
    }

    drawFallTrail(...args: Parameters<PieceRenderer["drawFallTrail"]>): ReturnType<PieceRenderer["drawFallTrail"]> {
        return this.pieceRenderer.drawFallTrail(...args);
    }

    drawHardDropTrail(...args: Parameters<PieceRenderer["drawHardDropTrail"]>): ReturnType<PieceRenderer["drawHardDropTrail"]> {
        return this.pieceRenderer.drawHardDropTrail(...args);
    }

    drawHardDropImpactFlash(...args: Parameters<PieceRenderer["drawHardDropImpactFlash"]>): ReturnType<PieceRenderer["drawHardDropImpactFlash"]> {
        return this.pieceRenderer.drawHardDropImpactFlash(...args);
    }

    drawLockImpactFlash(...args: Parameters<PieceRenderer["drawLockImpactFlash"]>): ReturnType<PieceRenderer["drawLockImpactFlash"]> {
        return this.pieceRenderer.drawLockImpactFlash(...args);
    }

    drawImpactFlash(...args: Parameters<PieceRenderer["drawImpactFlash"]>): ReturnType<PieceRenderer["drawImpactFlash"]> {
        return this.pieceRenderer.drawImpactFlash(...args);
    }

    drawHardDropImpactSparks(...args: Parameters<PieceRenderer["drawHardDropImpactSparks"]>): ReturnType<PieceRenderer["drawHardDropImpactSparks"]> {
        return this.pieceRenderer.drawHardDropImpactSparks(...args);
    }

    drawGhost(...args: Parameters<PieceRenderer["drawGhost"]>): ReturnType<PieceRenderer["drawGhost"]> {
        return this.pieceRenderer.drawGhost(...args);
    }

    drawNext(...args: Parameters<PieceRenderer["drawNext"]>): ReturnType<PieceRenderer["drawNext"]> {
        return this.pieceRenderer.drawNext(...args);
    }

    getBannerAnchorY(...args: Parameters<BannerRenderer["getBannerAnchorY"]>): ReturnType<BannerRenderer["getBannerAnchorY"]> {
        return this.bannerRenderer.getBannerAnchorY(...args);
    }

    getRotatedHalfExtentY(...args: Parameters<BannerRenderer["getRotatedHalfExtentY"]>): ReturnType<BannerRenderer["getRotatedHalfExtentY"]> {
        return this.bannerRenderer.getRotatedHalfExtentY(...args);
    }

    getLevelUpBannerMetrics(...args: Parameters<BannerRenderer["getLevelUpBannerMetrics"]>): ReturnType<BannerRenderer["getLevelUpBannerMetrics"]> {
        return this.bannerRenderer.getLevelUpBannerMetrics(...args);
    }

    getComboBannerMetrics(...args: Parameters<BannerRenderer["getComboBannerMetrics"]>): ReturnType<BannerRenderer["getComboBannerMetrics"]> {
        return this.bannerRenderer.getComboBannerMetrics(...args);
    }

    resolveBannerCenters(...args: Parameters<BannerRenderer["resolveBannerCenters"]>): ReturnType<BannerRenderer["resolveBannerCenters"]> {
        return this.bannerRenderer.resolveBannerCenters(...args);
    }

    drawBanners(...args: Parameters<BannerRenderer["drawBanners"]>): ReturnType<BannerRenderer["drawBanners"]> {
        return this.bannerRenderer.drawBanners(...args);
    }

    drawLevelUpBanner(...args: Parameters<BannerRenderer["drawLevelUpBanner"]>): ReturnType<BannerRenderer["drawLevelUpBanner"]> {
        return this.bannerRenderer.drawLevelUpBanner(...args);
    }

    drawComboBanner(...args: Parameters<BannerRenderer["drawComboBanner"]>): ReturnType<BannerRenderer["drawComboBanner"]> {
        return this.bannerRenderer.drawComboBanner(...args);
    }

}
