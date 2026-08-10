"use strict";

import {forEachShapeCell, getTightBounds, lightenOklch, withAlpha} from "../shared/utils.js";
import {FALL_TRAIL_ALPHA_CACHE, HARD_DROP_TRAIL_MAX_ALPHA} from "../game/game-constants.js";
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
        this._boardOffsetX = 0;
        this._boardOffsetY = 0;
        this.boardCanvasRect = null;

        this.backgroundCanvas = document.createElement("canvas");
        this.backgroundCtx = this.backgroundCanvas.getContext("2d");
        this._bgVersion = -1;
        this._bgSize = 0;
        this._bgGrid = null;
        this._bgRows = 0;
        this._bgCols = 0;
        this._bgSat = null;
        this._boardScaleX = 1;

        this._clearingStaticCanvas = document.createElement("canvas");
        this._clearingStaticCtx = this._clearingStaticCanvas.getContext("2d");
        this._clearingStaticVersion = -1;
        this._clearingStaticSize = 0;
        this._clearingStaticFromRow = -1;
        this._clearingStaticSat = null;
        this._clearingAboveCanvas = document.createElement("canvas");
        this._clearingAboveCtx = this._clearingAboveCanvas.getContext("2d");
        this._clearingAboveVersion = -1;
        this._clearingAboveSize = 0;
        this._clearingAboveSat = null;
        this._clearingAboveLineIndicesRef = null;
        this._clearingAboveDropRowsRef = null;
        this._clearingAboveSegments = [];

        this._clearingGridCanvas = document.createElement("canvas");
        this._clearingGridCtx = this._clearingGridCanvas.getContext("2d");
        this._clearingGridSize = 0;
        this._clearingGridRows = 0;
        this._clearingGridCols = 0;

        this._onWindowResize = () => this.refreshBoardCanvasRect();
        window.addEventListener("resize", this._onWindowResize);
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
        el.style.transition = `translate ${transitionMs}ms ease-out`;
        el.style.translate = `${this._boardOffsetX ?? 0}rem ${this._boardOffsetY ?? 0}rem`;
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
        this.bodyEl.dataset.theme = theme || "none";
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

    _backgroundConfigCurrent(board, size) {
        return this._bgSize === size
            && this._bgGrid === this.gridEnabled
            && this._bgRows === board.rows
            && this._bgCols === board.cols
            && this._bgSat === this.heightSaturationEnabled;
    }

    _stampBackgroundConfig(board, size) {
        this._bgSize = size;
        this._bgGrid = this.gridEnabled;
        this._bgRows = board.rows;
        this._bgCols = board.cols;
        this._bgSat = this.heightSaturationEnabled;
    }

    updateBoardBackground(board, size) {
        const dirty = this._bgVersion !== board.version || !this._backgroundConfigCurrent(board, size);
        if (!dirty) return;

        this.spriteCache.warmGlow(size, this.heightSaturationEnabled);

        const width = board.cols * size;
        const height = board.rows * size;
        if (this.backgroundCanvas.width !== width) this.backgroundCanvas.width = width;
        if (this.backgroundCanvas.height !== height) this.backgroundCanvas.height = height;

        const bgCtx = this.backgroundCtx;
        bgCtx.clearRect(0, 0, width, height);
        if (this.gridEnabled) this.drawGrid(board, bgCtx);

        for (let y = 0; y < board.rows; y++) {
            for (let x = 0; x < board.cols; x++) {
                const colorIndex = board.colors[y * board.cols + x];
                if (colorIndex) this.drawCell(bgCtx, x, y, this.colorPalette[colorIndex], size, {level: this.saturationLevelForRow(y, board.rows)});
            }
        }

        this._bgVersion = board.version;
        this._stampBackgroundConfig(board, size);
    }

    notifyPieceLocked(piece, board) {
        const size = this.boardConfig.CELL_SIZE;
        if (!this._backgroundConfigCurrent(board, size)) return;

        this.spriteCache.warmGlow(size, this.heightSaturationEnabled);

        const color = this.colorPalette[piece.colorIndex];
        const bgCtx = this.backgroundCtx;
        forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
            const y = piece.y + r;
            if (y < 0) return;
            const x = piece.x + c;
            this.drawCell(bgCtx, x, y, color, size, {level: this.saturationLevelForRow(y, board.rows)});
        });

        this._bgVersion = board.version;
    }

    notifyLinesCleared(board, clearedRowIndices) {
        const size = this.boardConfig.CELL_SIZE;
        if (!this._backgroundConfigCurrent(board, size)) return;
        if (!clearedRowIndices || clearedRowIndices.length === 0) {
            this._bgVersion = board.version;
            return;
        }

        this.spriteCache.warmGlow(size, this.heightSaturationEnabled);

        const affectedMaxRow = Math.max(...clearedRowIndices);
        const width = board.cols * size;
        const bgCtx = this.backgroundCtx;

        bgCtx.clearRect(0, 0, width, (affectedMaxRow + 1) * size);
        if (this.gridEnabled) this.drawGrid(board, bgCtx, 0, affectedMaxRow);

        for (let y = 0; y <= affectedMaxRow; y++) {
            for (let x = 0; x < board.cols; x++) {
                const colorIndex = board.colors[y * board.cols + x];
                if (colorIndex) this.drawCell(bgCtx, x, y, this.colorPalette[colorIndex], size, {level: this.saturationLevelForRow(y, board.rows)});
            }
        }

        this._bgVersion = board.version;
    }

    _ensureClearingStaticBackground(board, size, staticFromRow) {
        const dirty = this._clearingStaticVersion !== board.version
            || this._clearingStaticSize !== size
            || this._clearingStaticFromRow !== staticFromRow
            || this._clearingStaticSat !== this.heightSaturationEnabled;

        if (!dirty) return;

        const rowsCount = Math.max(0, board.rows - staticFromRow);
        const width = board.cols * size;
        const height = rowsCount * size;
        if (this._clearingStaticCanvas.width !== width) this._clearingStaticCanvas.width = width;
        if (this._clearingStaticCanvas.height !== height) this._clearingStaticCanvas.height = height;

        const sCtx = this._clearingStaticCtx;
        sCtx.clearRect(0, 0, width, height);

        for (let y = staticFromRow; y < board.rows; y++) {
            const localY = y - staticFromRow;
            for (let x = 0; x < board.cols; x++) {
                const colorIndex = board.colors[y * board.cols + x];
                if (colorIndex) this.drawCell(sCtx, x, localY, this.colorPalette[colorIndex], size, {level: this.saturationLevelForRow(y, board.rows)});
            }
        }

        this._clearingStaticVersion = board.version;
        this._clearingStaticSize = size;
        this._clearingStaticFromRow = staticFromRow;
        this._clearingStaticSat = this.heightSaturationEnabled;
    }

    _ensureClearingGridCache(board, size) {
        const dirty = this._clearingGridSize !== size
            || this._clearingGridRows !== board.rows
            || this._clearingGridCols !== board.cols;

        if (!dirty) return;

        const width = board.cols * size;
        const height = board.rows * size;
        if (this._clearingGridCanvas.width !== width) this._clearingGridCanvas.width = width;
        if (this._clearingGridCanvas.height !== height) this._clearingGridCanvas.height = height;

        const gCtx = this._clearingGridCtx;
        gCtx.clearRect(0, 0, width, height);
        this.drawGrid(board, gCtx, 0, board.rows - 1);

        this._clearingGridSize = size;
        this._clearingGridRows = board.rows;
        this._clearingGridCols = board.cols;
    }

    drawBoard(board) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = this;

        this.updateBoardBackground(board, size);

        ctx.clearRect(0, 0, this.boardCanvas.width, this.boardCanvas.height); // required for fall-trail.
        ctx.drawImage(this.backgroundCanvas, 0, 0);
    }

    _ensureClearingAboveCache(board, size, affectedMaxRow, lineIndices, dropRows) {
        const dirty = this._clearingAboveVersion !== board.version
            || this._clearingAboveSize !== size
            || this._clearingAboveLineIndicesRef !== lineIndices
            || this._clearingAboveDropRowsRef !== dropRows
            || this._clearingAboveSat !== this.heightSaturationEnabled;

        if (!dirty) return;

        const clearingSet = new Set(lineIndices);
        const width = board.cols * size;
        const height = (affectedMaxRow + 1) * size;
        if (this._clearingAboveCanvas.width !== width) this._clearingAboveCanvas.width = width;
        if (this._clearingAboveCanvas.height !== Math.max(1, height)) {
            this._clearingAboveCanvas.height = Math.max(1, height);
        }

        const ctx = this._clearingAboveCtx;
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

        this._clearingAboveSegments = segments;
        this._clearingAboveVersion = board.version;
        this._clearingAboveSize = size;
        this._clearingAboveLineIndicesRef = lineIndices;
        this._clearingAboveDropRowsRef = dropRows;
        this._clearingAboveSat = this.heightSaturationEnabled;
    }

    drawClearingFrame(board, lineIndices, dropRows, fragments, progress) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx, boardCanvas} = this;

        const p = Math.min(1, progress);
        const flashEnd = LINE_CLEAR_FLASH_PHASE_FRACTION;
        const maskStart = flashEnd * 0.5;
        const fallProgress = p < maskStart ? 0 : Math.min(1, (p - maskStart) / (1 - maskStart));
        const rowsGone = p >= maskStart;

        const affectedMaxRow = lineIndices.length ? Math.max(...lineIndices) : -1;
        const staticFromRow = affectedMaxRow + 1;
        this._ensureClearingStaticBackground(board, size, staticFromRow);
        this._ensureClearingAboveCache(board, size, affectedMaxRow, lineIndices, dropRows);
        if (this.gridEnabled) this._ensureClearingGridCache(board, size);

        ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);

        if (this.gridEnabled) ctx.drawImage(this._clearingGridCanvas, 0, 0);

        const width = board.cols * size;
        for (const segment of this._clearingAboveSegments) {
            const dy = segment.top * size + segment.dropAmount * size * fallProgress;
            const segHeight = segment.height * size;
            ctx.drawImage(
                this._clearingAboveCanvas,
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

        if (staticFromRow < board.rows) ctx.drawImage(this._clearingStaticCanvas, 0, staticFromRow * size);

        if (rowsGone) this.drawFragments(ctx, fragments, fallProgress);

        if (p < flashEnd) {
            const flashProgress = p < maskStart ? 0 : (p - maskStart) / (flashEnd - maskStart);
            this.drawClearingFlash(lineIndices, flashProgress);
        }
    }

    drawPiece(piece, board) {
        const size = this.boardConfig.CELL_SIZE;
        forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
            const y = piece.y + r;
            if (y < 0) return;
            const level = board ? this.saturationLevelForRow(y, board.rows) : 0;
            this.drawCell(this.ctx, piece.x + c, y, piece.color, size, {glow: true, level});
        });
    }

    drawFallTrail(trail, headIndex, count) {
        if (count === 0) return;

        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = this;
        const capacity = trail.length;
        const alphas = FALL_TRAIL_ALPHA_CACHE[count];

        ctx.save();
        for (let i = 0; i < count; i++) {
            const alpha = alphas[i];
            if (alpha <= 0.02) continue;

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

    drawHardDropTrail(entries, progress) {
        if (!entries || entries.length === 0) return;

        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = this;
        const count = entries.length;
        const fade = 1 - Math.min(1, progress);

        ctx.save();
        for (let i = 0; i < count; i++) {
            const entry = entries[i];
            if (!entry.mask) continue;

            const alpha = HARD_DROP_TRAIL_MAX_ALPHA * (1 - i / count) * fade;
            if (alpha <= 0.02) continue;

            ctx.globalAlpha = alpha;
            const sprite = this.spriteCache.getHardDropTrail(entry.color, size, entry.level ?? 0);
            forEachShapeCell(entry.mask, entry.width, entry.height, (r, c) => {
                const x = entry.x + c;
                const y = entry.y + r;
                if (y < 0) return;
                if (sprite) {
                    ctx.drawImage(sprite, x * size, y * size, size, size);
                } else {
                    ctx.fillStyle = hardDropTrailColor(entry.color, entry.level ?? 0);
                    ctx.fillRect(x * size, y * size, size, size);
                }
            });
        }
        ctx.restore();
    }

    drawGhost(piece, board) {
        if (!this.ghostEnabled) return;

        const offset = board.getDropOffset(piece);
        if (offset === 0) return;

        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = this;
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
        const alpha = 1 - progress;

        ctx.save();
        if (this.glowEnabled) {
            ctx.shadowColor = `oklch(1 0 0 / ${alpha})`;
            ctx.shadowBlur = size * progress;
        }

        ctx.fillStyle = `oklch(1 0 0 / ${alpha})`;

        lineIndices.forEach((y) => {
            ctx.fillRect(0, y * size, cols * size, size);
        });

        ctx.restore();
    }

    drawLevelUpBanner(level) {
        const {ctx, boardCanvas, boardConfig} = this;
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
