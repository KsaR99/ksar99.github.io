// @ts-nocheck
import type {Game} from "../game/game.js";
import type {Renderer} from "./renderer.js";
import type {SpriteCache} from "./sprite-cache.js";
import {HARD_DROP_FLASH_SPRITE_HEIGHT, SATURATION_LEVELS, SpriteCache} from "./sprite-cache.js";
import {forEachShapeCell, getTightBounds} from "../shared/utils.js";
import {FALL_TRAIL_ALPHA_CACHE, HARD_DROP_IMPACT_FLASH_DURATION_MS,} from "../game/game-constants.js";

"use strict";

const PREVIEW_CELL_SIZE = 26;
const PREVIEW_GHOST_GAP_ROWS = 1;
const PREVIEW_TYPE = "T";
const GHOST_WHITE_COLOR = "oklch(0.96 0 0)";

const PANEL_GAP_COLS = 1;
const LEFT_PAD_COLS = 1;

const TRAIL_FALL_ROWS = 4;
const TRAIL_FALL_DURATION_MS = 960;
const TRAIL_SAMPLE_MS = 55;
const TRAIL_MAX_SAMPLES = 6;
const TRAIL_LANDED_HOLD_MS = 180;
const TRAIL_LOOP_RESTART_DELAY_MS = 420;

const FLASH_FALL_ROWS = 4;
const FLASH_DURATION_MS = HARD_DROP_IMPACT_FLASH_DURATION_MS;
const FLASH_LOOP_RESTART_DELAY_MS = 420;

export class OptionsPreviewController {

    game: Game;
    _cache: null | SpriteCache;
    _demoToken: 0;
    _rafId: null | number;
    _layout: { main: any; trail: any; flash: any; totalCols: number; totalRows: number } | null;
    _trailState: {
        samples: number[];
        lastSampleTime: number;
        startTime: number | null;
        landedTime: number | null
    } | null;
    _flashState: { cycleStart: number | null } | null;

    constructor(game: Game) {
        this.game = game;
        this._cache = null;
        this._demoToken = 0;
        this._rafId = null;
        this._layout = null;
        this._trailState = null;
        this._flashState = null;
    }

    _getCache(renderer: Renderer): SpriteCache {
        return renderer.spriteCache;
    }

    _piece(renderer: Renderer): { mask: number; width: number; height: number; color: string; bounds: any } {
        const def = renderer.klockominos[PREVIEW_TYPE] ?? Object.values(renderer.klockominos)[0];
        const mask = def.states[0];
        const bounds = getTightBounds(mask, def.width, def.height);
        return {mask, width: def.width, height: def.height, color: def.color, bounds};
    }

    _canvas() {
        return this.game.hud?.overlayEl?.querySelector('[data-role="graphics-preview-canvas"]') ?? null;
    }

    _computeLayout(cols: number, pieceRows: number) {
        const mainRows = pieceRows * 2 + PREVIEW_GHOST_GAP_ROWS;
        const sideRows = pieceRows + TRAIL_FALL_ROWS;
        const showFlash = Boolean(this.game.settings?.hardDropFlash);
        const totalRows = Math.max(mainRows, sideRows);

        const main = {colOffset: LEFT_PAD_COLS, rowOffset: totalRows - mainRows, cols, rows: mainRows};
        const trail = {
            colOffset: main.colOffset + cols + PANEL_GAP_COLS,
            rowOffset: totalRows - sideRows,
            cols,
            rows: sideRows
        };
        const flash = showFlash
            ? {
                colOffset: trail.colOffset + cols + PANEL_GAP_COLS,
                rowOffset: totalRows - sideRows,
                cols,
                rows: sideRows
            }
            : null;

        const totalCols = (flash ?? trail).colOffset + (flash ?? trail).cols;

        return {main, trail, flash, totalCols, totalRows};
    }

    _drawGridBackground(ctx: CanvasRenderingContext2D, size: number, cache: SpriteCache, colOffset: number, rowOffset: number, cols: number, rows: number): void {
        if (!this.game.settings?.gridLines) return;
        const sprite = cache.getGridCell(size);
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                ctx.drawImage(sprite, (colOffset + x) * size, (rowOffset + y) * size, size, size);
            }
        }
    }

    cancelDemo() {
        this._demoToken++;
        if (this._rafId != null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    render() {
        this.cancelDemo();
        this._prepareLayout();
        this._trailState = {samples: [], lastSampleTime: -Infinity, startTime: null, landedTime: null};
        this._flashState = {cycleStart: null};
        this._runDemoLoop();
    }

    playDropDemo() {
        this.render();
    }

    _prepareLayout() {
        const canvas = this._canvas();
        if (!canvas) return null;

        const renderer = this.game.renderer;
        if (!renderer) return null;

        const {bounds} = this._piece(renderer);
        const cols = bounds.width;
        const pieceRows = bounds.height;
        const layout = this._computeLayout(cols, pieceRows);
        this._layout = layout;

        const size = PREVIEW_CELL_SIZE;
        canvas.width = layout.totalCols * size;
        canvas.height = layout.totalRows * size;

        return layout;
    }

    _drawMainPanel(ctx: CanvasRenderingContext2D, renderer: Renderer, cache: SpriteCache, size: number): void {
        const {mask, width, height, color, bounds} = this._piece(renderer);
        const pieceRows = bounds.height;
        const {main} = this._layout;
        const ghostTopRow = pieceRows + PREVIEW_GHOST_GAP_ROWS;

        const levelFor = (localY) => renderer.heightSaturationEnabled ? Math.max(0, pieceRows - 1 - localY) : 0;

        renderer.pieceRenderer.drawPreviewPiece(ctx, {
            mask,
            width,
            height,
            color,
            bounds
        }, main.colOffset, main.rowOffset, size, {
            glow: renderer.glowEnabled,
            levelFor,
            cache
        });

        renderer.pieceRenderer.drawPreviewGhost(ctx, {
            mask,
            width,
            height,
            color,
            bounds
        }, main.colOffset, main.rowOffset + ghostTopRow, pieceRows, size, cache);
    }

    _drawTrailPanel(ctx: CanvasRenderingContext2D, renderer: Renderer, cache: SpriteCache, size: number, now: number): void {
        const {mask, width, height, color, bounds} = this._piece(renderer);
        const cols = bounds.width;
        const panel = this._layout.trail;
        const state = this._trailState;

        const levelForY = (topY) => {
            if (!renderer.heightSaturationEnabled) return 0;
            const t = Math.max(0, Math.min(1, (TRAIL_FALL_ROWS - topY) / TRAIL_FALL_ROWS));
            return Math.round(t * (SATURATION_LEVELS - 1));
        };

        const drawPieceAt = (topYRows, level) => {
            const piece = {
                mask, width, height, color,
                bounds,
                x: panel.colOffset,
                y: panel.rowOffset + Math.round(topYRows)
            };
            if (renderer.asciiFallingPiecesEnabled) {
                renderer.pieceRenderer._drawAsciiCells(
                    ctx, mask, width, height, color, size,
                    panel.colOffset, panel.rowOffset + Math.round(topYRows),
                    {bounds}
                );
                return;
            }
            forEachShapeCell(mask, width, height, (r, c) => {
                const x = panel.colOffset + (c - bounds.minX);
                const localY = r - bounds.minY;
                renderer.drawCell(ctx, x, panel.rowOffset + Math.round(topYRows) + localY, color, size, {
                    glow: true, level, cache
                });
            });
        };

        const drawTrailSample = (topY, alpha) => {
            ctx.save();
            ctx.globalAlpha = alpha;
            if (renderer.asciiFallingPiecesEnabled) {
                renderer.pieceRenderer._drawAsciiCells(
                    ctx, mask, width, height, color, size,
                    panel.colOffset, panel.rowOffset + Math.round(topY),
                    {bounds}
                );
                ctx.restore();
                return;
            }
            const sprite = cache.getFallTrail(color, size, renderer.outlineBlocksEnabled);
            const offset = sprite ? (sprite.width - size) / 2 : 0;
            forEachShapeCell(mask, width, height, (r, c) => {
                const x = (panel.colOffset + (c - bounds.minX)) * size;
                const y = (panel.rowOffset + topY + (r - bounds.minY)) * size;
                if (sprite) ctx.drawImage(sprite, x - offset, y - offset);
            });
            ctx.restore();
        };

        const trailOn = Boolean(this.game.settings?.fallTrail);

        if (state.startTime === null) state.startTime = now;
        const elapsed = now - state.startTime;
        const fallT = Math.min(1, elapsed / TRAIL_FALL_DURATION_MS);
        const topY = fallT * TRAIL_FALL_ROWS;

        if (trailOn && fallT < 1 && now - state.lastSampleTime >= TRAIL_SAMPLE_MS) {
            state.lastSampleTime = now;
            state.samples.unshift(topY);
            if (state.samples.length > TRAIL_MAX_SAMPLES) state.samples.length = TRAIL_MAX_SAMPLES;
        }

        if (trailOn && fallT < 1 && state.samples.length) {
            const alphas = FALL_TRAIL_ALPHA_CACHE[state.samples.length];
            state.samples.forEach((sampleY, i) => drawTrailSample(sampleY, alphas[i] ?? 0));
        }

        if (fallT < 1) {
            drawPieceAt(topY, levelForY(topY));
            return;
        }

        if (state.landedTime === null) {
            state.landedTime = now;
            state.samples = [];
            state.lastSampleTime = -Infinity;
        }
        const sinceLanded = now - state.landedTime;
        drawPieceAt(TRAIL_FALL_ROWS, levelForY(TRAIL_FALL_ROWS));

        if (sinceLanded >= TRAIL_LANDED_HOLD_MS + TRAIL_LOOP_RESTART_DELAY_MS) {
            state.startTime = null;
            state.landedTime = null;
        }
    }

    _drawFlashPanel(ctx: CanvasRenderingContext2D, renderer: Renderer, cache: SpriteCache, size: number, now: number): void {
        const {mask, width, height, color, bounds} = this._piece(renderer);
        const cols = bounds.width;
        const pieceRows = bounds.height;
        const panel = this._layout.flash;
        const state = this._flashState;

        const levelFor = (localY) => renderer.heightSaturationEnabled ? Math.max(0, pieceRows - 1 - localY) : 0;

        if (renderer.asciiFallingPiecesEnabled) {
            renderer.pieceRenderer._drawAsciiCells(
                ctx, mask, width, height, color, size,
                panel.colOffset, panel.rowOffset + FLASH_FALL_ROWS,
                {bounds}
            );
        } else {
            forEachShapeCell(mask, width, height, (r, c) => {
                const x = panel.colOffset + (c - bounds.minX);
                const localY = r - bounds.minY;
                renderer.drawCell(ctx, x, panel.rowOffset + FLASH_FALL_ROWS + localY, color, size, {
                    glow: true, level: levelFor(localY), cache
                });
            });
        }

        if (state.cycleStart === null) state.cycleStart = now;
        const elapsed = now - state.cycleStart;

        if (elapsed < FLASH_DURATION_MS) {
            const progress = elapsed / FLASH_DURATION_MS;
            const alpha = 1 - progress;
            if (alpha > 0) {
                const sprite = cache.getHardDropFlash();
                const pieceTop = (panel.rowOffset + FLASH_FALL_ROWS) * size;
                const pieceHeight = pieceRows * size;
                const bandHeight = Math.max(size * 1.8, pieceHeight * 1.4);
                const travel = pieceHeight + bandHeight;
                const centerY = pieceTop + pieceHeight - progress * travel + bandHeight / 2;

                ctx.save();
                ctx.beginPath();
                forEachShapeCell(mask, width, height, (r, c) => {
                    const x = (panel.colOffset + (c - bounds.minX)) * size;
                    const y = (panel.rowOffset + FLASH_FALL_ROWS + (r - bounds.minY)) * size;
                    ctx.rect(x, y, size, size);
                });
                ctx.clip();
                ctx.globalCompositeOperation = "lighter";
                ctx.globalAlpha = alpha;
                ctx.drawImage(
                    sprite, 0, 0, 1, HARD_DROP_FLASH_SPRITE_HEIGHT,
                    panel.colOffset * size, centerY - bandHeight / 2, cols * size, bandHeight,
                );
                ctx.restore();
            }
            return;
        }

        if (elapsed >= FLASH_DURATION_MS + FLASH_LOOP_RESTART_DELAY_MS) {
            state.cycleStart = null;
        }
    }

    _runDemoLoop() {
        const game = this.game;
        const renderer = game.renderer;
        const canvas = this._canvas();
        if (!renderer || !canvas || !this._layout) return;

        const token = this._demoToken;
        const cache = this._getCache(renderer);
        const size = PREVIEW_CELL_SIZE;
        const ctx = canvas.getContext("2d");

        const frame = (now) => {
            if (token !== this._demoToken) return;
            if (this._canvas() !== canvas || !this._layout) return;

            const layout = this._layout;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            this._drawGridBackground(ctx, size, cache, 0, 0, layout.totalCols, layout.totalRows);

            this._drawMainPanel(ctx, renderer, cache, size);
            this._drawTrailPanel(ctx, renderer, cache, size, now);
            if (layout.flash) this._drawFlashPanel(ctx, renderer, cache, size, now);

            this._rafId = requestAnimationFrame(frame);
        };

        this._rafId = requestAnimationFrame(frame);
    }

    _drawGhostPiece(ctx, renderer, cache, piece, colOffset, ghostTopRow, pieceRows, size) {
        renderer.pieceRenderer.drawPreviewGhost(
            ctx,
            piece,
            colOffset,
            ghostTopRow,
            pieceRows,
            size,
            cache
        );
    }
}
