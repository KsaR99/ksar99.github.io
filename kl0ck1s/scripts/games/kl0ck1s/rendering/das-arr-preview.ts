// @ts-nocheck
import type {Game} from "../game/game.js";
import type {Renderer} from "./renderer.js";
import type {SpriteCache} from "./sprite-cache.js";
import {SpriteCache} from "./sprite-cache.js";
import {forEachShapeCell, getTightBounds} from "../shared/utils.js";
import {FALL_TRAIL_ALPHA_CACHE} from "../game/game-constants.js";

"use strict";

const PREVIEW_CELL_SIZE = 24;
const PREVIEW_TYPE = "I";
const PREVIEW_STATE_INDEX = 1;
const BOARD_COLS = 10;
const PAD_COLS = 1;
const PAD_ROWS = 1;
const TRAIL_MAX_SAMPLES = 6;
const END_HOLD_MS = 500;

export class DasArrPreviewController {

    game: Game;
    _cache: null | SpriteCache;
    _demoToken: 0;
    _rafId: null | number;
    _layout: null | {
        colOffset: number;
        rowOffset: number;
        pieceCols: number;
        pieceRows: number;
        maxCol: number;
        totalCols: number;
        totalRows: number;
    };
    _dasMs: 0 | number;
    _arrMs: 0 | number;
    _state: { phase: string; phaseStart: number | null; col: number; maxCol: number; trail: number[] } | null;

    constructor(game: Game) {
        this.game = game;
        this._cache = null;
        this._demoToken = 0;
        this._rafId = null;
        this._layout = null;
        this._dasMs = 0;
        this._arrMs = 0;
        this._state = null;
    }

    _getCache(renderer: Renderer): SpriteCache {
        if (!this._cache) this._cache = new SpriteCache(renderer.klockominos, () => document.createElement("canvas"));
        return this._cache;
    }

    _piece(renderer: Renderer) {
        const def = renderer.klockominos[PREVIEW_TYPE] ?? Object.values(renderer.klockominos)[0];
        const mask = def.states[PREVIEW_STATE_INDEX] ?? def.states[0];
        const bounds = getTightBounds(mask, def.width, def.height);
        return {mask, width: def.width, height: def.height, color: def.color, bounds};
    }

    _canvas() {
        return this.game.hud?.overlayEl?.querySelector('[data-role="das-arr-preview-canvas"]') ?? null;
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

    setTimings(dasMs, arrMs) {
        this._dasMs = Math.max(0, dasMs || 0);
        this._arrMs = Math.max(0, arrMs || 0);
    }

    render(dasMs: number, arrMs: number): void {
        if (dasMs != null || arrMs != null) this.setTimings(dasMs ?? this._dasMs, arrMs ?? this._arrMs);
        this.cancelDemo();
        this._prepareLayout();
        this._state = {
            phase: "hold",
            phaseStart: null,
            col: 0,
            maxCol: this._layout ? this._layout.maxCol : 0,
            trail: []
        };
        this._runDemoLoop();
    }

    _prepareLayout() {
        const canvas = this._canvas();
        if (!canvas) return null;

        const renderer = this.game.renderer;
        if (!renderer) return null;

        const {bounds} = this._piece(renderer);
        const pieceCols = bounds.width;
        const pieceRows = bounds.height;
        const maxCol = Math.max(0, BOARD_COLS - pieceCols);

        const colOffset = PAD_COLS;
        const rowOffset = PAD_ROWS;
        const totalCols = BOARD_COLS + PAD_COLS * 2;
        const totalRows = pieceRows + PAD_ROWS * 2;

        const layout = {colOffset, rowOffset, pieceCols, pieceRows, maxCol, totalCols, totalRows};
        this._layout = layout;

        const size = PREVIEW_CELL_SIZE;
        canvas.width = totalCols * size;
        canvas.height = totalRows * size;

        return layout;
    }

    _advance(now) {
        const state = this._state;
        const layout = this._layout;
        if (!state || !layout) return 0;

        if (state.phaseStart === null) state.phaseStart = now;

        if (state.phase === "hold") {
            if (now - state.phaseStart >= Math.max(this._dasMs, 1)) {
                state.phase = "moving";
                state.phaseStart = now;
                state.lastStepAt = now;
                state.trail.unshift(state.col);
                if (state.trail.length > TRAIL_MAX_SAMPLES) state.trail.length = TRAIL_MAX_SAMPLES;
                state.col = Math.min(layout.maxCol, state.col + 1);
                if (state.col >= layout.maxCol) {
                    state.phase = "end-hold";
                    state.phaseStart = now;
                    state.trail = [];
                }
            }
            return state.col;
        }

        if (state.phase === "moving") {
            const stepMs = Math.max(this._arrMs, 1);
            while (state.col < layout.maxCol && now - state.lastStepAt >= stepMs) {
                state.lastStepAt += stepMs;
                state.trail.unshift(state.col);
                if (state.trail.length > TRAIL_MAX_SAMPLES) state.trail.length = TRAIL_MAX_SAMPLES;
                state.col++;
            }
            if (state.col >= layout.maxCol) {
                state.phase = "end-hold";
                state.phaseStart = now;
                state.trail = [];
            }
            return state.col;
        }

        if (now - state.phaseStart >= END_HOLD_MS) {
            state.phase = "hold";
            state.phaseStart = now;
            state.col = 0;
            state.trail = [];
        }
        return state.col;
    }

    _drawFrame(ctx, renderer, cache, size, now) {
        const {mask, width, height, color, bounds} = this._piece(renderer);
        const layout = this._layout;
        const col = this._advance(now);

        this._drawGridBackground(ctx, size, cache, layout.colOffset, layout.rowOffset, BOARD_COLS, layout.pieceRows);

        const trailOn = Boolean(this.game.settings?.fallTrail);
        if (trailOn && this._state.trail.length) {
            const alphas = FALL_TRAIL_ALPHA_CACHE[this._state.trail.length];
            const sprite = cache.getFallTrail(color, size, renderer.outlineBlocksEnabled);
            const offset = sprite ? (sprite.width - size) / 2 : 0;
            this._state.trail.forEach((sampleCol, i) => {
                const alpha = alphas[i] ?? 0;
                if (!sprite || alpha <= 0) return;
                ctx.save();
                ctx.globalAlpha = alpha;
                forEachShapeCell(mask, width, height, (r, c) => {
                    const x = (layout.colOffset + sampleCol + (c - bounds.minX)) * size;
                    const y = (layout.rowOffset + (r - bounds.minY)) * size;
                    ctx.drawImage(sprite, x - offset, y - offset);
                });
                ctx.restore();
            });
        }

        forEachShapeCell(mask, width, height, (r, c) => {
            const x = layout.colOffset + col + (c - bounds.minX);
            const y = layout.rowOffset + (r - bounds.minY);
            renderer.drawCell(ctx, x, y, color, size, {glow: true, cache});
        });
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

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            this._drawFrame(ctx, renderer, cache, size, now);

            this._rafId = requestAnimationFrame(frame);
        };

        this._rafId = requestAnimationFrame(frame);
    }
}
