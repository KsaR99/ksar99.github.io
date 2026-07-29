"use strict";

import {forEachShapeCell, getTightBounds, lightenOklch, withAlpha} from "../shared/utils.js";

export class Renderer {
    /**
     * @param {object} deps
     * @param {HTMLDivElement} boardDiv
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
                    boardDiv,
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
        this.boardDiv = boardDiv;
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

        // Precomputed once per resize instead of on every columnFromClientX()
        // call - getBoundingClientRect() forces a layout reflow, and
        // columnFromClientX() can be called dozens of times per second while
        // a pointer/touch is dragging across the board.
        this._boardScaleX = 1;

        // Keeps boardCanvasRect fresh even while the game is paused/game-over
        // (drawBoard() - which used to be the only place refreshing the
        // rect - doesn't run in those states, so a resize while paused would
        // otherwise leave a stale rect until the next drawBoard() call).
        this._onWindowResize = () => this.refreshBoardCanvasRect();
        window.addEventListener("resize", this._onWindowResize);
    }

    /** Re-caches the board canvas's bounding rect. Call whenever the canvas is resized or repositioned. */
    refreshBoardCanvasRect() {
        this.boardCanvasRect = this.boardCanvas.getBoundingClientRect();
        this._boardScaleX = this.boardCanvas.width / this.boardCanvasRect.width;
    }

    /** Releases the resize listener. Call when the renderer/game is torn down. */
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

    /**
     * Translates a mouse event's clientX into a board column, accounting for
     * the canvas's backing-store size vs. its on-screen CSS size (they can
     * differ, e.g. on high-DPI displays or when the canvas is scaled by CSS).
     * Not clamped to the board width — callers rely on collision checks to
     * stop movement at the edges.
     *
     * Uses the cached boardCanvasRect/scale instead of calling
     * getBoundingClientRect() here - this can be invoked many times per
     * second during a drag, and getBoundingClientRect() forces a layout
     * reflow each time. The cache is kept fresh by drawBoard() every frame
     * during play, and by the resize listener otherwise.
     */
    columnFromClientX(clientX) {
        if (!this.boardCanvasRect) this.refreshBoardCanvasRect();

        const x = (clientX - this.boardCanvasRect.left) * this._boardScaleX;
        return Math.floor(x / this.boardConfig.CELL_SIZE);
    }

    setTheme(backgroundColor) {
        this.boardDiv.style.backgroundColor = backgroundColor;
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

        ctx.strokeStyle = "oklch(1 0 0 / 30%)";
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

        this.refreshBoardCanvasRect();
        ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
        if (this.gridEnabled) this.drawGrid(board);

        for (let y = 0; y < board.rows; y++) {
            for (let x = 0; x < board.cols; x++) {
                const colorIndex = board.colors[y * board.cols + x];
                if (colorIndex) this.drawCell(ctx, x, y, this.colorPalette[colorIndex], size);
            }
        }
    }

    drawPiece(piece) {
        const size = this.boardConfig.CELL_SIZE;
        forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
            const y = piece.y + r;
            if (y < 0) return;
            this.drawCell(this.ctx, piece.x + c, y, piece.color, size, true);
        });
    }

    drawGhost(piece, board) {
        if (!this.ghostEnabled) return;

        const offset = board.getDropOffset(piece);
        if (offset === 0) return;

        const size = this.boardConfig.CELL_SIZE;
        const {ctx} = this;
        const strokeColor = withAlpha(piece.color, 0.6);
        const ghostColor = this.transparencyEnabled ? piece.color : lightenOklch(piece.color);

        if (this.transparencyEnabled) {
            ctx.save();
            ctx.globalAlpha = 0.3;
        }

        forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
            const y = piece.y + r + offset;
            if (y < 0) return;
            this.drawCell(ctx, piece.x + c, y, ghostColor, size);
        });

        if (this.transparencyEnabled) ctx.restore();

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1;
        forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
            const y = piece.y + r + offset;
            if (y < 0) return;
            const x = piece.x + c;
            ctx.strokeRect(x * size + 0.5, y * size + 0.5, size - 1, size - 1);
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

        ctx.shadowBlur = 0;
        ctx.fillStyle = "oklch(0 0 0 / 25%)";
        ctx.beginPath();
        ctx.roundRect(centerX - boxWidth / 2, centerY - boxHeight / 2, boxWidth, boxHeight, fontSize * 0.2);
        ctx.fill();

        ctx.shadowColor = "oklch(0.391 0.005 17.389 / 0.9)";
        ctx.shadowBlur = fontSize * 0.3;
        ctx.fillStyle = "oklch(0 0 0 / 25%)";
        ctx.fillText(text, centerX, centerY);

        if (this.glowEnabled) {
            ctx.shadowBlur = fontSize * 0.2;
            ctx.shadowColor = "oklch(0.386 0.021 125.81 / 0.95)";
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