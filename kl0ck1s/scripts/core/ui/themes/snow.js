"use strict";

const FLAKE_COLOR = "oklch(1 0 0 / 85%)";
const DENSITY = 1 / 6000; // flakes per square pixel

export class Snow {
    constructor(canvas, ctx = null) {
        this.canvas = canvas;
        this.ctx = ctx ?? canvas.getContext("2d");
        this.active = false;
        this.rafId = null;
        this.frameCount = 0;

        this.count = 0;
        this.x = new Float32Array(0);
        this.y = new Float32Array(0);
        this.radius = new Float32Array(0);
        this.speed = new Float32Array(0);
        this.drift = new Float32Array(0);
        this.driftSpeed = new Float32Array(0);

        this._loop = this.loop.bind(this);
    }

    _spawnFlake(i, width, height, initial = false) {
        this.x[i] = Math.random() * width;
        this.y[i] = initial ? Math.random() * height : Math.random() * -height;
        this.radius[i] = 1 + Math.random() * 2.5;
        this.speed[i] = 0.6 + Math.random() * 1.4;
        this.drift[i] = Math.random() * Math.PI * 2;
        this.driftSpeed[i] = 0.01 + Math.random() * 0.02;
    }

    resize(width, height) {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        if (this._lastWidth === w && this._lastHeight === h && this.count) return;
        this._lastWidth = w;
        this._lastHeight = h;

        this.canvas.width = w;
        this.canvas.height = h;

        this.count = Math.max(10, Math.round(w * h * DENSITY));
        this.x = new Float32Array(this.count);
        this.y = new Float32Array(this.count);
        this.radius = new Float32Array(this.count);
        this.speed = new Float32Array(this.count);
        this.drift = new Float32Array(this.count);
        this.driftSpeed = new Float32Array(this.count);
        for (let i = 0; i < this.count; i++) this._spawnFlake(i, w, h, true);
        this.ctx.clearRect(0, 0, w, h);
    }

    drawFrame() {
        const {ctx, canvas, count, x, y, radius, speed, drift, driftSpeed} = this;
        if (!count || canvas.width === 0 || canvas.height === 0) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = FLAKE_COLOR;

        const path = new Path2D();
        for (let i = 0; i < count; i++) {
            path.moveTo(x[i] + radius[i], y[i]);
            path.arc(x[i], y[i], radius[i], 0, Math.PI * 2);

            drift[i] += driftSpeed[i];
            x[i] += Math.sin(drift[i]) * 0.6;
            y[i] += speed[i];

            if (y[i] - radius[i] > canvas.height) {
                this._spawnFlake(i, canvas.width, 0);
                y[i] = -radius[i];
            }
        }
        ctx.fill(path);
    }

    loop() {
        if (!this.active) return;
        this.frameCount = (this.frameCount + 1) % 2;
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
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
}
