// @ts-nocheck
import type {Renderer} from "./renderer.js";

export class EffectRenderer {
    constructor(private readonly renderer: Renderer) {
    }

    buildClearFragments({cells, cols, rows, lineIndices, size = this.renderer.boardConfig.CELL_SIZE}) {
        if (!this.renderer.particlesEnabled) return null;

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
                const fragmentColor = this.renderer.particleColorForRow(this.renderer.colorPalette[cellColorIndex], y, rows);

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
        clearTimeout(this.renderer._shakeTimer);
        clearTimeout(this.renderer._squashTimerA);
        clearTimeout(this.renderer._squashTimerB);
        this.renderer._boardOffsetX = 0;
        this.renderer._boardOffsetY = 0;
        if (!this.renderer.boardEl) return;
        this.renderer.boardEl.style.transition = "none";
        this.renderer.boardEl.style.translate = "0 0";
    }

    _applyBoardOffset(transitionMs) {
        const el = this.renderer.boardEl;
        if (!el) return;
        if (!el.isConnected) return;
        if (el.style.willChange !== "transform") el.style.willChange = "transform";

        el.style.setProperty("--shake-duration", `${transitionMs}ms`);
        el.style.translate =
            `${this.renderer._boardOffsetX ?? 0}rem ${this.renderer._boardOffsetY ?? 0}rem`;
    }

    _ensureZenBlocksCache(surface, board, size) {
        const dirty = surface._zenBlocksVersion !== board.version
            || surface._zenBlocksSize !== size
            || surface._zenBlocksSat !== this.renderer.heightSaturationEnabled
            || surface._zenBlocksOutline !== this.renderer.outlineBlocksEnabled;

        if (!dirty) return;

        const width = board.cols * size;
        const height = board.rows * size;
        surface.zenBlocks.resize(width, height);

        const bCtx = surface.zenBlocks.ctx;
        bCtx.clearRect(0, 0, width, height);

        for (let y = 0; y < board.rows; y++) {
            for (let x = 0; x < board.cols; x++) {
                const colorIndex = board.colors[y * board.cols + x];
                if (colorIndex) this.renderer.drawCell(bCtx, x, y, this.renderer.colorPalette[colorIndex], size, {level: this.renderer.saturationLevelForRow(y, board.rows)});
            }
        }

        surface._zenBlocksVersion = board.version;
        surface._zenBlocksSize = size;
        surface._zenBlocksSat = this.renderer.heightSaturationEnabled;
        surface._zenBlocksOutline = this.renderer.outlineBlocksEnabled;
    }

    drawZenShiftFrame(board, rowDelta, progress, surface = this.renderer) {
        const size = this.renderer.boardConfig.CELL_SIZE;
        const {ctx, boardCanvas} = surface;

        this.renderer._ensureZenBlocksCache(surface, board, size);
        if (this.renderer.gridEnabled) this.renderer._ensureClearingGridCache(surface, board, size);

        if (surface.webgl && !this.renderer.asciiFallingPiecesEnabled) {
            surface.webgl.begin(surface.boardCanvas.width, surface.boardCanvas.height);
            if (this.renderer.gridEnabled) surface.webgl.addGrid(board, size, this.renderer.spriteCache);
            surface.webgl.flush();
        }

        const t = Math.min(1, Math.max(0, progress));
        const eased = 1 - Math.pow(1 - t, 3);
        const dy = -rowDelta * size * (1 - eased);

        ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
        if ((!surface.webgl || this.renderer.asciiFallingPiecesEnabled) && this.renderer.gridEnabled) ctx.drawImage(surface.clearingGrid.canvas, 0, 0);
        ctx.drawImage(surface.zenBlocks.canvas, 0, dy);
    }

    shakeMove(dir) {
        if (!this.renderer.shakeEnabled || !this.renderer.boardEl || !dir) return;
        clearTimeout(this.renderer._shakeTimer);
        this.renderer._boardOffsetX = dir < 0 ? 0.4 : -0.4;
        this.renderer._applyBoardOffset(70);
        this.renderer._shakeTimer = setTimeout(() => {
            this.renderer._boardOffsetX = 0;
            this.renderer._applyBoardOffset(120);
        }, 70);
    }

    shakeHardDrop() {
        if (!this.renderer.shakeEnabled || !this.renderer.boardEl) return;
        clearTimeout(this.renderer._squashTimerA);
        clearTimeout(this.renderer._squashTimerB);
        this.renderer._boardOffsetY = 0.5;
        this.renderer._applyBoardOffset(70);
        this.renderer._squashTimerA = setTimeout(() => {
            this.renderer._boardOffsetY = -0.5;
            this.renderer._applyBoardOffset(90);
            this.renderer._squashTimerB = setTimeout(() => {
                this.renderer._boardOffsetY = 0;
                this.renderer._applyBoardOffset(120);
            }, 90);
        }, 70);
    }

    drawClearingFlash(lineIndices, colFlash, {
        ctx = this.renderer.ctx,
        size = this.renderer.boardConfig.CELL_SIZE,
        cols = this.renderer.boardConfig.COLS
    } = {}) {
        ctx.save();

        for (let x = 0; x < cols; x++) {
            const alpha = colFlash[x];
            if (alpha <= 0) continue;

            ctx.shadowColor = this.renderer.glowEnabled ? `oklch(1 0 0 / ${alpha})` : "transparent";
            ctx.shadowBlur = this.renderer.glowEnabled ? size * 0.6 : 0;
            ctx.fillStyle = `oklch(1 0 0 / ${alpha})`;

            lineIndices.forEach((y) => {
                ctx.fillRect(x * size, y * size, size, size);
            });
        }

        ctx.restore();
    }
}
