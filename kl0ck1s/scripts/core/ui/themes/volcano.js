"use strict";

import {ThemeEffect} from "./theme-effect.js";
import {ParticleField} from "./particle-field.js";

const ASH_COLOR = "oklch(0.4853 0.0567 47.41 / 75%)";
const EMBER_COLOR = "oklch(0.725 0.178 46.868 / 0.9)";

const ASH_DENSITY = 1 / 27000; // ash spheres per square pixel (half as many as before)
const EMBER_DENSITY = 0.08;    // embers per pixel of width (3x more than before)

const GRAVITY = 0.05;          // pulls embers back down after launch

export class Volcano extends ThemeEffect {
    constructor(canvas, ctx = null) {
        super(canvas, ctx);

        this.ash = new ParticleField({
            x: Float32Array, y: Float32Array, radius: Float32Array,
            speed: Float32Array, drift: Float32Array, driftSpeed: Float32Array,
        });
        this.embers = new ParticleField({
            x: Float32Array, y: Float32Array, length: Float32Array,
            vx: Float32Array, vy: Float32Array,
        });
    }

    _spawnAsh = (i, width, height, initial = false) => {
        const {x, y, radius, speed, drift, driftSpeed} = this.ash;
        x[i] = Math.random() * width;
        y[i] = initial ? Math.random() * height : Math.random() * -height;
        radius[i] = 1.5 + Math.random() * 8.5;
        speed[i] = 0.15 + Math.random() * 1.5;
        drift[i] = Math.random() * Math.PI * 2;
        driftSpeed[i] = 0.005 + Math.random() * 0.015;
    };

    _spawnEmber = (i, width, height) => {
        const {x, y, length, vx, vy} = this.embers;
        x[i] = Math.random() * width;
        y[i] = Math.random() * height;
        length[i] = 1.5 + Math.random() * 7;

        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 4;
        vx[i] = Math.cos(angle) * speed;
        vy[i] = Math.sin(angle) * speed;
    };

    resize(width, height) {
        const {w, h, unchanged} = this.resizeCanvas(width, height, this.ash.count && this.embers.count);
        if (unchanged) return;

        this.ash.allocate(Math.max(8, Math.round(w * h * ASH_DENSITY)), this._spawnAsh, w, h);
        this.embers.allocate(Math.max(4, Math.round(w * EMBER_DENSITY)), this._spawnEmber, w, h);
        this.ctx.clearRect(0, 0, w, h);
    }

    drawFrame() {
        const {ctx, canvas} = this;
        if (canvas.width === 0 || canvas.height === 0) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const {
            count: ashCount,
            x: ax,
            y: ay,
            radius: aRadius,
            speed: aSpeed,
            drift: aDrift,
            driftSpeed: aDriftSpeed
        } = this.ash;
        if (ashCount) {
            ctx.fillStyle = ASH_COLOR;
            const ashPath = new Path2D();
            for (let i = 0; i < ashCount; i++) {
                ashPath.moveTo(ax[i] + aRadius[i], ay[i]);
                ashPath.arc(ax[i], ay[i], aRadius[i], 0, Math.PI * 2);

                aDrift[i] += aDriftSpeed[i];
                ax[i] += Math.sin(aDrift[i]) * 0.4;
                ay[i] += aSpeed[i];

                if (ay[i] - aRadius[i] > canvas.height) {
                    this._spawnAsh(i, canvas.width, 0);
                    ay[i] = -aRadius[i];
                }
            }
            ctx.fill(ashPath);
        }

        const {count: emberCount, x: ex, y: ey, length: eLength, vx: evx, vy: evy} = this.embers;
        if (emberCount) {
            ctx.strokeStyle = EMBER_COLOR;
            ctx.lineWidth = 1.5;
            ctx.lineCap = "round";
            const emberPath = new Path2D();
            for (let i = 0; i < emberCount; i++) {
                const len = eLength[i];
                const mag = Math.hypot(evx[i], evy[i]) || 1;
                const tx = ex[i] - (evx[i] / mag) * len;
                const ty = ey[i] - (evy[i] / mag) * len;
                emberPath.moveTo(ex[i], ey[i]);
                emberPath.lineTo(tx, ty);

                evy[i] += GRAVITY;
                ex[i] += evx[i];
                ey[i] += evy[i];

                const offCanvas =
                    ey[i] - len > canvas.height ||
                    ey[i] + len < 0 ||
                    ex[i] < -len ||
                    ex[i] > canvas.width + len;
                if (offCanvas) this._spawnEmber(i, canvas.width, canvas.height);
            }
            ctx.stroke(emberPath);
        }
    }
}
