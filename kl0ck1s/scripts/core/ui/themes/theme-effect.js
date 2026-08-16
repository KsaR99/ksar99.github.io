"use strict";

export class ThemeEffect {
    constructor(canvas, ctx = null, frameSkip = 2) {
        this.canvas = canvas;
        this.ctx = ctx ?? canvas.getContext("2d");
        this.active = false;
        this.rafId = null;
        this.frameCount = 0;
        this.frameSkip = frameSkip;
        this._loop = this.loop.bind(this);
    }

    loop() {
        if (!this.active) return;
        this.frameCount = (this.frameCount + 1) % this.frameSkip;
        if (this.frameCount === 0) this.drawFrame();
        this.rafId = requestAnimationFrame(this._loop);
    }

    start() {
        if (this.active) return;
        this.active = true;
        this.frameCount = 0;
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
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    resizeCanvas(width, height, populated) {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        const unchanged = this._lastWidth === w && this._lastHeight === h && populated;
        if (unchanged) return {w, h, unchanged};
        this._lastWidth = w;
        this._lastHeight = h;
        this.canvas.width = w;
        this.canvas.height = h;
        return {w, h, unchanged};
    }

    drawFrame() {
    }

    resize(_width, _height) {
    }
}
