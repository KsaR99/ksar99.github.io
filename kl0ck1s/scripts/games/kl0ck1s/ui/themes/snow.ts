// @ts-nocheck
"use strict";

import {ThemeEffect} from "./theme-effect.js";
import {ParticleField, resizeParticleEffect} from "./particle-field.js";

const FLAKE_COLOR = "oklch(1 0 0 / 85%)";
const DENSITY = 1 / 6000; // flakes per square pixel

export class Snow extends ThemeEffect {

    flakes: ParticleField;

    constructor(canvas, ctx = null) {
        super(canvas, ctx);

        this.flakes = new ParticleField({
            x: Float32Array,
            y: Float32Array,
            radius: Float32Array,
            speed: Float32Array,
            drift: Float32Array,
            driftSpeed: Float32Array,
        });
    }

    _spawnFlake = (i, width, height, initial = false) => {
        const {x, y, radius, speed, drift, driftSpeed} = this.flakes;
        x[i] = Math.random() * width;
        y[i] = initial ? Math.random() * height : Math.random() * -height;
        radius[i] = 1 + Math.random() * 2.5;
        speed[i] = 0.6 + Math.random() * 1.4;
        drift[i] = Math.random() * Math.PI * 2;
        driftSpeed[i] = 0.01 + Math.random() * 0.02;
    };

    resize(width, height) {
        resizeParticleEffect(
            this, width, height,
            (w, h) => Math.max(10, Math.round(w * h * DENSITY)),
            this.flakes, this._spawnFlake
        );
    }

    drawFrame() {
        if (!this.shouldDrawFrame()) return;
        const {ctx, canvas} = this;
        const {count, x, y, radius, speed, drift, driftSpeed} = this.flakes;
        const width = this.logicalWidth;
        const height = this.logicalHeight;
        if (!count || width === 0 || height === 0) return;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = FLAKE_COLOR;

        ctx.beginPath();
        for (let i = 0; i < count; i++) {
            ctx.moveTo(x[i] + radius[i], y[i]);
            ctx.arc(x[i], y[i], radius[i], 0, Math.PI * 2);

            drift[i] += driftSpeed[i];
            x[i] += Math.sin(drift[i]) * 0.6;
            y[i] += speed[i];

            if (y[i] - radius[i] > height) {
                this._spawnFlake(i, width, 0);
                y[i] = -radius[i];
            }
        }
        ctx.fill();
    }
}
