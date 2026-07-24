"use strict";

import {lightenOklch, trimShape, withAlpha} from "./utils.js";

export class Renderer {
    /**
     * @param {object} deps
     * @param {CanvasRenderingContext2D} deps.ctx
     * @param {HTMLCanvasElement} deps.boardCanvas
     * @param {CanvasRenderingContext2D} deps.nextCtx
     * @param {HTMLCanvasElement} deps.nextCanvas
     * @param {import("./sprite-cache.js").SpriteCache} deps.spriteCache
     * @param {object} deps.boardConfig
     * @param {object} deps.klockominos
     * @param {number} deps.nextPreviewCellSize
     * @param {import("./i18n.js").I18n} [deps.i18n]
     */
    constructor({
                    ctx,
                    boardCanvas,
                    nextCtx,
                    nextCanvas,
                    spriteCache,
                    boardConfig,
                    klockominos,
                    nextPreviewCellSize,
                    i18n = null
                }) {
        this.ctx = ctx;
        this.boardCanvas = boardCanvas;
        this.nextCtx = nextCtx;
        this.nextCanvas = nextCanvas;
        this.spriteCache = spriteCache;
        this.boardConfig = boardConfig;
        this.klockominos = klockominos;
        this.nextPreviewCellSize = nextPreviewCellSize;
        this.i18n = i18n;
        this.glowEnabled = true;
        this.transparencyEnabled = true;
    }

    setGlowEnabled(enabled) {
        this.glowEnabled = enabled;
    }

    setTransparencyEnabled(enabled) {
        this.transparencyEnabled = enabled;
    }

    setTheme(backgroundColor) {
        this.boardCanvas.style.background = backgroundColor;
        this.nextCanvas.style.background = backgroundColor;
    }

    drawCell(context, x, y, color, size, glow = false) {
        const sprite = this.spriteCache.get(color, size);
        glow = glow && this.glowEnabled;

        if (glow) {
            context.save();
            context.shadowColor = color;
            context.shadowBlur = size * 0.6;
        }

        if (sprite) {
            context.drawImage(sprite, x * size, y * size, size, size);
        } else {
            // fallback.
            context.fillStyle = color;
            context.fillRect(x * size, y * size, size, size);
        }

        if (glow) context.restore();
    }

    drawGrid(board) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = this;

        ctx.strokeStyle = "oklch(1 0 0 / 25%)";
        ctx.lineWidth = 1;

        for (let x = 0; x <= board.cols; x++) {
            ctx.beginPath();
            ctx.moveTo(x * size + 0.5, 0);
            ctx.lineTo(x * size + 0.5, board.rows * size);
            ctx.stroke();
        }

        for (let y = 0; y <= board.rows; y++) {
            ctx.beginPath();
            ctx.moveTo(0, y * size + 0.5);
            ctx.lineTo(board.cols * size, y * size + 0.5);
            ctx.stroke();
        }
    }

    drawBoard(board) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx, boardCanvas} = this;

        ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
        this.drawGrid(board);

        for (const [y, row] of board.grid.entries()) {
            for (const [x, color] of row.entries()) {
                color && this.drawCell(ctx, x, y, color, size);
            }
        }
    }

    drawPiece(piece) {
        const size = this.boardConfig.CELL_SIZE;
        piece.shape.forEach((row, r) => {
            row.forEach((cell, c) => {
                if (!cell) return;
                const y = piece.y + r;
                if (y < 0) return;
                this.drawCell(this.ctx, piece.x + c, y, piece.color, size, true);
            });
        });
    }

    drawGhost(piece, board) {
        const offset = board.getDropOffset(piece);
        if (offset === 0) return;

        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = this;
        const strokeColor = withAlpha(piece.color, 0.6);

        if (this.transparencyEnabled) {
            ctx.save();
            ctx.globalAlpha = 0.3;

            piece.shape.forEach((row, r) => {
                row.forEach((cell, c) => {
                    if (!cell) return;
                    const y = piece.y + r + offset;
                    if (y < 0) return;
                    this.drawCell(ctx, piece.x + c, y, piece.color, size);
                });
            });

            ctx.restore();
        } else {
            const ghostColor = lightenOklch(piece.color);

            piece.shape.forEach((row, r) => {
                row.forEach((cell, c) => {
                    if (!cell) return;
                    const y = piece.y + r + offset;
                    if (y < 0) return;
                    this.drawCell(ctx, piece.x + c, y, ghostColor, size);
                });
            });
        }

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1;
        piece.shape.forEach((row, r) => {
            row.forEach((cell, c) => {
                if (!cell) return;
                const y = piece.y + r + offset;
                if (y < 0) return;
                const x = piece.x + c;
                ctx.strokeRect(x * size + 0.5, y * size + 0.5, size - 1, size - 1);
            });
        });
    }

    drawClearingLines(lineIndices, progress) {
        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = this;
        const flashBoost = Math.sin(Math.min(1, progress) * Math.PI);
        const alpha = Math.min(1, 0.8 + flashBoost * 0.2);

        ctx.save();
        if (this.glowEnabled) {
            ctx.shadowColor = "oklch(1 0 0 / 95%)";
            ctx.shadowBlur = size * (0.3 + flashBoost * 0.35);
        }
        ctx.fillStyle = `oklch(1 0 0 / ${alpha})`;

        lineIndices.forEach((y) => {
            ctx.fillRect(0, y * size, this.boardConfig.COLS * size, size);
        });

        ctx.restore();
    }

    drawLevelUpBanner(level) {
        const {ctx, boardCanvas, boardConfig} = this;
        const centerX = boardCanvas.width / 2;
        const centerY = boardCanvas.height / 2;
        const fontSize = Math.max(18, Math.round(boardConfig.CELL_SIZE * 1.3));
        const text = this.i18n ? this.i18n.t("game.levelUpBanner", {level}) : `LEVEL ${level}`;

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `bold ${fontSize}px monospace, "Courier New"`;

        ctx.shadowColor = "oklch(0 0 0 / 90%)";
        ctx.shadowBlur = fontSize * 0.3;
        ctx.fillStyle = "oklch(0 0 0 / 90%)";
        ctx.fillText(text, centerX, centerY);

        if (this.glowEnabled) {
            ctx.shadowBlur = fontSize * 0.2;
            ctx.shadowColor = "oklch(0.911 0.237 130 / 0.95)";
        } else {
            ctx.shadowBlur = 0;
        }
        ctx.fillStyle = "oklch(0.807 0.274 142.321)";
        ctx.fillText(text, centerX, centerY);
        ctx.restore();
    }

    drawNext(type) {
        const {nextCtx, nextCanvas, nextPreviewCellSize} = this;
        nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
        if (!type) return;

        const {states, color} = this.klockominos[type];
        const shape = trimShape(states[0]);
        const w = shape[0].length;
        const h = shape.length;
        const offsetX = (nextCanvas.width / nextPreviewCellSize - w) / 2;
        const offsetY = (nextCanvas.height / nextPreviewCellSize - h) / 2;

        shape.forEach((row, r) => {
            row.forEach((cell, c) => {
                if (!cell) return;
                this.drawCell(nextCtx, offsetX + c, offsetY + r, color, nextPreviewCellSize);
            });
        });
    }
}
