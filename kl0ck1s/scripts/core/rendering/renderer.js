"use strict";

import {forEachShapeCell, getTightBounds, lightenOklch, withAlpha} from "../shared/utils.js";
import {CachedCanvasLayer} from "./cached-canvas-layer.js";
import {FALL_TRAIL_ALPHA_CACHE, HARD_DROP_TRAIL_ALPHAS} from "../game/game-constants.js";
import {LINE_CLEAR_FLASH_PHASE_FRACTION} from "../shared/config.js";
import {
    colorForLevel,
    cornerRadiusForSize,
    fallTrailColor,
    GHOST_OPACITY_DEFAULTS,
    HARD_DROP_FLASH_SPRITE_HEIGHT,
    hardDropTrailColor,
    SATURATION_LEVELS
} from "./sprite-cache.js";

const GHOST_MIN_DROP_ROWS = 3;
const GHOST_WHITE_COLOR = "oklch(0.96 0 0)";

const HARDCORE_MASK_STYLES = Object.freeze({
    none: Object.freeze({
        base: "oklch(0.08 0 0 / 95%)",
        hatch: "oklch(1 0 0 / 5%)",
        edge: "oklch(1 0 0 / 32%)",
    }),
    volcano: Object.freeze({
        base: "oklch(0.58 0.21 45 / 92%)",
        hatch: "oklch(0.16 0.04 30 / 45%)",
        edge: "oklch(0.9 0.18 75 / 70%)",
        pattern: "wave",
    }),
    matrix: Object.freeze({
        base: "oklch(0.1 0.02 150 / 92%)",
        hatch: "oklch(0.543 0.123 151.327 / 24%)",
        edge: "oklch(0.751 0.133 144.116 / 50%)",
    }),
    rain: Object.freeze({
        base: "oklch(0.28 0.09 235 / 92%)",
        hatch: "oklch(0.85 0.06 220 / 26%)",
        edge: "oklch(0.9 0.05 220 / 60%)",
        pattern: "wave",
    }),
    snow: Object.freeze({
        base: "oklch(0.93 0.01 240 / 92%)",
        hatch: "oklch(0.8 0.02 240 / 30%)",
        edge: "oklch(0.78 0.04 235 / 60%)",
        pattern: "puff",
    }),
    vhs: Object.freeze({
        base: "oklch(0.12 0.04 320 / 92%)",
        hatch: "oklch(0.6 0.25 340 / 22%)",
        edge: "oklch(0.75 0.18 200 / 48%)",
        pattern: "scanline",
    }),
});

export class Renderer {
    /**
     * @param {object} deps
     * @param {HTMLBodyElement} bodyEl
     * @param {CanvasRenderingContext2D} deps.ctx
     * @param {HTMLCanvasElement} deps.boardCanvas
     * @param {Array<CanvasRenderingContext2D>} deps.nextCtxs - one per queue slot, index 0 = soonest
     * @param {Array<HTMLCanvasElement>} deps.nextCanvases - one per queue slot, index 0 = soonest
     * @param {import("./sprite-cache.js").SpriteCache} deps.spriteCache
     * @param {object} deps.boardConfig
     * @param {object} deps.klockominos
     * @param {Array<string|null>} deps.colorPalette - colorIndex -> CSS color (index 0 = empty)
     * @param {number} deps.nextPreviewCellSize
     * @param {import("../services/i18n.js").I18n} [deps.i18n]
     */
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
        this.spriteCache = spriteCache;
        this.nextSpriteCache = nextSpriteCache;
        this.boardConfig = boardConfig;
        this.klockominos = klockominos;
        this.colorPalette = colorPalette;
        this.nextPreviewCellSize = nextPreviewCellSize;
        this.i18n = i18n;
        this.glowEnabled = true;
        this.transparencyEnabled = true;
        this.ghostType = "white";
        this.ghostOpacities = {...GHOST_OPACITY_DEFAULTS};
        this.gridEnabled = true;
        this.shakeEnabled = true;
        this.heightSaturationEnabled = true;
        this.particlesEnabled = true;
        this.outlineBlocksEnabled = false;
        this._boardOffsetX = 0;
        this._boardOffsetY = 0;
        this.boardCanvasRect = null;
        this._boardScaleX = 1;

        Object.assign(this, this.createSurface(ctx, boardCanvas));

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

    refreshBoardCanvasRect() {
        this.boardCanvasRect = this.boardCanvas.getBoundingClientRect();
        this._boardScaleX = this.boardCanvas.width / this.boardCanvasRect.width;
    }

    destroy() {
        window.removeEventListener("resize", this._onWindowResize);
        clearTimeout(this._shakeTimer);
        clearTimeout(this._squashTimerA);
        clearTimeout(this._squashTimerB);
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

    setGhostOpacities(opacities) {
        const clamp = (value) => Math.min(1, Math.max(0, value));
        this.ghostOpacities = {
            colorful: clamp(opacities?.colorful ?? this.ghostOpacities.colorful),
            radioactive: clamp(opacities?.radioactive ?? this.ghostOpacities.radioactive),
            white: clamp(opacities?.white ?? this.ghostOpacities.white),
        };
    }

    setGridEnabled(enabled) {
        this.gridEnabled = enabled;
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

    /**
     * Builds line-clear particle fragments from a flat colors array.
     *
     * @param {object} params
     * @param {Uint8Array|number[]} params.cells - flat colorIndex array, length cols*rows
     * @param {number} params.cols
     * @param {number} params.rows - total board rows (used for height-saturation)
     * @param {number[]} params.lineIndices - rows being cleared
     * @param {number} [params.size] - cell size in px; defaults to this board's cell size
     * @returns {{
     *   count: number,
     *   startX: Float32Array, startY: Float32Array,
     *   dx: Float32Array, dy: Float32Array,
     *   rotation0: Float32Array, dRotation: Float32Array,
     *   size: Float32Array, halfSize: Float32Array,
     *   colorIndex: Uint16Array, colors: string[]
     * }}
     */
    buildClearFragments({cells, cols, rows, lineIndices, size = this.boardConfig.CELL_SIZE}) {
        if (!this.particlesEnabled) return null;

        const fragmentsPerAxis = 8;
        const fragsPerCell = fragmentsPerAxis * fragmentsPerAxis;
        const fragSize = size / fragmentsPerAxis;
        const halfFragSize = fragSize / 2;

        let cellCount = 0;
        for (const y of lineIndices) {
            for (let x = 0; x < cols; x++) {
                if (cells[y * cols + x]) cellCount++;
            }
        }

        const count = cellCount * fragsPerCell;
        const startX = new Float32Array(count);
        const startY = new Float32Array(count);
        const dx = new Float32Array(count);
        const dy = new Float32Array(count);
        const rotation0 = new Float32Array(count);
        const dRotation = new Float32Array(count);
        const fragSizeArr = new Float32Array(count).fill(fragSize);
        const halfSizeArr = new Float32Array(count).fill(halfFragSize);
        const colorIndex = new Uint16Array(count);
        const colIndex = new Uint16Array(count);
        const colors = [];
        const colorSlot = new Map();

        let i = 0;
        for (const y of lineIndices) {
            for (let x = 0; x < cols; x++) {
                const cellColorIndex = cells[y * cols + x];
                if (!cellColorIndex) continue;
                const fragmentColor = this.particleColorForRow(this.colorPalette[cellColorIndex], y, rows);

                let cIdx = colorSlot.get(fragmentColor);
                if (cIdx === undefined) {
                    cIdx = colors.length;
                    colors.push(fragmentColor);
                    colorSlot.set(fragmentColor, cIdx);
                }

                for (let fy = 0; fy < fragmentsPerAxis; fy++) {
                    for (let fx = 0; fx < fragmentsPerAxis; fx++, i++) {
                        startX[i] = x * size + (fx + 0.5) * fragSize;
                        startY[i] = y * size + (fy + 0.2) * fragSize;

                        const angle = Math.random() * Math.PI * 2;
                        const distance = size * (0.2 + Math.random() * 0.5);

                        dx[i] = Math.cos(angle) * distance;
                        dy[i] = Math.sin(angle) * distance;
                        rotation0[i] = Math.random() * Math.PI * 2;
                        dRotation[i] = (Math.random() - 0.5) * Math.PI * 6;
                        colorIndex[i] = cIdx;
                        colIndex[i] = x;
                    }
                }
            }
        }

        return {
            count,
            startX, startY,
            dx, dy,
            rotation0, dRotation,
            size: fragSizeArr, halfSize: halfSizeArr,
            colorIndex, colors,
            colIndex,
        };
    }

    /**
     * Draws a line-clear particle burst onto any canvas context.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {ReturnType<Renderer["buildClearFragments"]>} fragments
     * @param {number|Float32Array} particleProgress - either a single 0..1 progress applied to every
     *   fragment, or a Float32Array indexed by board column giving each column's own 0..1 progress.
     *   A negative value for a column means "not revealed yet" - fragments in that column are skipped.
     */
    drawFragments(ctx, fragments, particleProgress) {
        if (!fragments?.count) return;

        const {
            count,
            startX,
            startY,
            dx,
            dy,
            rotation0,
            dRotation,
            size,
            halfSize,
            colorIndex,
            colors,
            colIndex
        } = fragments;
        const perColumn = particleProgress instanceof Float32Array;

        ctx.save();

        for (let i = 0; i < count; i++) {
            const progress = perColumn ? particleProgress[colIndex[i]] : particleProgress;
            if (progress < 0) continue;

            const fragmentAlpha = 0.75 * (1 - progress);
            if (fragmentAlpha <= 0) continue;

            const x = startX[i] + dx[i] * progress;
            const y = startY[i] + dy[i] * progress;
            const rotation = rotation0[i] + dRotation[i] * progress;
            const cos = Math.cos(rotation);
            const sin = Math.sin(rotation);
            ctx.globalAlpha = fragmentAlpha;
            ctx.setTransform(cos, sin, -sin, cos, x, y);
            ctx.fillStyle = colors[colorIndex[i]];
            const half = halfSize[i];
            ctx.fillRect(-half, -half, size[i], size[i]);
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.restore();
    }

    resetBoardTransform() {
        clearTimeout(this._shakeTimer);
        clearTimeout(this._squashTimerA);
        clearTimeout(this._squashTimerB);
        this._boardOffsetX = 0;
        this._boardOffsetY = 0;
        if (!this.boardEl) return;
        this.boardEl.style.transition = "none";
        this.boardEl.style.translate = "0 0";
    }

    _applyBoardOffset(transitionMs) {
        const el = this.boardEl;
        if (!el) return;

        el.style.setProperty("--shake-duration", `${transitionMs}ms`);
        el.style.translate =
            `${this._boardOffsetX ?? 0}rem ${this._boardOffsetY ?? 0}rem`;
    }

    _ensureZenBlocksCache(surface, board, size) {
        const dirty = surface._zenBlocksVersion !== board.version
            || surface._zenBlocksSize !== size
            || surface._zenBlocksSat !== this.heightSaturationEnabled
            || surface._zenBlocksOutline !== this.outlineBlocksEnabled;

        if (!dirty) return;

        const width = board.cols * size;
        const height = board.rows * size;
        surface.zenBlocks.resize(width, height);

        const bCtx = surface.zenBlocks.ctx;
        bCtx.clearRect(0, 0, width, height);

        for (let y = 0; y < board.rows; y++) {
            for (let x = 0; x < board.cols; x++) {
                const colorIndex = board.colors[y * board.cols + x];
                if (colorIndex) this.drawCell(bCtx, x, y, this.colorPalette[colorIndex], size, {level: this.saturationLevelForRow(y, board.rows)});
            }
        }

        surface._zenBlocksVersion = board.version;
        surface._zenBlocksSize = size;
        surface._zenBlocksSat = this.heightSaturationEnabled;
        surface._zenBlocksOutline = this.outlineBlocksEnabled;
    }

    drawZenShiftFrame(board, rowDelta, progress, surface = this) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx, boardCanvas} = surface;

        this._ensureZenBlocksCache(surface, board, size);
        if (this.gridEnabled) this._ensureClearingGridCache(surface, board, size);

        const t = Math.min(1, Math.max(0, progress));
        const eased = 1 - Math.pow(1 - t, 3);
        const dy = -rowDelta * size * (1 - eased);

        ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
        if (this.gridEnabled) ctx.drawImage(surface.clearingGrid.canvas, 0, 0);
        ctx.drawImage(surface.zenBlocks.canvas, 0, dy);
    }

    shakeMove(dir) {
        if (!this.shakeEnabled || !this.boardEl || !dir) return;
        clearTimeout(this._shakeTimer);
        this._boardOffsetX = dir < 0 ? 0.4 : -0.4;
        this._applyBoardOffset(70);
        this._shakeTimer = setTimeout(() => {
            this._boardOffsetX = 0;
            this._applyBoardOffset(120);
        }, 70);
    }

    shakeHardDrop() {
        if (!this.shakeEnabled || !this.boardEl) return;
        clearTimeout(this._squashTimerA);
        clearTimeout(this._squashTimerB);
        this._boardOffsetY = 0.5;
        this._applyBoardOffset(70);
        this._squashTimerA = setTimeout(() => {
            this._boardOffsetY = -0.5;
            this._applyBoardOffset(90);
            this._squashTimerB = setTimeout(() => {
                this._boardOffsetY = 0;
                this._applyBoardOffset(120);
            }, 90);
        }, 70);
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

    drawCell(context, x, y, color, size, {glow = false, ghost = false, level = 0, cache = this.spriteCache} = {}) {
        if (this.outlineBlocksEnabled) {
            const isGlow = glow && this.glowEnabled;
            const sprite = isGlow
                ? cache.getOutlineGlow(color, size, level, y)
                : cache.getOutline(color, size, level);
            const offset = (sprite.width - size) / 2;

            context.save();
            if (!isGlow) {
                context.beginPath();
                context.rect(x * size, y * size, size, size);
                context.clip();
            }
            if (ghost) context.globalAlpha *= this.ghostOpacity;
            context.drawImage(sprite, x * size - offset, y * size - offset);
            context.restore();
            return;
        }

        glow = glow && this.glowEnabled;

        if (glow) {
            const sprite = cache.getGlow(color, size, level, y);
            if (sprite) {
                const offset = (sprite.width - size) / 2;
                context.drawImage(sprite, x * size - offset, y * size - offset);
            } else {
                context.fillStyle = color;
                context.fillRect(x * size, y * size, size, size);
            }
            return;
        }

        const region = cache.getRegion(color, size, level);
        if (!region) {
            context.fillStyle = color;
            context.fillRect(x * size, y * size, size, size);
            return;
        }

        if (ghost) {
            context.save();
            context.globalAlpha *= this.ghostOpacity;
        }

        context.drawImage(region.image, region.sx, region.sy, region.sw, region.sh, x * size, y * size, size, size);

        if (ghost)
            context.restore();
    }

    drawGrid(board, context = this.ctx, fromRow = 0, toRow = board.rows - 1, fromCol = 0, toCol = board.cols - 1) {
        const size = this.boardConfig.CELL_SIZE;
        const sprite = this.spriteCache.getGridCell(size);

        for (let y = fromRow; y <= toRow; y++) {
            for (let x = fromCol; x <= toCol; x++) {
                context.drawImage(sprite, x * size, y * size, size, size);
            }
        }
    }

    _backgroundConfigCurrent(surface, board, size) {
        return surface._bgSize === size
            && surface._bgGrid === this.gridEnabled
            && surface._bgRows === board.rows
            && surface._bgCols === board.cols
            && surface._bgSat === this.heightSaturationEnabled
            && surface._bgOutline === this.outlineBlocksEnabled;
    }

    _stampBackgroundConfig(surface, board, size) {
        surface._bgSize = size;
        surface._bgGrid = this.gridEnabled;
        surface._bgRows = board.rows;
        surface._bgCols = board.cols;
        surface._bgSat = this.heightSaturationEnabled;
        surface._bgOutline = this.outlineBlocksEnabled;
    }

    updateBoardBackground(board, size, surface = this) {
        const dirty = surface._bgVersion !== board.version || !this._backgroundConfigCurrent(surface, board, size);
        if (!dirty) return;

        this.spriteCache.warmGlow(size, this.heightSaturationEnabled);

        const width = board.cols * size;
        const height = board.rows * size;
        surface.background.resize(width, height);

        const bgCtx = surface.background.ctx;
        bgCtx.clearRect(0, 0, width, height);
        if (this.gridEnabled) this.drawGrid(board, bgCtx);

        for (let y = 0; y < board.rows; y++) {
            for (let x = 0; x < board.cols; x++) {
                const colorIndex = board.colors[y * board.cols + x];
                if (colorIndex) this.drawCell(bgCtx, x, y, this.colorPalette[colorIndex], size, {level: this.saturationLevelForRow(y, board.rows)});
            }
        }

        surface._bgVersion = board.version;
        this._stampBackgroundConfig(surface, board, size);
    }

    notifyPieceLocked(piece, board, surface = this) {
        const size = this.boardConfig.CELL_SIZE;
        if (!this._backgroundConfigCurrent(surface, board, size)) return;

        this.spriteCache.warmGlow(size, this.heightSaturationEnabled);

        const bgCtx = surface.background.ctx;
        const pad = this.outlineBlocksEnabled
            ? this.spriteCache.outlinePad
            : (this.glowEnabled ? this.spriteCache.glowPad : 0);
        const padCells = pad ? Math.ceil(pad / size) : 0;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
            const y = piece.y + r;
            if (y < 0) return;
            const x = piece.x + c;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        });

        if (minX === Infinity) {
            surface._bgVersion = board.version;
            return;
        }

        const fromX = Math.max(0, minX - padCells);
        const toX = Math.min(board.cols - 1, maxX + padCells);
        const fromY = Math.max(0, minY - padCells);
        const toY = Math.min(board.rows - 1, maxY + padCells);

        bgCtx.clearRect(fromX * size, fromY * size, (toX - fromX + 1) * size, (toY - fromY + 1) * size);
        if (this.gridEnabled) this.drawGrid(board, bgCtx, fromY, toY, fromX, toX);

        for (let y = fromY; y <= toY; y++) {
            for (let x = fromX; x <= toX; x++) {
                const colorIndex = board.colors[y * board.cols + x];
                if (!colorIndex) continue;
                this.drawCell(bgCtx, x, y, this.colorPalette[colorIndex], size, {level: this.saturationLevelForRow(y, board.rows)});
            }
        }

        surface._bgVersion = board.version;
    }

    notifyLinesCleared(board, clearedRowIndices, surface = this) {
        const size = this.boardConfig.CELL_SIZE;
        if (!this._backgroundConfigCurrent(surface, board, size)) return;
        if (!clearedRowIndices || clearedRowIndices.length === 0) {
            surface._bgVersion = board.version;
            return;
        }

        this.spriteCache.warmGlow(size, this.heightSaturationEnabled);

        const pad = this.outlineBlocksEnabled
            ? this.spriteCache.outlinePad
            : (this.glowEnabled ? this.spriteCache.glowPad : 0);
        const padRows = pad ? Math.ceil(pad / size) : 0;
        const affectedMaxRow = Math.min(board.rows - 1, Math.max(...clearedRowIndices) + padRows);
        const width = board.cols * size;
        const bgCtx = surface.background.ctx;

        bgCtx.clearRect(0, 0, width, (affectedMaxRow + 1) * size);
        if (this.gridEnabled) this.drawGrid(board, bgCtx, 0, affectedMaxRow);

        for (let y = 0; y <= affectedMaxRow; y++) {
            for (let x = 0; x < board.cols; x++) {
                const colorIndex = board.colors[y * board.cols + x];
                if (colorIndex) this.drawCell(bgCtx, x, y, this.colorPalette[colorIndex], size, {level: this.saturationLevelForRow(y, board.rows)});
            }
        }

        surface._bgVersion = board.version;
    }

    _ensureClearingStaticBackground(surface, board, size, staticFromRow) {
        const dirty = surface._clearingStaticVersion !== board.version
            || surface._clearingStaticSize !== size
            || surface._clearingStaticFromRow !== staticFromRow
            || surface._clearingStaticSat !== this.heightSaturationEnabled
            || surface._clearingStaticOutline !== this.outlineBlocksEnabled;

        if (!dirty) return;

        const rowsCount = Math.max(0, board.rows - staticFromRow);
        const width = board.cols * size;
        const height = rowsCount * size;
        surface.clearingStatic.resize(width, height);

        const sCtx = surface.clearingStatic.ctx;
        sCtx.clearRect(0, 0, width, height);

        for (let y = staticFromRow; y < board.rows; y++) {
            const localY = y - staticFromRow;
            for (let x = 0; x < board.cols; x++) {
                const colorIndex = board.colors[y * board.cols + x];
                if (colorIndex) this.drawCell(sCtx, x, localY, this.colorPalette[colorIndex], size, {level: this.saturationLevelForRow(y, board.rows)});
            }
        }

        surface._clearingStaticVersion = board.version;
        surface._clearingStaticSize = size;
        surface._clearingStaticFromRow = staticFromRow;
        surface._clearingStaticSat = this.heightSaturationEnabled;
        surface._clearingStaticOutline = this.outlineBlocksEnabled;
    }

    _ensureClearingGridCache(surface, board, size) {
        const dirty = surface._clearingGridSize !== size
            || surface._clearingGridRows !== board.rows
            || surface._clearingGridCols !== board.cols;

        if (!dirty) return;

        const width = board.cols * size;
        const height = board.rows * size;
        surface.clearingGrid.resize(width, height);

        const gCtx = surface.clearingGrid.ctx;
        gCtx.clearRect(0, 0, width, height);
        this.drawGrid(board, gCtx, 0, board.rows - 1);

        surface._clearingGridSize = size;
        surface._clearingGridRows = board.rows;
        surface._clearingGridCols = board.cols;
    }

    drawBoard(board, surface = this) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = surface;

        this.updateBoardBackground(board, size, surface);

        ctx.clearRect(0, 0, surface.boardCanvas.width, surface.boardCanvas.height); // required for fall-trail.
        ctx.drawImage(surface.background.canvas, 0, 0);
    }

    drawHardcoreMask(board, fromRow, theme = "none", surface = this) {
        if (fromRow == null) return;

        const size = this.boardConfig.CELL_SIZE;
        const maskFromRow = Math.max(0, Math.min(board.rows, fromRow + 1));
        if (maskFromRow >= board.rows) return;

        const {ctx} = surface;
        const width = board.cols * size;
        const top = maskFromRow * size;
        const height = (board.rows - maskFromRow) * size;
        if (height <= 0) return;

        const style = HARDCORE_MASK_STYLES[theme] ?? HARDCORE_MASK_STYLES.none;

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, top, width, height);
        ctx.clip();

        ctx.fillStyle = style.base;
        ctx.fillRect(0, top, width, height);

        ctx.strokeStyle = style.hatch;
        ctx.fillStyle = style.hatch;
        if (style.pattern === "scanline") {
            ctx.lineWidth = Math.max(1, size * 0.12);
            const lineStep = Math.max(3, size * 0.22);
            for (let y = top; y < top + height; y += lineStep) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }
        } else if (style.pattern === "wave") {
            ctx.lineWidth = Math.max(1, size * 0.1);
            const waveStep = Math.max(8, size * 0.9);
            const amplitude = Math.max(2, size * 0.18);
            const segments = Math.max(6, Math.ceil(width / (size * 0.5)));
            for (let y = top + waveStep / 2; y < top + height; y += waveStep) {
                ctx.beginPath();
                for (let i = 0; i <= segments; i++) {
                    const x = (i / segments) * width;
                    const phase = (x / width) * Math.PI * 4 + y * 0.05;
                    const wy = y + Math.sin(phase) * amplitude;
                    if (i === 0) ctx.moveTo(x, wy);
                    else ctx.lineTo(x, wy);
                }
                ctx.stroke();
            }
        } else if (style.pattern === "puff") {
            const puffRadius = Math.max(2, size * 0.16);
            const spacingX = puffRadius * 2.6;
            const spacingY = puffRadius * 2.4;
            let rowIndex = 0;
            for (let y = top + spacingY / 2; y < top + height; y += spacingY) {
                const offsetX = (rowIndex % 2 === 0) ? 0 : spacingX / 2;
                for (let x = offsetX + spacingX / 2; x < width; x += spacingX) {
                    ctx.beginPath();
                    ctx.arc(x, y, puffRadius, 0, Math.PI * 2);
                    ctx.fill();
                }
                ++rowIndex;
            }
        } else {
            ctx.lineWidth = Math.max(1, size * 0.08);
            const step = Math.max(6, size * 0.6);
            for (let d = -height; d < width; d += step) {
                ctx.beginPath();
                ctx.moveTo(d, top + height);
                ctx.lineTo(d + height, top);
                ctx.stroke();
            }
        }

        ctx.restore();

        ctx.save();
        ctx.strokeStyle = style.edge;
        ctx.lineWidth = Math.max(1, size * 0.06);
        ctx.beginPath();
        ctx.moveTo(0, top);
        ctx.lineTo(width, top);
        ctx.stroke();
        ctx.restore();
    }

    _ensureClearingAboveCache(surface, board, size, affectedMaxRow, lineIndices, dropRows) {
        const dirty = surface._clearingAboveVersion !== board.version
            || surface._clearingAboveSize !== size
            || surface._clearingAboveLineIndicesRef !== lineIndices
            || surface._clearingAboveDropRowsRef !== dropRows
            || surface._clearingAboveSat !== this.heightSaturationEnabled
            || surface._clearingAboveOutline !== this.outlineBlocksEnabled;

        if (!dirty) return;

        const clearingSet = new Set(lineIndices);
        const width = board.cols * size;
        const height = (affectedMaxRow + 1) * size;
        surface.clearingAbove.resize(width, height);

        const ctx = surface.clearingAbove.ctx;
        ctx.clearRect(0, 0, width, Math.max(1, height));

        const segments = [];
        let runStart = -1;
        let runDrop = 0;

        const flushRun = (endExclusive) => {
            if (runStart === -1) return;
            segments.push({top: runStart, height: endExclusive - runStart, dropAmount: runDrop});
            runStart = -1;
        };

        for (let y = 0; y <= affectedMaxRow; y++) {
            if (clearingSet.has(y)) {
                flushRun(y);
                continue;
            }
            const drop = dropRows[y] || 0;
            if (runStart === -1) {
                runStart = y;
                runDrop = drop;
            } else if (drop !== runDrop) {
                flushRun(y);
                runStart = y;
                runDrop = drop;
            }
        }

        flushRun(affectedMaxRow + 1);

        for (const segment of segments) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, segment.top * size, width, segment.height * size);
            ctx.clip();
            for (let y = segment.top; y < segment.top + segment.height; y++) {
                for (let x = 0; x < board.cols; x++) {
                    const colorIndex = board.colors[y * board.cols + x];
                    if (!colorIndex) continue;
                    this.drawCell(ctx, x, y, this.colorPalette[colorIndex], size, {level: this.saturationLevelForRow(y, board.rows)});
                }
            }
            ctx.restore();
        }

        surface._clearingAboveSegments = segments;
        surface._clearingAboveVersion = board.version;
        surface._clearingAboveSize = size;
        surface._clearingAboveLineIndicesRef = lineIndices;
        surface._clearingAboveDropRowsRef = dropRows;
        surface._clearingAboveSat = this.heightSaturationEnabled;
        surface._clearingAboveOutline = this.outlineBlocksEnabled;
    }

    _ensureCascadeDropCache(surface, board, size, dropGrid) {
        const dirty = surface._cascadeDropVersion !== board.version
            || surface._cascadeDropSize !== size
            || surface._cascadeDropGridRef !== dropGrid
            || surface._cascadeDropSat !== this.heightSaturationEnabled
            || surface._cascadeDropOutline !== this.outlineBlocksEnabled;

        if (!dirty) return;

        const width = board.cols * size;
        const height = board.rows * size;
        surface.cascadeDrop.resize(width, height);

        const ctx = surface.cascadeDrop.ctx;
        ctx.clearRect(0, 0, width, Math.max(1, height));

        const segments = [];
        for (let x = 0; x < board.cols; x++) {
            let runStart = -1;
            let runDrop = 0;

            const flushRun = (endExclusive) => {
                if (runStart === -1) return;
                segments.push({x, top: runStart, height: endExclusive - runStart, dropAmount: runDrop});
                runStart = -1;
            };

            for (let y = 0; y < board.rows; y++) {
                const drop = dropGrid[y * board.cols + x] || 0;
                if (runStart === -1) {
                    runStart = y;
                    runDrop = drop;
                } else if (drop !== runDrop) {
                    flushRun(y);
                    runStart = y;
                    runDrop = drop;
                }
            }

            flushRun(board.rows);
        }

        for (const segment of segments) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(segment.x * size, segment.top * size, size, segment.height * size);
            ctx.clip();
            for (let y = segment.top; y < segment.top + segment.height; y++) {
                const colorIndex = board.colors[y * board.cols + segment.x];
                if (!colorIndex) continue;
                this.drawCell(ctx, segment.x, y, this.colorPalette[colorIndex], size, {level: this.saturationLevelForRow(y, board.rows)});
            }
            ctx.restore();
        }

        surface._cascadeDropSegments = segments;
        surface._cascadeDropVersion = board.version;
        surface._cascadeDropSize = size;
        surface._cascadeDropGridRef = dropGrid;
        surface._cascadeDropSat = this.heightSaturationEnabled;
        surface._cascadeDropOutline = this.outlineBlocksEnabled;
    }

    drawCascadeFallFrame(board, dropGrid, progress, surface = this) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx, boardCanvas} = surface;

        const t = Math.min(1, Math.max(0, progress));
        const eased = 1 - Math.pow(1 - t, 3);

        this._ensureCascadeDropCache(surface, board, size, dropGrid);
        if (this.gridEnabled) this._ensureClearingGridCache(surface, board, size);

        ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
        if (this.gridEnabled) ctx.drawImage(surface.clearingGrid.canvas, 0, 0);

        const colWidth = size;
        for (const segment of surface._cascadeDropSegments) {
            const dy = segment.top * size - segment.dropAmount * size * (1 - eased);
            const segHeight = segment.height * size;
            ctx.drawImage(
                surface.cascadeDrop.canvas,
                segment.x * size, segment.top * size, colWidth, segHeight,
                segment.x * size, dy, colWidth, segHeight,
            );
        }
    }

    drawClearingFrame(board, lineIndices, dropRows, fragments, progress, surface = this) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx, boardCanvas} = surface;

        const p = Math.min(1, progress);
        const flashEnd = LINE_CLEAR_FLASH_PHASE_FRACTION;
        const maskStart = flashEnd * 0.5;

        const fallProgress = p < flashEnd
            ? 0
            : (flashEnd >= 1 ? 1 : Math.min(1, (p - flashEnd) / (1 - flashEnd)));

        const cols = board.cols;
        const halfCols = Math.ceil(cols / 2);
        const wipeT = p <= maskStart ? 0 : Math.min(1, (p - maskStart) / (flashEnd - maskStart));
        const colReached = new Uint8Array(cols);
        const colFlash = new Float32Array(cols);
        const colParticleProgress = new Float32Array(cols).fill(-1);
        for (let x = 0; x < cols; x++) {
            const d = Math.min(x, cols - 1 - x);
            const reachStart = d / halfCols;
            const reachEnd = (d + 1) / halfCols;
            if (wipeT <= reachStart) continue;

            colReached[x] = 1;
            colFlash[x] = wipeT >= reachEnd ? 0 : 1 - (wipeT - reachStart) / (reachEnd - reachStart);

            const reachEndAbsolute = maskStart + reachEnd * (flashEnd - maskStart);
            colParticleProgress[x] = reachEndAbsolute >= 1
                ? 1
                : Math.max(0, Math.min(1, (p - reachEndAbsolute) / (1 - reachEndAbsolute)));
        }

        const affectedMaxRow = lineIndices.length ? Math.max(...lineIndices) : -1;
        const staticFromRow = affectedMaxRow + 1;
        this._ensureClearingStaticBackground(surface, board, size, staticFromRow);
        this._ensureClearingAboveCache(surface, board, size, affectedMaxRow, lineIndices, dropRows);
        if (this.gridEnabled) this._ensureClearingGridCache(surface, board, size);

        ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);

        if (this.gridEnabled) ctx.drawImage(surface.clearingGrid.canvas, 0, 0);

        const width = board.cols * size;
        for (const segment of surface._clearingAboveSegments) {
            const dy = segment.top * size + segment.dropAmount * size * fallProgress;
            const segHeight = segment.height * size;
            ctx.drawImage(
                surface.clearingAbove.canvas,
                0, segment.top * size, width, segHeight,
                0, dy, width, segHeight,
            );
        }

        for (const y of lineIndices) {
            for (let x = 0; x < cols; x++) {
                if (colReached[x]) continue;
                const colorIndex = board.colors[y * cols + x];
                if (!colorIndex) continue;
                const level = this.saturationLevelForRow(y, board.rows);
                this.drawCell(ctx, x, y, this.colorPalette[colorIndex], size, {level});
            }
        }

        if (staticFromRow < board.rows) ctx.drawImage(surface.clearingStatic.canvas, 0, staticFromRow * size);

        if (this.particlesEnabled) this.drawFragments(ctx, fragments, colParticleProgress);

        if (p < flashEnd) this.drawClearingFlash(lineIndices, colFlash, {ctx, size, cols});
    }

    drawRotationIndicator(piece, direction, surface = this) {
        if (!piece || !direction) return;

        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = surface;
        const pivotX = piece.pivotX ?? (piece.width / 2);
        const pivotY = piece.pivotY ?? (piece.height / 2);
        const cx = (piece.x + pivotX) * size;
        const cy = (piece.y + pivotY) * size;
        const lengths = [0.5, 0.3, 0.12];
        const totalArc = Math.PI * (220 / 180);
        const tipAngle = -Math.PI / 2;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(2, size * 0.07);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = piece.color;

        for (let i = 0; i < lengths.length; i++) {
            const radius = size * (1.65 + i * 0.28);
            const arc = totalArc * lengths[i];
            const startAngle = direction > 0
                ? tipAngle - arc
                : tipAngle + arc;

            ctx.beginPath();
            ctx.arc(0, 0, radius, startAngle, tipAngle, direction < 0);
            ctx.stroke();
        }

        ctx.restore();
    }

    drawPiece(piece, board, surface = this) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = surface;
        const angle = piece.renderAngle || 0;
        const scale = piece.renderScale || 1;
        const transformed = angle !== 0 || scale !== 1;

        if (transformed) {
            const pivotX = piece.pivotX ?? (piece.width / 2);
            const pivotY = piece.pivotY ?? (piece.height / 2);
            const cx = (piece.x + pivotX) * size;
            const cy = (piece.y + pivotY) * size;

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle * Math.PI / 180);
            if (scale !== 1) ctx.scale(scale, scale);
            ctx.translate(-cx, -cy);
        }

        const renderMask = piece.renderMask ?? piece.mask;
        forEachShapeCell(renderMask, piece.width, piece.height, (r, c) => {
            const y = piece.y + r;
            if (y < 0 && !transformed) return;
            const level = board ? this.saturationLevelForRow(Math.round(y), board.rows) : 0;
            this.drawCell(ctx, piece.x + c, y, piece.color, size, {glow: true, level});
        });

        if (transformed) ctx.restore();
    }

    drawFallTrail(trail, headIndex, count, surface = this) {
        if (count === 0) return;

        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = surface;
        const capacity = trail.length;
        const alphas = FALL_TRAIL_ALPHA_CACHE[count];

        ctx.save();
        for (let i = 0; i < count; i++) {
            const alpha = alphas[i];
            if (alpha <= 0.02) break;

            const idx = (headIndex - 1 - i + capacity * 2) % capacity;
            const snap = trail[idx];
            if (!snap.mask) continue;

            ctx.globalAlpha = alpha;
            const sprite = this.spriteCache.getFallTrail(snap.color, size, this.outlineBlocksEnabled);
            const offset = sprite ? (sprite.width - size) / 2 : 0;
            forEachShapeCell(snap.mask, snap.width, snap.height, (r, c) => {
                const x = snap.x + c;
                const y = snap.y + r;
                if (y < 0) return;
                if (sprite) {
                    ctx.drawImage(sprite, x * size - offset, y * size - offset);
                } else {
                    ctx.fillStyle = fallTrailColor(snap.color);
                    ctx.fillRect(x * size, y * size, size, size);
                }
            });
        }
        ctx.restore();
    }

    drawHardDropTrail(entries, progress, surface = this) {
        if (!entries || entries.length === 0) return;

        const size = this.boardConfig.CELL_SIZE;
        const rows = this.boardConfig.ROWS;
        const {ctx} = surface;
        const count = entries.length;
        const fade = 1 - Math.min(1, progress);

        ctx.save();
        for (let i = 0; i < count; i++) {
            const entry = entries[i];
            if (!entry.mask) continue;

            const alpha = (HARD_DROP_TRAIL_ALPHAS[i] ?? 0) * fade;
            if (alpha <= 0.02) break;

            ctx.globalAlpha = alpha;
            forEachShapeCell(entry.mask, entry.width, entry.height, (r, c) => {
                const x = entry.x + c;
                const y = entry.y + r;
                if (y < 0) return;
                const level = this.saturationLevelForRow(Math.round(y), rows);
                const sprite = this.spriteCache.getHardDropTrail(entry.color, size, level, this.outlineBlocksEnabled);
                if (sprite) {
                    const offset = (sprite.width - size) / 2;
                    ctx.drawImage(sprite, x * size - offset, y * size - offset);
                } else {
                    ctx.fillStyle = hardDropTrailColor(entry.color, level);
                    ctx.fillRect(x * size, y * size, size, size);
                }
            });
        }
        ctx.restore();
    }

    drawHardDropImpactFlash(entry, progress, surface = this) {
        if (!entry || !entry.mask || progress >= 1) return;

        this.drawImpactFlash(entry, progress, surface);
        this.drawHardDropImpactSparks(entry, progress, surface);
    }

    drawLockImpactFlash(entry, progress, surface = this) {
        if (!entry || !entry.mask || progress >= 1) return;

        this.drawImpactFlash(entry, progress, surface);
    }

    drawImpactFlash(entry, progress, surface = this) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = surface;

        const pieceTop = entry.y * size;
        const pieceHeight = entry.height * size;
        const bandHeight = Math.max(size * 1.8, pieceHeight * 1.4);
        const travel = pieceHeight + bandHeight;
        const centerY = pieceTop + pieceHeight - progress * travel + bandHeight / 2;
        const alpha = 1 - progress;

        ctx.save();

        ctx.beginPath();
        forEachShapeCell(entry.mask, entry.width, entry.height, (r, c) => {
            ctx.rect((entry.x + c) * size, (entry.y + r) * size, size, size);
        });
        ctx.clip();

        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = alpha;

        const sprite = this.spriteCache.getHardDropFlash();
        ctx.drawImage(
            sprite, 0, 0, 1, HARD_DROP_FLASH_SPRITE_HEIGHT,
            entry.x * size, centerY - bandHeight / 2, entry.width * size, bandHeight,
        );
        ctx.restore();
    }

    drawHardDropImpactSparks(entry, progress, surface = this) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = surface;
        const alpha = 1 - progress;
        if (alpha <= 0.02) return;

        const originX = (entry.x + entry.width / 2) * size;
        const originY = (entry.y + entry.height) * size;

        const sparks = [
            {dx: -0.55, dy: 0.85},
            {dx: -0.85, dy: 0.55},
            {dx: 0.55, dy: 0.85},
            {dx: 0.85, dy: 0.55},
            {dx: -0.75, dy: -0.7, big: true},
            {dx: 0.75, dy: -0.7, big: true},
        ];

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.lineCap = "round";
        ctx.strokeStyle = `oklch(1 0 0 / ${alpha})`;

        for (const spark of sparks) {
            const length = size * (spark.big ? 0.9 : 0.5);
            const travel = size * (spark.big ? 1.6 : 1.0) * progress;
            const startX = originX + spark.dx * travel;
            const startY = originY + spark.dy * travel;
            const endX = startX + spark.dx * length;
            const endY = startY + spark.dy * length;

            ctx.lineWidth = spark.big ? Math.max(2, size * 0.09) : Math.max(1.5, size * 0.06);
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
        }

        ctx.restore();
    }

    drawGhost(piece, board, surface = this) {
        if (this.ghostType === "off") return;

        const offset = board.getDropOffset(piece);
        if (offset <= GHOST_MIN_DROP_ROWS) return;

        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = surface;

        if (this.ghostType === "radioactive") {
            const sprite = this.spriteCache.getOutlineGhost(piece.color, size, 0);
            const spriteOffset = (sprite.width - size) / 2;
            const applyOpacity = this.transparencyEnabled;
            if (applyOpacity) {
                ctx.save();
                ctx.globalAlpha *= this.ghostOpacity;
            }
            forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
                const y = piece.y + r + offset;
                if (y < 0) return;
                ctx.drawImage(sprite, (piece.x + c) * size - spriteOffset, y * size - spriteOffset);
            });
            if (applyOpacity) ctx.restore();
            return;
        }

        const baseColor = this.ghostType === "white" ? GHOST_WHITE_COLOR : piece.color;
        const lightColor = this.ghostType === "white" ? GHOST_WHITE_COLOR : lightenOklch(baseColor);

        if (this.transparencyEnabled) {
            ctx.save();
            ctx.globalAlpha *= this.ghostOpacity;
            forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
                const y = piece.y + r + offset;
                if (y < 0) return;
                const level = this.saturationLevelForRow(y, board.rows);
                this.drawCell(ctx, piece.x + c, y, baseColor, size, {level});
            });
            ctx.restore();
        } else {
            forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
                const y = piece.y + r + offset;
                if (y < 0) return;
                const level = this.saturationLevelForRow(y, board.rows);
                this.drawCell(ctx, piece.x + c, y, lightColor, size, {level});
            });
        }

        ctx.lineWidth = 1;
        const ghostRadius = cornerRadiusForSize(size);
        forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
            const y = piece.y + r + offset;
            if (y < 0) return;
            const x = piece.x + c;
            const level = this.saturationLevelForRow(y, board.rows);
            const strokeColor = withAlpha(colorForLevel(baseColor, level), 0.6);
            ctx.strokeStyle = strokeColor;
            ctx.beginPath();
            ctx.roundRect(x * size + 0.5, y * size + 0.5, size - 1, size - 1, Math.max(0, ghostRadius - 0.5));
            ctx.stroke();
        });
    }

    drawClearingFlash(lineIndices, colFlash, {
        ctx = this.ctx,
        size = this.boardConfig.CELL_SIZE,
        cols = this.boardConfig.COLS
    } = {}) {
        ctx.save();

        for (let x = 0; x < cols; x++) {
            const alpha = colFlash[x];
            if (alpha <= 0) continue;

            ctx.shadowColor = this.glowEnabled ? `oklch(1 0 0 / ${alpha})` : "transparent";
            ctx.shadowBlur = this.glowEnabled ? size * 0.6 : 0;
            ctx.fillStyle = `oklch(1 0 0 / ${alpha})`;

            lineIndices.forEach((y) => {
                ctx.fillRect(x * size, y * size, size, size);
            });
        }

        ctx.restore();
    }

    getBannerAnchorY(board, surface = this) {
        const {boardCanvas} = surface;
        const {boardConfig} = this;
        const size = boardConfig.CELL_SIZE;
        const highestRow = board?.getHighestOccupiedRow() ?? 2;
        const anchorRow = board && highestRow < board.rows ? highestRow : 2;
        return Math.min(anchorRow * size, boardCanvas.height - size);
    }

    getRotatedHalfExtentY(boxWidth, boxHeight, angleRad) {
        return (boxWidth / 2) * Math.abs(Math.sin(angleRad)) + (boxHeight / 2) * Math.abs(Math.cos(angleRad));
    }

    getLevelUpBannerMetrics(level, surface = this) {
        const {ctx} = surface;
        const {boardConfig} = this;
        const fontSize = Math.max(12, Math.round(boardConfig.CELL_SIZE * 1.2));
        const text = this.i18n ? this.i18n.t("game.levelUpBanner", {level}) : `LEVEL ${level}`;
        const fontBody = getComputedStyle(document.documentElement)
            .getPropertyValue("--font-body")
            .trim();

        ctx.save();
        ctx.font = `bold ${fontSize}px ${fontBody}`;
        const paddingX = fontSize * 0.6;
        const paddingY = fontSize * 0.35;
        const textWidth = ctx.measureText(text).width;
        ctx.restore();

        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = fontSize + paddingY * 2;
        return {fontSize, fontBody, text, boxWidth, boxHeight, halfVertical: boxHeight / 2};
    }

    getComboBannerMetrics(combo, surface = this) {
        const {ctx} = surface;
        const {boardConfig} = this;
        const fontSize = Math.max(12, Math.round(boardConfig.CELL_SIZE * 0.8));
        const text = this.i18n ? this.i18n.t("game.comboBanner", {combo}) : `COMBO x${combo}`;
        const fontBody = getComputedStyle(document.documentElement)
            .getPropertyValue("--font-body")
            .trim();

        ctx.save();
        ctx.font = `bold ${fontSize}px ${fontBody}`;
        const paddingX = fontSize * 0.6;
        const paddingY = fontSize * 0.35;
        const textWidth = ctx.measureText(text).width;
        ctx.restore();

        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = fontSize + paddingY * 2;
        const tiltAngle = Math.PI / 4;
        const halfVerticalRotated = this.getRotatedHalfExtentY(boxWidth, boxHeight, tiltAngle);
        const halfHorizontalRotated = (boxWidth / 2) * Math.abs(Math.cos(tiltAngle))
            + (boxHeight / 2) * Math.abs(Math.sin(tiltAngle));
        return {
            fontSize,
            fontBody,
            text,
            boxWidth,
            boxHeight,
            tiltAngle,
            halfVertical: halfVerticalRotated,
            halfHorizontal: halfHorizontalRotated
        };
    }

    resolveBannerCenters(board, surface = this, levelInfo = null, comboInfo = null) {
        const {boardCanvas} = surface;
        const anchorY = this.getBannerAnchorY(board, surface);
        const gap = 8;
        let levelCenterY = null;
        let comboCenterY = null;

        if (levelInfo) {
            const {halfVertical} = levelInfo.metrics;
            const minCenterY = halfVertical + 4;
            const maxCenterY = boardCanvas.height - halfVertical - 4;
            levelCenterY = Math.min(Math.max(anchorY - halfVertical - 4, minCenterY), maxCenterY);
        }

        if (comboInfo) {
            const {halfVertical} = comboInfo.metrics;
            const minCenterY = halfVertical + 4;
            const maxCenterY = boardCanvas.height - halfVertical - 4;
            comboCenterY = Math.min(Math.max(anchorY + halfVertical + 4, minCenterY), maxCenterY);
        }

        if (levelCenterY !== null && comboCenterY !== null) {
            const requiredGap = levelInfo.metrics.halfVertical + comboInfo.metrics.halfVertical + gap;
            const currentGap = comboCenterY - levelCenterY;
            if (currentGap < requiredGap) {
                const deficit = requiredGap - currentGap;
                const comboMaxCenterY = boardCanvas.height - comboInfo.metrics.halfVertical - 4;
                comboCenterY = Math.min(comboCenterY + deficit, comboMaxCenterY);
                const remaining = requiredGap - (comboCenterY - levelCenterY);
                if (remaining > 0) {
                    const levelMinCenterY = levelInfo.metrics.halfVertical + 4;
                    levelCenterY = Math.max(levelCenterY - remaining, levelMinCenterY);
                }
            }
        }

        return {levelCenterY, comboCenterY};
    }

    drawBanners(board, surface = this, level = null, combo = null) {
        const levelInfo = level !== null ? {metrics: this.getLevelUpBannerMetrics(level, surface)} : null;
        const comboInfo = combo !== null ? {metrics: this.getComboBannerMetrics(combo, surface)} : null;
        const {levelCenterY, comboCenterY} = this.resolveBannerCenters(board, surface, levelInfo, comboInfo);

        if (levelInfo) {
            this.drawLevelUpBanner(level, board, surface, levelCenterY);
        }
        if (comboInfo) {
            this.drawComboBanner(combo, board, surface, comboCenterY);
        }
    }

    drawLevelUpBanner(level, board, surface = this, centerYOverride = null) {
        const {ctx, boardCanvas} = surface;
        const {boardConfig} = this;
        const centerX = boardCanvas.width / 2;
        const fontSize = Math.max(12, Math.round(boardConfig.CELL_SIZE * 0.9));
        const text = this.i18n ? this.i18n.t("game.levelUpBanner", {level}) : `LEVEL ${level}`;
        const fontBody = getComputedStyle(document.documentElement)
            .getPropertyValue("--font-body")
            .trim();

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `bold ${fontSize}px ${fontBody}`;

        const paddingX = fontSize * 0.6;
        const paddingY = fontSize * 0.35;
        const textWidth = ctx.measureText(text).width;
        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = fontSize + paddingY * 2;
        const halfVertical = boxHeight / 2;
        let centerY = centerYOverride;
        if (centerY === null) {
            const anchorY = this.getBannerAnchorY(board, surface);
            const maxCenterY = boardCanvas.height - halfVertical - 4;
            const minCenterY = halfVertical + 4;
            centerY = Math.min(Math.max(anchorY - halfVertical - 4, minCenterY), maxCenterY);
        }

        ctx.shadowBlur = 8;
        ctx.fillStyle = "oklch(0.15 0.01 90 / 0.72)";
        ctx.beginPath();
        ctx.roundRect(centerX - boxWidth / 2, centerY - boxHeight / 2, boxWidth, boxHeight, fontSize * 0.2);
        ctx.fill();

        if (this.glowEnabled) {
            ctx.shadowBlur = fontSize * 0.25;
            ctx.shadowColor = "oklch(0.491 0.064 124.064 / 0.85)";
        } else {
            ctx.shadowBlur = 0;
        }

        ctx.lineWidth = Math.max(2, fontSize * 0.12);
        ctx.strokeStyle = "oklch(0.1 0 0 / 0.85)";
        ctx.strokeText(text, centerX, centerY);

        ctx.fillStyle = "oklch(0.97 0.04 95)";
        ctx.fillText(text, centerX, centerY);
        ctx.restore();
    }

    drawComboBanner(combo, board, surface = this, centerYOverride = null) {
        const {ctx, boardCanvas} = surface;
        const {boardConfig} = this;
        const fontSize = Math.max(12, Math.round(boardConfig.CELL_SIZE * 0.8));
        const text = this.i18n ? this.i18n.t("game.comboBanner", {combo}) : `COMBO x${combo}`;
        const fontBody = getComputedStyle(document.documentElement)
            .getPropertyValue("--font-body")
            .trim();

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `bold ${fontSize}px ${fontBody}`;

        const paddingX = fontSize * 0.6;
        const paddingY = fontSize * 0.35;
        const textWidth = ctx.measureText(text).width;
        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = fontSize + paddingY * 2;
        const tiltAngle = Math.PI / 4;
        const halfVerticalRotated = this.getRotatedHalfExtentY(boxWidth, boxHeight, tiltAngle);
        const halfHorizontalRotated = (boxWidth / 2) * Math.abs(Math.cos(tiltAngle))
            + (boxHeight / 2) * Math.abs(Math.sin(tiltAngle));
        let centerY = centerYOverride;
        if (centerY === null) {
            const anchorY = this.getBannerAnchorY(board, surface);
            const maxCenterY = boardCanvas.height - halfVerticalRotated - 4;
            const minCenterY = halfVerticalRotated + 4;
            centerY = Math.min(Math.max(anchorY + halfVerticalRotated + 4, minCenterY), maxCenterY);
        }
        const centerX = Math.max(boardCanvas.width - halfHorizontalRotated - 4, halfHorizontalRotated + 4);

        ctx.translate(centerX, centerY);
        ctx.rotate(tiltAngle);

        ctx.shadowBlur = 8;
        ctx.fillStyle = "oklch(0.15 0.01 90 / 0.72)";
        ctx.beginPath();
        ctx.roundRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, fontSize * 0.2);
        ctx.fill();

        if (this.glowEnabled) {
            ctx.shadowBlur = fontSize * 0.25;
            ctx.shadowColor = "oklch(0.3706 0.1479 24.04 / 0.85)";
        } else {
            ctx.shadowBlur = 0;
        }

        ctx.lineWidth = Math.max(2, fontSize * 0.12);
        ctx.strokeStyle = "oklch(0.1 0 0 / 0.85)";
        ctx.strokeText(text, 0, 0);

        ctx.fillStyle = "oklch(0.82 0.16 71.488)";
        ctx.fillText(text, 0, 0);
        ctx.restore();
    }

    /**
     * Draws the upcoming-pieces queue, one piece per canvas.
     *
     * @param {Array<string|null>} types - upcoming piece types, index 0 = soonest to spawn
     */
    drawNext(types = []) {
        const {nextCtxs, nextCanvases, nextPreviewCellSize} = this;
        nextCanvases.forEach((nextCanvas, i) => {
            const nextCtx = nextCtxs[i];
            if (!nextCtx) return;
            nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);

            const type = types[i];
            if (!type) return;

            const {states, width, height, color} = this.klockominos[type];
            const mask = states[0];
            const bounds = getTightBounds(mask, width, height);
            const offsetX = (nextCanvas.width / nextPreviewCellSize - bounds.width) / 2 - bounds.minX;
            const offsetY = (nextCanvas.height / nextPreviewCellSize - bounds.height) / 2 - bounds.minY;

            forEachShapeCell(mask, width, height, (r, c) => {
                this.drawCell(nextCtx, offsetX + c, offsetY + r, color, nextPreviewCellSize, {cache: this.nextSpriteCache});
            });
        });
    }
}
