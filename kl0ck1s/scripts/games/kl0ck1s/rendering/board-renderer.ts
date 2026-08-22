// @ts-nocheck
import {LINE_CLEAR_FLASH_PHASE_FRACTION} from "../shared/config.js";
import {forEachShapeCell} from "../shared/utils.js";
import {HARDCORE_MASK_STYLES} from "./render-styles.js";
import type {Renderer} from "./renderer.js";

export class BoardRenderer {
    constructor(private readonly renderer: Renderer) {
    }

    _drawLockedCell(context, x, y, color, size, level = 0) {
        if (this.renderer.asciiFallingPiecesEnabled) {
            context.save();
            context.font = `bold ${Math.max(10, Math.floor(size * .62))}px monospace`;
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillStyle = color;
            context.strokeStyle = "oklch(0 0 0 / .85)";
            context.lineWidth = Math.max(1, size * .05);
            const tx = x * size + size / 2;
            const ty = y * size + size / 2;
            context.strokeText("[ ]", tx, ty);
            context.fillText("[ ]", tx, ty);
            context.restore();
            return;
        }
        this.renderer.drawCell(context, x, y, color, size, {level});
    }

    drawGrid(board, context = this.renderer.ctx, fromRow = 0, toRow = board.rows - 1, fromCol = 0, toCol = board.cols - 1) {
        const size = this.renderer.boardConfig.CELL_SIZE;
        const sprite = this.renderer.spriteCache.getGridCell(size);

        for (let y = fromRow; y <= toRow; y++) {
            for (let x = fromCol; x <= toCol; x++) {
                context.drawImage(sprite, x * size, y * size, size, size);
            }
        }
    }

    _backgroundConfigCurrent(surface, board, size) {
        return surface._bgSize === size
            && surface._bgGrid === this.renderer.gridEnabled
            && surface._bgRows === board.rows
            && surface._bgCols === board.cols
            && surface._bgSat === this.renderer.heightSaturationEnabled
            && surface._bgOutline === this.renderer.outlineBlocksEnabled;
    }

    _stampBackgroundConfig(surface, board, size) {
        surface._bgSize = size;
        surface._bgGrid = this.renderer.gridEnabled;
        surface._bgRows = board.rows;
        surface._bgCols = board.cols;
        surface._bgSat = this.renderer.heightSaturationEnabled;
        surface._bgOutline = this.renderer.outlineBlocksEnabled;
    }

    updateBoardBackground(board, size, surface = this.renderer) {
        const dirty = surface._bgVersion !== board.version || !this.renderer._backgroundConfigCurrent(surface, board, size);
        if (!dirty) return;

        this.renderer.spriteCache.warmGlow(size, this.renderer.heightSaturationEnabled);

        const width = board.cols * size;
        const height = board.rows * size;
        surface.background.resize(width, height);

        const bgCtx = surface.background.ctx;
        bgCtx.clearRect(0, 0, width, height);
        if (this.renderer.gridEnabled) this.renderer.drawGrid(board, bgCtx);

        for (let y = 0; y < board.rows; y++) {
            for (let x = 0; x < board.cols; x++) {
                const colorIndex = board.colors[y * board.cols + x];
                if (colorIndex) this._drawLockedCell(bgCtx, x, y, this.renderer.colorPalette[colorIndex], size, this.renderer.saturationLevelForRow(y, board.rows));
            }
        }

        surface._bgVersion = board.version;
        this.renderer._stampBackgroundConfig(surface, board, size);
    }

    notifyPieceLocked(piece, board, surface = this.renderer) {
        const size = this.renderer.boardConfig.CELL_SIZE;
        if (!this.renderer._backgroundConfigCurrent(surface, board, size)) return;

        this.renderer.spriteCache.warmGlow(size, this.renderer.heightSaturationEnabled);

        const bgCtx = surface.background.ctx;
        const pad = this.renderer.outlineBlocksEnabled
            ? this.renderer.spriteCache.outlinePad
            : (this.renderer.glowEnabled ? this.renderer.spriteCache.glowPad : 0);
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
        if (this.renderer.gridEnabled) this.renderer.drawGrid(board, bgCtx, fromY, toY, fromX, toX);

        for (let y = fromY; y <= toY; y++) {
            for (let x = fromX; x <= toX; x++) {
                const colorIndex = board.colors[y * board.cols + x];
                if (!colorIndex) continue;
                this._drawLockedCell(bgCtx, x, y, this.renderer.colorPalette[colorIndex], size, this.renderer.saturationLevelForRow(y, board.rows));
            }
        }

        surface._bgVersion = board.version;
    }

    notifyLinesCleared(board, clearedRowIndices, surface = this.renderer) {
        const size = this.renderer.boardConfig.CELL_SIZE;
        if (!this.renderer._backgroundConfigCurrent(surface, board, size)) return;
        if (!clearedRowIndices || clearedRowIndices.length === 0) {
            surface._bgVersion = board.version;
            return;
        }

        this.renderer.spriteCache.warmGlow(size, this.renderer.heightSaturationEnabled);

        const pad = this.renderer.outlineBlocksEnabled
            ? this.renderer.spriteCache.outlinePad
            : (this.renderer.glowEnabled ? this.renderer.spriteCache.glowPad : 0);
        const padRows = pad ? Math.ceil(pad / size) : 0;
        const affectedMaxRow = Math.min(board.rows - 1, Math.max(...clearedRowIndices) + padRows);
        const width = board.cols * size;
        const bgCtx = surface.background.ctx;

        bgCtx.clearRect(0, 0, width, (affectedMaxRow + 1) * size);
        if (this.renderer.gridEnabled) this.renderer.drawGrid(board, bgCtx, 0, affectedMaxRow);

        for (let y = 0; y <= affectedMaxRow; y++) {
            for (let x = 0; x < board.cols; x++) {
                const colorIndex = board.colors[y * board.cols + x];
                if (colorIndex) this._drawLockedCell(bgCtx, x, y, this.renderer.colorPalette[colorIndex], size, this.renderer.saturationLevelForRow(y, board.rows));
            }
        }

        surface._bgVersion = board.version;
    }

    _ensureClearingStaticBackground(surface, board, size, staticFromRow) {
        const dirty = surface._clearingStaticVersion !== board.version
            || surface._clearingStaticSize !== size
            || surface._clearingStaticFromRow !== staticFromRow
            || surface._clearingStaticSat !== this.renderer.heightSaturationEnabled
            || surface._clearingStaticOutline !== this.renderer.outlineBlocksEnabled;

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
                if (colorIndex) this._drawLockedCell(sCtx, x, localY, this.renderer.colorPalette[colorIndex], size, this.renderer.saturationLevelForRow(y, board.rows));
            }
        }

        surface._clearingStaticVersion = board.version;
        surface._clearingStaticSize = size;
        surface._clearingStaticFromRow = staticFromRow;
        surface._clearingStaticSat = this.renderer.heightSaturationEnabled;
        surface._clearingStaticOutline = this.renderer.outlineBlocksEnabled;
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
        this.renderer.drawGrid(board, gCtx, 0, board.rows - 1);

        surface._clearingGridSize = size;
        surface._clearingGridRows = board.rows;
        surface._clearingGridCols = board.cols;
    }

    drawBoard(board, surface = this.renderer) {
        const size = this.renderer.boardConfig.CELL_SIZE;
        const {ctx} = surface;

        if (surface.webgl && !this.renderer.asciiFallingPiecesEnabled) {
            surface.webgl.begin(surface.boardCanvas.width, surface.boardCanvas.height);
            if (this.renderer.gridEnabled) surface.webgl.addGrid(board, size, this.renderer.spriteCache);
            surface.webgl.addBoard(board, size, this.renderer.spriteCache, this.renderer.colorPalette, {
                grid: false,
                heightSaturation: this.renderer.heightSaturationEnabled,
                glow: this.renderer.glowEnabled,
                outline: this.renderer.outlineBlocksEnabled,
            });
            ctx.clearRect(0, 0, surface.boardCanvas.width, surface.boardCanvas.height);
            return;
        }

        if (surface.webgl && this.renderer.asciiFallingPiecesEnabled) {
            surface.webgl.clear();
        }

        this.renderer.updateBoardBackground(board, size, surface);
        ctx.clearRect(0, 0, surface.boardCanvas.width, surface.boardCanvas.height);
        ctx.drawImage(surface.background.canvas, 0, 0);
    }

    drawHardcoreMask(board, fromRow, theme = "none", surface = this.renderer) {
        if (fromRow == null) return;

        const size = this.renderer.boardConfig.CELL_SIZE;
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
            || surface._clearingAboveSat !== this.renderer.heightSaturationEnabled
            || surface._clearingAboveOutline !== this.renderer.outlineBlocksEnabled;

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
                    this._drawLockedCell(ctx, x, y, this.renderer.colorPalette[colorIndex], size, this.renderer.saturationLevelForRow(y, board.rows));
                }
            }
            ctx.restore();
        }

        surface._clearingAboveSegments = segments;
        surface._clearingAboveVersion = board.version;
        surface._clearingAboveSize = size;
        surface._clearingAboveLineIndicesRef = lineIndices;
        surface._clearingAboveDropRowsRef = dropRows;
        surface._clearingAboveSat = this.renderer.heightSaturationEnabled;
        surface._clearingAboveOutline = this.renderer.outlineBlocksEnabled;
    }

    _ensureCascadeDropCache(surface, board, size, dropGrid) {
        const dirty = surface._cascadeDropVersion !== board.version
            || surface._cascadeDropSize !== size
            || surface._cascadeDropGridRef !== dropGrid
            || surface._cascadeDropSat !== this.renderer.heightSaturationEnabled
            || surface._cascadeDropOutline !== this.renderer.outlineBlocksEnabled;

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
                this._drawLockedCell(ctx, segment.x, y, this.renderer.colorPalette[colorIndex], size, this.renderer.saturationLevelForRow(y, board.rows));
            }
            ctx.restore();
        }

        surface._cascadeDropSegments = segments;
        surface._cascadeDropVersion = board.version;
        surface._cascadeDropSize = size;
        surface._cascadeDropGridRef = dropGrid;
        surface._cascadeDropSat = this.renderer.heightSaturationEnabled;
        surface._cascadeDropOutline = this.renderer.outlineBlocksEnabled;
    }

    drawCascadeFallFrame(board, dropGrid, progress, surface = this.renderer) {
        const size = this.renderer.boardConfig.CELL_SIZE;
        const {ctx, boardCanvas} = surface;

        const t = Math.min(1, Math.max(0, progress));
        const eased = 1 - Math.pow(1 - t, 3);

        this.renderer._ensureCascadeDropCache(surface, board, size, dropGrid);
        if (this.renderer.gridEnabled) this.renderer._ensureClearingGridCache(surface, board, size);

        ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
        if ((!surface.webgl || this.renderer.asciiFallingPiecesEnabled) && this.renderer.gridEnabled) ctx.drawImage(surface.clearingGrid.canvas, 0, 0);

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

    drawClearingFrame(board, lineIndices, dropRows, fragments, progress, surface = this.renderer) {
        const size = this.renderer.boardConfig.CELL_SIZE;
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

        if (surface.webgl && !this.renderer.asciiFallingPiecesEnabled) {
            surface.webgl.begin(surface.boardCanvas.width, surface.boardCanvas.height);
            if (this.renderer.gridEnabled) surface.webgl.addGrid(board, size, this.renderer.spriteCache);
            if (staticFromRow < board.rows) {
                surface.webgl.addBoard(board, size, this.renderer.spriteCache, this.renderer.colorPalette, {
                    grid: false,
                    heightSaturation: this.renderer.heightSaturationEnabled,
                    glow: this.renderer.glowEnabled,
                    outline: this.renderer.outlineBlocksEnabled,
                    minRow: staticFromRow,
                });
            }

            surface.webgl.flush();
        }
        this.renderer._ensureClearingStaticBackground(surface, board, size, staticFromRow);
        this.renderer._ensureClearingAboveCache(surface, board, size, affectedMaxRow, lineIndices, dropRows);
        if (this.renderer.gridEnabled) this.renderer._ensureClearingGridCache(surface, board, size);

        ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);

        if ((!surface.webgl || this.renderer.asciiFallingPiecesEnabled) && this.renderer.gridEnabled) ctx.drawImage(surface.clearingGrid.canvas, 0, 0);

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
                const level = this.renderer.saturationLevelForRow(y, board.rows);
                this._drawLockedCell(ctx, x, y, this.renderer.colorPalette[colorIndex], size, level)
            }
        }

        if (staticFromRow < board.rows) ctx.drawImage(surface.clearingStatic.canvas, 0, staticFromRow * size);

        if (this.renderer.particlesEnabled) this.renderer.drawFragments(ctx, fragments, colParticleProgress);

        if (p < flashEnd) this.renderer.drawClearingFlash(lineIndices, colFlash, {ctx, size, cols});
    }
}
