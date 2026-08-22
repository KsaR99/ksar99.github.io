// @ts-nocheck
"use strict";

export class ThemeEffect {

    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    active: false | true;
    rafId: null | number;
    frameCount: 0 | number;
    frameSkip: number;
    frameIntervalMs: number;
    renderScale: number;
    logicalWidth: number;
    logicalHeight: number;
    _loop: FrameRequestCallback;
    _lastWidth: number;
    _lastHeight: number;
    _lastDrawTime: number;

    constructor(canvas, ctx = null, frameSkip = 2, renderScale = 0.5) {
        this.canvas = canvas;
        this.ctx = ctx ?? canvas.getContext("2d");
        this.active = false;
        this.rafId = null;
        this.frameCount = 0;
        this.frameSkip = frameSkip;
        this.frameIntervalMs = 1000 / 24;
        this.renderScale = Math.max(0.25, Math.min(1, renderScale));
        this.logicalWidth = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1));
        this.logicalHeight = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 1));
        this._lastWidth = 0;
        this._lastHeight = 0;
        this._lastDrawTime = 0;
        this._loop = this.loop.bind(this);
    }

    _applyRenderTransform() {
        const s = this.renderScale;
        this.ctx.setTransform(s, 0, 0, s, 0, 0);
    }

    loop() {
        if (!this.active) return;
        this.drawFrame();
        this.rafId = requestAnimationFrame(this._loop);
    }

    shouldDrawFrame(now = performance.now()) {
        if (this._lastDrawTime && now - this._lastDrawTime < this.frameIntervalMs) {
            return false;
        }
        this._lastDrawTime = now;
        return true;
    }

    start() {
        if (this.active) return;
        this.active = true;
        this.frameCount = 0;
        this._lastDrawTime = 0;
        this.rafId = requestAnimationFrame(this._loop);
    }

    stop() {
        if (!this.active) return;
        this.active = false;
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
        this.rafId = null;
        this.clear();
    }

    clear() {
        this._applyRenderTransform();
        this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
    }

    resizeCanvas(width, height, populated) {
        const logicalW = Math.max(1, Math.round(width));
        const logicalH = Math.max(1, Math.round(height));
        const w = Math.max(1, Math.round(logicalW * this.renderScale));
        const h = Math.max(1, Math.round(logicalH * this.renderScale));
        const unchanged =
            this.logicalWidth === logicalW &&
            this.logicalHeight === logicalH &&
            this._lastWidth === w &&
            this._lastHeight === h &&
            populated;

        this.logicalWidth = logicalW;
        this.logicalHeight = logicalH;

        if (unchanged) {
            this._applyRenderTransform();
            return {w: logicalW, h: logicalH, backingW: w, backingH: h, unchanged};
        }

        this._lastWidth = w;
        this._lastHeight = h;
        this.canvas.width = w;
        this.canvas.height = h;
        this._applyRenderTransform();

        return {w: logicalW, h: logicalH, backingW: w, backingH: h, unchanged};
    }

    drawFrame() {
    }

    resize(_width, _height) {
    }
}
