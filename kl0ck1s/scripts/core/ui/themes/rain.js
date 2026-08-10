"use strict";

const DROP_COLOR = "oklch(0.84 0.07 264 / 55%)";
const DENSITY = 0.12; // drops per pixel of width

export class Rain {
    constructor(canvas, ctx = null) {
        this.canvas = canvas;
        this.ctx = ctx ?? canvas.getContext("2d");
        this.active = false;
        this.rafId = null;
        this.frameCount = 0;

        this.count = 0;
        this.x = new Float32Array(0);
        this.y = new Float32Array(0);
        this.length = new Float32Array(0);
        this.speed = new Float32Array(0);
        this.drift = new Float32Array(0);

        this._loop = this.loop.bind(this);
    }

    _spawnDrop(i, width, height, initial = false) {
        this.x[i] = Math.random() * width;
        this.y[i] = initial ? Math.random() * height : Math.random() * -height;
        this.length[i] = 10 + Math.random() * 14;
        this.speed[i] = 6 + Math.random() * 6;
        this.drift[i] = -0.5 + Math.random();
    }

    resize(width, height) {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        if (this._lastWidth === w && this._lastHeight === h && this.count) return;
        this._lastWidth = w;
        this._lastHeight = h;

        this.canvas.width = w;
        this.canvas.height = h;

        this.count = Math.max(8, Math.round(w * DENSITY));
        this.x = new Float32Array(this.count);
        this.y = new Float32Array(this.count);
        this.length = new Float32Array(this.count);
        this.speed = new Float32Array(this.count);
        this.drift = new Float32Array(this.count);
        for (let i = 0; i < this.count; i++) this._spawnDrop(i, w, h, true);
        this.ctx.clearRect(0, 0, w, h);
    }

    drawFrame() {
        const {ctx, canvas, count, x, y, length, speed, drift} = this;
        if (!count || canvas.width === 0 || canvas.height === 0) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = DROP_COLOR;
        ctx.lineWidth = 1;
        ctx.lineCap = "round";

        const path = new Path2D();
        for (let i = 0; i < count; i++) {
            path.moveTo(x[i], y[i]);
            path.lineTo(x[i] + drift[i] * 2, y[i] + length[i]);

            x[i] += drift[i];
            y[i] += speed[i];

            if (y[i] - length[i] > canvas.height) {
                this._spawnDrop(i, canvas.width, 0);
                y[i] = -length[i];
            }
        }
        ctx.stroke(path);
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
