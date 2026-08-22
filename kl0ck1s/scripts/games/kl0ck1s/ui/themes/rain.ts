// @ts-nocheck
"use strict";

import {ThemeEffect} from "./theme-effect.js";
import {ParticleField, resizeParticleEffect} from "./particle-field.js";

const DROP_COLOR = "oklch(0.84 0.07 264 / 55%)";
const DENSITY = 0.12; // drops per pixel of width

export class Rain extends ThemeEffect {

    drops: ParticleField;

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
        if (!this.shouldDrawFrame()) return;
        const {ctx, canvas} = this;
        const {count, x, y, length, speed, drift} = this.drops;
        const width = this.logicalWidth;
        const height = this.logicalHeight;
        if (!count || width === 0 || height === 0) return;

        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = DROP_COLOR;
        ctx.lineWidth = 1;
        ctx.lineCap = "round";

        ctx.beginPath();
        for (let i = 0; i < count; i++) {
            ctx.moveTo(x[i], y[i]);
            ctx.lineTo(x[i] + drift[i] * 2, y[i] + length[i]);

            x[i] += drift[i];
            y[i] += speed[i];

            if (y[i] - length[i] > height) {
                this._spawnDrop(i, width, 0);
                y[i] = -length[i];
            }
        }
        ctx.stroke();
    }
}
