"use strict";

import {ThemeEffect} from "./theme-effect.js";

const FLAKE_COLOR = "oklch(1 0 0 / 85%)";
const DENSITY = 1 / 6000; // flakes per square pixel

export class Snow extends ThemeEffect {
    constructor(canvas, ctx = null) {
        super(canvas, ctx);

        this.count = 0;
        this.x = new Float32Array(0);
        this.y = new Float32Array(0);
        this.radius = new Float32Array(0);
        this.speed = new Float32Array(0);
        this.drift = new Float32Array(0);
        this.driftSpeed = new Float32Array(0);
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
        const {w, h, unchanged} = this.resizeCanvas(width, height, this.count);
        if (unchanged) return;

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
}
