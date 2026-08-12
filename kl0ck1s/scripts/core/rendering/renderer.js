"use strict";

import {forEachShapeCell, getTightBounds, lightenOklch, withAlpha} from "../shared/utils.js";
import {FALL_TRAIL_ALPHA_CACHE, HARD_DROP_TRAIL_ALPHAS} from "../game/game-constants.js";
import {LINE_CLEAR_FLASH_PHASE_FRACTION} from "../shared/config.js";
import {fallTrailColor, GHOST_ALPHA, hardDropTrailColor, SATURATION_LEVELS} from "./sprite-cache.js";

export class Renderer {
    /**
     * @param {object} deps
     * @param {HTMLBodyElement} bodyEl
     * @param {CanvasRenderingContext2D} deps.ctx
     * @param {HTMLCanvasElement} deps.boardCanvas
     * @param {CanvasRenderingContext2D} deps.nextCtx
     * @param {HTMLCanvasElement} deps.nextCanvas
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
                    nextCtx,
                    nextCanvas,
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
        this.nextCtx = nextCtx;
        this.nextCanvas = nextCanvas;
        this.spriteCache = spriteCache;
        this.nextSpriteCache = nextSpriteCache;
        this.boardConfig = boardConfig;
        this.klockominos = klockominos;
        this.colorPalette = colorPalette;
        this.nextPreviewCellSize = nextPreviewCellSize;
        this.i18n = i18n;
        this.glowEnabled = true;
        this.transparencyEnabled = true;
        this.ghostEnabled = true;
        this.gridEnabled = true;
        this.shakeEnabled = true;
        this.heightSaturationEnabled = true;
        this.particlesEnabled = true;
        this._boardOffsetX = 0;
        this._boardOffsetY = 0;
        this.boardCanvasRect = null;
        this._boardScaleX = 1;

        Object.assign(this, this.createSurface(ctx, boardCanvas));

        this._onWindowResize = () => this.refreshBoardCanvasRect();
        window.addEventListener("resize", this._onWindowResize);
    }

    createSurface(ctx, boardCanvas) {
        const backgroundCanvas = document.createElement("canvas");
        const clearingStaticCanvas = document.createElement("canvas");
        const clearingAboveCanvas = document.createElement("canvas");
        const clearingGridCanvas = document.createElement("canvas");

        return {
            ctx,
            boardCanvas,

            backgroundCanvas,
            backgroundCtx: backgroundCanvas.getContext("2d"),
            _bgVersion: -1,
            _bgSize: 0,
            _bgGrid: null,
            _bgRows: 0,
            _bgCols: 0,
            _bgSat: null,

            _clearingStaticCanvas: clearingStaticCanvas,
            _clearingStaticCtx: clearingStaticCanvas.getContext("2d"),
            _clearingStaticVersion: -1,
            _clearingStaticSize: 0,
            _clearingStaticFromRow: -1,
            _clearingStaticSat: null,

            _clearingAboveCanvas: clearingAboveCanvas,
            _clearingAboveCtx: clearingAboveCanvas.getContext("2d"),
            _clearingAboveVersion: -1,
            _clearingAboveSize: 0,
            _clearingAboveSat: null,
            _clearingAboveLineIndicesRef: null,
            _clearingAboveDropRowsRef: null,
            _clearingAboveSegments: [],

            _clearingGridCanvas: clearingGridCanvas,
            _clearingGridCtx: clearingGridCanvas.getContext("2d"),
            _clearingGridSize: 0,
            _clearingGridRows: 0,
            _clearingGridCols: 0,
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

    setGhostEnabled(enabled) {
        this.ghostEnabled = enabled;
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
        };
    }

    /**
     * Draws a line-clear particle burst onto any canvas context.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {ReturnType<Renderer["buildClearFragments"]>} fragments
     * @param {number} particleProgress - 0..1
     */
    drawFragments(ctx, fragments, particleProgress) {
        if (!fragments || !fragments.count) return;

        const {count, startX, startY, dx, dy, rotation0, dRotation, size, halfSize, colorIndex, colors} = fragments;
        const fragmentAlpha = 0.75 * (1 - particleProgress);

        ctx.save();
        ctx.globalAlpha = fragmentAlpha;

        for (let i = 0; i < count; i++) {
            const x = startX[i] + dx[i] * particleProgress;
            const y = startY[i] + dy[i] * particleProgress;
            const rotation = rotation0[i] + dRotation[i] * particleProgress;
            const cos = Math.cos(rotation);
            const sin = Math.sin(rotation);
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
        bodyClasses.remove("body--theme-none", "body--theme-matrix", "body--theme-rain", "body--theme-snow", "body--theme-vhs");
        bodyClasses.add(`body--theme-${theme || "none"}`);
    }

    drawCell(context, x, y, color, size, {glow = false, ghost = false, level = 0, cache = this.spriteCache} = {}) {
        glow = glow && this.glowEnabled;

        if (glow) {
            const sprite = cache.getGlow(color, size, level);
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
            context.globalAlpha *= GHOST_ALPHA;
        }

        context.drawImage(region.image, region.sx, region.sy, region.sw, region.sh, x * size, y * size, size, size);

        if (ghost)
            context.restore();
    }

    drawGrid(board, context = this.ctx, fromRow = 0, toRow = board.rows - 1) {
        const size = this.boardConfig.CELL_SIZE;
        const sprite = this.spriteCache.getGridCell(size);

        for (let y = fromRow; y <= toRow; y++) {
            for (let x = 0; x < board.cols; x++) {
                context.drawImage(sprite, x * size, y * size, size, size);
            }
        }
    }

    _backgroundConfigCurrent(surface, board, size) {
        return surface._bgSize === size
            && surface._bgGrid === this.gridEnabled
            && surface._bgRows === board.rows
            && surface._bgCols === board.cols
            && surface._bgSat === this.heightSaturationEnabled;
    }

    _stampBackgroundConfig(surface, board, size) {
        surface._bgSize = size;
        surface._bgGrid = this.gridEnabled;
        surface._bgRows = board.rows;
        surface._bgCols = board.cols;
        surface._bgSat = this.heightSaturationEnabled;
    }

    updateBoardBackground(board, size, surface = this) {
        const dirty = surface._bgVersion !== board.version || !this._backgroundConfigCurrent(surface, board, size);
        if (!dirty) return;

        this.spriteCache.warmGlow(size, this.heightSaturationEnabled);

        const width = board.cols * size;
        const height = board.rows * size;
        if (surface.backgroundCanvas.width !== width) surface.backgroundCanvas.width = width;
        if (surface.backgroundCanvas.height !== height) surface.backgroundCanvas.height = height;

        const bgCtx = surface.backgroundCtx;
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

        const color = this.colorPalette[piece.colorIndex];
        const bgCtx = surface.backgroundCtx;
        forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
            const y = piece.y + r;
            if (y < 0) return;
            const x = piece.x + c;
            this.drawCell(bgCtx, x, y, color, size, {level: this.saturationLevelForRow(y, board.rows)});
        });

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

        const affectedMaxRow = Math.max(...clearedRowIndices);
        const width = board.cols * size;
        const bgCtx = surface.backgroundCtx;

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
            || surface._clearingStaticSat !== this.heightSaturationEnabled;

        if (!dirty) return;

        const rowsCount = Math.max(0, board.rows - staticFromRow);
        const width = board.cols * size;
        const height = rowsCount * size;
        if (surface._clearingStaticCanvas.width !== width) surface._clearingStaticCanvas.width = width;
        if (surface._clearingStaticCanvas.height !== height) surface._clearingStaticCanvas.height = height;

        const sCtx = surface._clearingStaticCtx;
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
    }

    _ensureClearingGridCache(surface, board, size) {
        const dirty = surface._clearingGridSize !== size
            || surface._clearingGridRows !== board.rows
            || surface._clearingGridCols !== board.cols;

        if (!dirty) return;

        const width = board.cols * size;
        const height = board.rows * size;
        if (surface._clearingGridCanvas.width !== width) surface._clearingGridCanvas.width = width;
        if (surface._clearingGridCanvas.height !== height) surface._clearingGridCanvas.height = height;

        const gCtx = surface._clearingGridCtx;
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
        ctx.drawImage(surface.backgroundCanvas, 0, 0);
    }

    _ensureClearingAboveCache(surface, board, size, affectedMaxRow, lineIndices, dropRows) {
        const dirty = surface._clearingAboveVersion !== board.version
            || surface._clearingAboveSize !== size
            || surface._clearingAboveLineIndicesRef !== lineIndices
            || surface._clearingAboveDropRowsRef !== dropRows
            || surface._clearingAboveSat !== this.heightSaturationEnabled;

        if (!dirty) return;

        const clearingSet = new Set(lineIndices);
        const width = board.cols * size;
        const height = (affectedMaxRow + 1) * size;
        if (surface._clearingAboveCanvas.width !== width) surface._clearingAboveCanvas.width = width;
        if (surface._clearingAboveCanvas.height !== Math.max(1, height)) {
            surface._clearingAboveCanvas.height = Math.max(1, height);
        }

        const ctx = surface._clearingAboveCtx;
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

            for (let x = 0; x < board.cols; x++) {
                const colorIndex = board.colors[y * board.cols + x];
                if (!colorIndex) continue;
                this.drawCell(ctx, x, y, this.colorPalette[colorIndex], size, {level: this.saturationLevelForRow(y, board.rows)});
            }
        }
        flushRun(affectedMaxRow + 1);

        surface._clearingAboveSegments = segments;
        surface._clearingAboveVersion = board.version;
        surface._clearingAboveSize = size;
        surface._clearingAboveLineIndicesRef = lineIndices;
        surface._clearingAboveDropRowsRef = dropRows;
        surface._clearingAboveSat = this.heightSaturationEnabled;
    }

    drawClearingFrame(board, lineIndices, dropRows, fragments, progress, surface = this) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx, boardCanvas} = surface;

        const p = Math.min(1, progress);
        const flashEnd = this.particlesEnabled ? LINE_CLEAR_FLASH_PHASE_FRACTION : 1;
        const maskStart = flashEnd * 0.5;
        const fallProgress = p < maskStart ? 0 : Math.min(1, (p - maskStart) / (1 - maskStart));
        const rowsGone = p >= maskStart;

        const affectedMaxRow = lineIndices.length ? Math.max(...lineIndices) : -1;
        const staticFromRow = affectedMaxRow + 1;
        this._ensureClearingStaticBackground(surface, board, size, staticFromRow);
        this._ensureClearingAboveCache(surface, board, size, affectedMaxRow, lineIndices, dropRows);
        if (this.gridEnabled) this._ensureClearingGridCache(surface, board, size);

        ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);

        if (this.gridEnabled) ctx.drawImage(surface._clearingGridCanvas, 0, 0);

        const width = board.cols * size;
        for (const segment of surface._clearingAboveSegments) {
            const dy = segment.top * size + segment.dropAmount * size * fallProgress;
            const segHeight = segment.height * size;
            ctx.drawImage(
                surface._clearingAboveCanvas,
                0, segment.top * size, width, segHeight,
                0, dy, width, segHeight,
            );
        }

        if (!rowsGone) {
            for (const y of lineIndices) {
                for (let x = 0; x < board.cols; x++) {
                    const colorIndex = board.colors[y * board.cols + x];
                    if (!colorIndex) continue;
                    const level = this.saturationLevelForRow(y, board.rows);
                    this.drawCell(ctx, x, y, this.colorPalette[colorIndex], size, {level});
                }
            }
        }

        if (staticFromRow < board.rows) ctx.drawImage(surface._clearingStaticCanvas, 0, staticFromRow * size);

        if (rowsGone && this.particlesEnabled) this.drawFragments(ctx, fragments, fallProgress);

        if (p < flashEnd) {
            const flashProgress = p < maskStart ? 0 : (p - maskStart) / (flashEnd - maskStart);
            this.drawClearingFlash(lineIndices, flashProgress, {ctx, size, cols: board.cols});
        }
    }

    drawPiece(piece, board, surface = this) {
        const size = this.boardConfig.CELL_SIZE;
        forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
            const y = piece.y + r;
            if (y < 0) return;
            const level = board ? this.saturationLevelForRow(Math.round(y), board.rows) : 0;
            this.drawCell(surface.ctx, piece.x + c, y, piece.color, size, {glow: true, level});
        });
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
            const sprite = this.spriteCache.getFallTrail(snap.color, size);
            forEachShapeCell(snap.mask, snap.width, snap.height, (r, c) => {
                const x = snap.x + c;
                const y = snap.y + r;
                if (y < 0) return;
                if (sprite) {
                    ctx.drawImage(sprite, x * size, y * size, size, size);
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
                const sprite = this.spriteCache.getHardDropTrail(entry.color, size, level);
                if (sprite) {
                    ctx.drawImage(sprite, x * size, y * size, size, size);
                } else {
                    ctx.fillStyle = hardDropTrailColor(entry.color, level);
                    ctx.fillRect(x * size, y * size, size, size);
                }
            });
        }
        ctx.restore();
    }

    drawGhost(piece, board, surface = this) {
        if (!this.ghostEnabled) return;

        const offset = board.getDropOffset(piece);
        if (offset === 0) return;

        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = surface;
        const strokeColor = withAlpha(piece.color, 0.6);
        const lightColor = lightenOklch(piece.color);

        if (this.transparencyEnabled) {
            ctx.save();
            ctx.globalAlpha *= GHOST_ALPHA;
            forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
                const y = piece.y + r + offset;
                if (y < 0) return;
                const level = this.saturationLevelForRow(y, board.rows);
                this.drawCell(ctx, piece.x + c, y, piece.color, size, {level});
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

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1;
        forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
            const y = piece.y + r + offset;
            if (y < 0) return;
            const x = piece.x + c;
            ctx.strokeRect(x * size + 0.5, y * size + 0.5, size - 1, size - 1);
        });
    }

    drawClearingFlash(lineIndices, progress, {
        ctx = this.ctx,
        size = this.boardConfig.CELL_SIZE,
        cols = this.boardConfig.COLS
    } = {}) {
        const EXPAND_FRACTION = 0.45;
        const expandT = Math.min(1, progress / EXPAND_FRACTION);
        const fadeT = progress <= EXPAND_FRACTION ? 0 : (progress - EXPAND_FRACTION) / (1 - EXPAND_FRACTION);
        const eased = 1 - (1 - expandT) ** 3;

        const alpha = 1 - fadeT;
        const totalWidth = cols * size;
        const flashWidth = totalWidth * eased;
        const flashX = (totalWidth - flashWidth) / 2;

        ctx.save();
        if (this.glowEnabled) {
            ctx.shadowColor = `oklch(1 0 0 / ${alpha})`;
            ctx.shadowBlur = size * fadeT;
        }

        ctx.fillStyle = `oklch(1 0 0 / ${alpha})`;

        lineIndices.forEach((y) => {
            ctx.fillRect(flashX, y * size, flashWidth, size);
        });

        ctx.restore();
    }

    drawLevelUpBanner(level, surface = this) {
        const {ctx, boardCanvas} = surface;
        const {boardConfig} = this;
        const centerX = boardCanvas.width / 2;
        const fontSize = Math.max(12, Math.round(boardConfig.CELL_SIZE * 1.2));
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
        const centerY = boardCanvas.height / 2;

        ctx.shadowBlur = 8;
        ctx.fillStyle = "oklch(0 0 0 / 0.1)";
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
        ctx.strokeStyle = "oklch(0 0 0 / 0.2)";
        ctx.strokeText(text, centerX, centerY);

        ctx.fillStyle = "oklch(0.94 0.05 90)";
        ctx.fillText(text, centerX, centerY);
        ctx.restore();
    }

    drawNext(type) {
        const {nextCtx, nextCanvas, nextPreviewCellSize} = this;
        nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
        if (!type) return;

        const {states, width, height, color} = this.klockominos[type];
        const mask = states[0];
        const bounds = getTightBounds(mask, width, height);
        const offsetX = (nextCanvas.width / nextPreviewCellSize - bounds.width) / 2 - bounds.minX;
        const offsetY = (nextCanvas.height / nextPreviewCellSize - bounds.height) / 2 - bounds.minY;

        forEachShapeCell(mask, width, height, (r, c) => {
            this.drawCell(nextCtx, offsetX + c, offsetY + r, color, nextPreviewCellSize, {cache: this.nextSpriteCache});
        });
    }
}
