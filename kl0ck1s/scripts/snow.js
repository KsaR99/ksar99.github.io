"use strict";

const FLAKE_COLOR = "rgba(255, 255, 255, 0.85)";
const DENSITY = 1 / 6000; // flakes per square pixel

export class Snow {
    constructor(canvas, ctx = null) {
        this.canvas = canvas;
        this.ctx = ctx ?? canvas.getContext("2d");
        this.active = false;
        this.rafId = null;
        this.frameCount = 0;
        this.flakes = [];
        this._loop = this.loop.bind(this);
    }

    _spawnFlake(width, height, initial = false) {
        return {
            x: Math.random() * width,
            y: initial ? Math.random() * height : Math.random() * -height,
            radius: 1 + Math.random() * 2.5,
            speed: 0.6 + Math.random() * 1.4,
            drift: Math.random() * Math.PI * 2,
            driftSpeed: 0.01 + Math.random() * 0.02,
        };
    }

    resize(width, height) {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        if (this._lastWidth === w && this._lastHeight === h && this.flakes.length) return;
        this._lastWidth = w;
        this._lastHeight = h;

        this.canvas.width = w;
        this.canvas.height = h;

        const count = Math.max(10, Math.round(w * h * DENSITY));
        this.flakes = Array.from({length: count}, () => this._spawnFlake(w, h, true));
        this.ctx.clearRect(0, 0, w, h);
    }

    drawFrame() {
        const {ctx, canvas, flakes} = this;
        if (!flakes.length || canvas.width === 0 || canvas.height === 0) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = FLAKE_COLOR;

        flakes.forEach((flake) => {
            ctx.beginPath();
            ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
            ctx.fill();

            flake.drift += flake.driftSpeed;
            flake.x += Math.sin(flake.drift) * 0.6;
            flake.y += flake.speed;

            if (flake.y - flake.radius > canvas.height) {
                Object.assign(flake, this._spawnFlake(canvas.width, 0));
                flake.y = -flake.radius;
            }
        });
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
