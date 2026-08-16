"use strict";

import {ThemeEffect} from "./theme-effect.js";
import {ParticleField, resizeParticleEffect} from "./particle-field.js";

const DROP_COLOR = "oklch(0.84 0.07 264 / 55%)";
const DENSITY = 0.12; // drops per pixel of width

export class Rain extends ThemeEffect {
    constructor(canvas, ctx = null) {
        super(canvas, ctx);

        this.drops = new ParticleField({
            x: Float32Array,
            y: Float32Array,
            length: Float32Array,
            speed: Float32Array,
            drift: Float32Array,
        });
    }

    _spawnDrop = (i, width, height, initial = false) => {
        const {x, y, length, speed, drift} = this.drops;
        x[i] = Math.random() * width;
        y[i] = initial ? Math.random() * height : Math.random() * -height;
        length[i] = 12 + Math.random() * 14;
        speed[i] = 10 + Math.random() * 6;
        drift[i] = -0.5 + Math.random();
    };

    resize(width, height) {
        resizeParticleEffect(
            this, width, height,
            (w) => Math.max(8, Math.round(w * DENSITY)),
            this.drops, this._spawnDrop
        );
    }

    drawFrame() {
        const {ctx, canvas} = this;
        const {count, x, y, length, speed, drift} = this.drops;
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
