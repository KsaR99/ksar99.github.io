"use strict";

import {ThemeEffect} from "./theme-effect.js";

const DROP_COLOR = "oklch(0.84 0.07 264 / 55%)";
const DENSITY = 0.12; // drops per pixel of width

export class Rain extends ThemeEffect {
    constructor(canvas, ctx = null) {
        super(canvas, ctx);

        this.count = 0;
        this.x = new Float32Array(0);
        this.y = new Float32Array(0);
        this.length = new Float32Array(0);
        this.speed = new Float32Array(0);
        this.drift = new Float32Array(0);
    }

    _spawnDrop(i, width, height, initial = false) {
        this.x[i] = Math.random() * width;
        this.y[i] = initial ? Math.random() * height : Math.random() * -height;
        this.length[i] = 12 + Math.random() * 14;
        this.speed[i] = 10 + Math.random() * 6;
        this.drift[i] = -0.5 + Math.random();
    }

    resize(width, height) {
        const {w, h, unchanged} = this.resizeCanvas(width, height, this.count);
        if (unchanged) return;

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
}
