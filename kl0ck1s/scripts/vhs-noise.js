"use strict";

/**
 * Draws animated black/white static onto a canvas at native 1:1 resolution
 * (no internal low-res buffer stretched via CSS), so there is no scaling or
 * smoothing that could blur one random frame into the next. Call resize()
 * whenever the board's on-screen size changes, and start()/stop() to toggle
 * the animation loop.
 */
export class VhsNoise {
    /**
     * @param {HTMLCanvasElement} canvas
     */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.active = false;
        this.rafId = null;
    }

    resize(width, height) {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        if (this.canvas.width === w && this.canvas.height === h) return;
        this.canvas.width = w;
        this.canvas.height = h;
    }

    drawFrame() {
        const {ctx, canvas} = this;
        if (canvas.width === 0 || canvas.height === 0) return;

        const imageData = ctx.createImageData(canvas.width, canvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const shade = Math.random() < 0.5 ? 255 : 0;
            const alpha = Math.floor(Math.random() * 25);
            data[i] = shade;
            data[i + 1] = shade;
            data[i + 2] = shade;
            data[i + 3] = alpha;
        }

        ctx.putImageData(imageData, 0, 0);
    }

    loop() {
        if (!this.active) return;
        this.frameCount = (this.frameCount + 1) % 3;
        if (this.frameCount === 0) this.drawFrame();
        this.rafId = requestAnimationFrame(this.loop.bind(this));
    }

    start() {
        if (this.active) return;
        this.active = true;
        this.frameCount = 0;
        this.rafId = requestAnimationFrame(this.loop.bind(this));
    }

    stop() {
        this.active = false;
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
        this.rafId = null;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
}
