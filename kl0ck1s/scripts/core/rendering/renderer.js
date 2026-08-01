"use strict";

import {forEachShapeCell, getTightBounds, lightenOklch, withAlpha} from "../shared/utils.js";
import {FALL_TRAIL_MAX_ALPHA} from "../game/game-constants.js";

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

        this.backgroundCanvas = document.createElement("canvas");
        this.backgroundCtx = this.backgroundCanvas.getContext("2d", {colorSpace: "display-p3"});
        this._bgVersion = -1;
        this._bgSize = 0;
        this._bgGrid = null;
        this._bgRows = 0;
        this._bgCols = 0;

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

    /**
     * Switches the board's visual theme by setting data-theme on the board
     * div - the actual background/accent colors live in main.css under
     * .board[data-theme="..."], keyed by the same effect names as
     * EffectOverlay (none/matrix/rain/snow/vhs). Keeping the colors in CSS
     * (rather than passed in here) means this stays a one-line attribute
     * flip and new themes only ever need a new CSS block, no JS changes.
     */
    setTheme(theme) {
        this.boardDiv.dataset.theme = theme || "none";
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

        context.strokeStyle = "oklch(0.553 0.049 140.928 / 0.5)";
        context.lineWidth = 1;

        for (let x = 0; x <= board.cols; x++) {
            context.beginPath();
            context.moveTo(x * size + 0.5, 0);
            context.lineTo(x * size + 0.5, board.rows * size);
            context.stroke();
        }

        for (let y = 0; y <= board.rows; y++) {
            context.beginPath();
            context.moveTo(0, y * size + 0.5);
            context.lineTo(board.cols * size, y * size + 0.5);
            context.stroke();
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

    /**
     * Draws the fading "echo" trail behind the falling/moving piece. Each
     * ring-buffer slot carries its own x and y (see Game.updateFallTrail),
     * so the trail follows both vertical falls and horizontal moves instead
     * of being pinned to the current piece's x.
     */
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
                this.drawCell(ctx, x, y, snap.color, size);
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

        const bottomMargin = fontSize * 0.8;
        const centerY = boardCanvas.height - bottomMargin - boxHeight / 2;

        ctx.shadowBlur = 6;
        ctx.fillStyle = "oklch(0 0 0 / 0.75)";
        ctx.beginPath();
        ctx.roundRect(centerX - boxWidth / 2, centerY - boxHeight / 2, boxWidth, boxHeight, fontSize * 0.2);
        ctx.fill();

        if (this.glowEnabled) {
            ctx.shadowBlur = fontSize * 0.2;
            ctx.shadowColor = "oklch(0.464 0.043 75.925 / 0.85)";
        } else {
            ctx.shadowBlur = 0;
        }
        ctx.fillStyle = "oklch(0.731 0.1861 52.7 / 0.8)";
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
