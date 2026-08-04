"use strict";

import {forEachShapeCell, getTightBounds, lightenOklch, withAlpha} from "../shared/utils.js";
import {FALL_TRAIL_MAX_ALPHA} from "../game/game-constants.js";

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
                    ctx,
                    boardCanvas,
                    nextCtx,
                    nextCanvas,
                    spriteCache,
                    boardConfig,
                    klockominos,
                    colorPalette,
                    nextPreviewCellSize,
                    i18n = null
                }) {
        this.bodyEl = bodyEl;
        this.ctx = ctx;
        this.boardCanvas = boardCanvas;
        this.nextCtx = nextCtx;
        this.nextCanvas = nextCanvas;
        this.spriteCache = spriteCache;
        this.boardConfig = boardConfig;
        this.klockominos = klockominos;
        this.colorPalette = colorPalette;
        this.nextPreviewCellSize = nextPreviewCellSize;
        this.i18n = i18n;
        this.glowEnabled = true;
        this.transparencyEnabled = true;
        this.ghostEnabled = true;
        this.gridEnabled = true;
        this.boardCanvasRect = null;

        this.backgroundCanvas = document.createElement("canvas");
        this.backgroundCtx = this.backgroundCanvas.getContext("2d", {colorSpace: "display-p3"});
        this._bgVersion = -1;
        this._bgSize = 0;
        this._bgGrid = null;
        this._bgRows = 0;
        this._bgCols = 0;
        this._boardScaleX = 1;

        this._onWindowResize = () => this.refreshBoardCanvasRect();
        window.addEventListener("resize", this._onWindowResize);
    }

    refreshBoardCanvasRect() {
        this.boardCanvasRect = this.boardCanvas.getBoundingClientRect();
        this._boardScaleX = this.boardCanvas.width / this.boardCanvasRect.width;
    }

    /** @todo: unused? */
    destroy() {
        window.removeEventListener("resize", this._onWindowResize);
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

    columnFromClientX(clientX) {
        if (!this.boardCanvasRect) this.refreshBoardCanvasRect();

        const x = (clientX - this.boardCanvasRect.left) * this._boardScaleX;
        return Math.floor(x / this.boardConfig.CELL_SIZE);
    }

    setTheme(theme) {
        this.bodyEl.dataset.theme = theme || "none";
    }

    drawCell(context, x, y, color, size, {glow = false, ghost = false} = {}) {
        glow = glow && this.glowEnabled;

        let sprite;
        let drawSize = size;
        let offset = 0;

        if (ghost) {
            sprite = this.spriteCache.getGhost(color, size);
        } else if (glow) {
            sprite = this.spriteCache.getGlow(color, size);
            offset = this.spriteCache.glowPad;
            drawSize = size + offset * 2;
        } else {
            sprite = this.spriteCache.get(color, size);
        }

        if (sprite) {
            context.drawImage(sprite, x * size - offset, y * size - offset, drawSize, drawSize);
        } else {
            context.fillStyle = color;
            context.fillRect(x * size, y * size, size, size);
        }
    }

    drawGrid(board, context = this.ctx) {
        const size = this.boardConfig.CELL_SIZE;
        const sprite = this.spriteCache.getGridCell(size);

        for (let y = 0; y < board.rows; y++) {
            for (let x = 0; x < board.cols; x++) {
                context.drawImage(sprite, x * size, y * size, size, size);
            }
        }
    }

    updateBoardBackground(board, size) {
        const dirty = this._bgVersion !== board.version
            || this._bgSize !== size
            || this._bgGrid !== this.gridEnabled
            || this._bgRows !== board.rows
            || this._bgCols !== board.cols;

        if (!dirty) return;

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
                if (colorIndex) this.drawCell(bgCtx, x, y, this.colorPalette[colorIndex], size);
            }
        }

        this._bgVersion = board.version;
        this._bgSize = size;
        this._bgGrid = this.gridEnabled;
        this._bgRows = board.rows;
        this._bgCols = board.cols;
    }

    drawBoard(board) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx, boardCanvas} = this;

        this.refreshBoardCanvasRect();
        this.updateBoardBackground(board, size);

        ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
        ctx.drawImage(this.backgroundCanvas, 0, 0);
    }

    drawPiece(piece) {
        const size = this.boardConfig.CELL_SIZE;
        forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
            const y = piece.y + r;
            if (y < 0) return;
            this.drawCell(this.ctx, piece.x + c, y, piece.color, size, {glow: true});
        });
    }

    drawFallTrail(trail, headIndex, count) {
        if (count === 0) return;

        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = this;
        const capacity = trail.length;

        ctx.save();
        for (let i = 0; i < count; i++) {
            const alpha = FALL_TRAIL_MAX_ALPHA * (1 - i / count);
            if (alpha <= 0.02) continue;

            const idx = (headIndex - 1 - i + capacity * 2) % capacity;
            const snap = trail[idx];
            if (!snap.mask) continue;

            ctx.globalAlpha = alpha;
            forEachShapeCell(snap.mask, snap.width, snap.height, (r, c) => {
                const x = snap.x + c;
                const y = snap.y + r;
                if (y < 0) return;
                this.drawCell(ctx, x, y, `oklch(from ${snap.color} calc(l + 0.75) c h / 0.3)`, size);
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

        forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
            const y = piece.y + r + offset;
            if (y < 0) return;
            if (this.transparencyEnabled) {
                this.drawCell(ctx, piece.x + c, y, piece.color, size, {ghost: true});
            } else {
                this.drawCell(ctx, piece.x + c, y, lightenOklch(piece.color), size);
            }
        });

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1;
        forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
            const y = piece.y + r + offset;
            if (y < 0) return;
            const x = piece.x + c;
            ctx.strokeRect(x * size + 0.5, y * size + 0.5, size - 1, size - 1);
        });
    }

    maskClearingRows(lineIndices) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = this;
        const sprite = this.gridEnabled
            ? this.spriteCache.getGridCell(size)
            : null;

        lineIndices.forEach((y) => {
            if (sprite) {
                for (let x = 0; x < this.boardConfig.COLS; x++) {
                    ctx.drawImage(sprite, x * size, y * size, size, size);
                }
            } else {
                ctx.clearRect(0, y * size, this.boardConfig.COLS * size, size);
            }
        });
    }

    drawClearingFlash(lineIndices, progress) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = this;

        const alpha = 1 - progress;

        ctx.save();
        if (this.glowEnabled) {
            ctx.shadowColor = `oklch(1 0 0 / ${alpha})`;
            ctx.shadowBlur = size * progress;
        }

        ctx.fillStyle = `oklch(1 0 0 / 0.5)`;

        lineIndices.forEach((y) => {
            ctx.fillRect(0, y * size, this.boardConfig.COLS * size, size);
        });

        ctx.restore();
    }

    drawClearingLines(lineIndices, fragments, progress) {
        if (!fragments || fragments.length === 0) return;

        const {ctx} = this;
        const p = Math.min(1, progress);
        const fragmentAlpha = 0.75;

        this.maskClearingRows(lineIndices);
        this.drawClearingFlash(lineIndices, p);

        ctx.save();
        ctx.globalAlpha = fragmentAlpha;

        for (const frag of fragments) {
            const x = frag.startX + frag.dx * p;
            const y = frag.startY + frag.dy * p;
            const rotation = frag.rotation0 + frag.dRotation * p;

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.fillStyle = frag.color;
            ctx.fillRect(-frag.halfSize, -frag.halfSize, frag.size, frag.size);
            ctx.restore();
        }

        ctx.restore();
    }

    drawLevelUpBanner(level) {
        const {ctx, boardCanvas, boardConfig} = this;
        const centerX = boardCanvas.width / 2;
        const fontSize = Math.max(18, Math.round(boardConfig.CELL_SIZE * 1.2));
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
            ctx.shadowColor = "oklch(0.464 0.043 75.925 / 0.85)";
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
            this.drawCell(nextCtx, offsetX + c, offsetY + r, color, nextPreviewCellSize);
        });
    }
}
