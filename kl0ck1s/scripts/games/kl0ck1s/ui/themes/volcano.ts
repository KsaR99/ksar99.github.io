// @ts-nocheck
"use strict";

import {ThemeEffect} from "./theme-effect.js";
import {ParticleField} from "./particle-field.js";

const ASH_COLOR = "oklch(0.35 0 0 / 75%)";
const EMBER_COLOR = "oklch(0.725 0.178 46.868 / 0.9)";

const ASH_DENSITY = 1 / 27000;
const EMBER_DENSITY = 0.08;

const GRAVITY = 0.05;
const EMBER_SPEED_MULTIPLIER = 0.7;

export class Volcano extends ThemeEffect {

    ash: ParticleField;
    embers: ParticleField;

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
        speed[i] = 0.5 + (10 - radius[i]) * 0.18;
        drift[i] = Math.random() * Math.PI * 2;
        driftSpeed[i] = 0.005 + Math.random() * 0.015;
    };

    _spawnEmber = (i, width, height, initial = false) => {
        const {x, y, length, vx, vy} = this.embers;
        const startX = width * (0.45 + Math.random() * 0.1);
        const startY = height * 0.05;

        x[i] = startX;
        y[i] = startY;

        length[i] = 1.5 + Math.random() * 7;

        const angle = Math.PI * (0.175 + Math.random() * 0.65);
        const speed = (1 + Math.random() * 4) * EMBER_SPEED_MULTIPLIER;

        vx[i] = Math.cos(angle) * speed;
        vy[i] = Math.sin(angle) * speed;

        if (initial) {
            const frames =
                Math.random() *
                (height * 0.55) /
                speed;

            x[i] += vx[i] * frames;

            y[i] +=
                vy[i] * frames +
                0.5 * GRAVITY * frames * frames;

            vy[i] += GRAVITY * frames;
        }
    };

    resize(width, height) {
        const {w, h, unchanged} = this.resizeCanvas(
            width,
            height,
            this.ash.count && this.embers.count
        );

        if (unchanged) return;

        this.ash.allocate(
            Math.max(8, Math.round(w * h * ASH_DENSITY)),
            this._spawnAsh,
            w,
            h
        );

        this.embers.allocate(
            Math.max(4, Math.round(w * EMBER_DENSITY)),
            (i, width, height) =>
                this._spawnEmber(i, width, height, true),
            w,
            h
        );

        this.ctx.clearRect(0, 0, w, h);
    }

    drawFrame() {
        if (!this.shouldDrawFrame()) return;
        const {ctx, canvas} = this;

        const width = this.logicalWidth;
        const height = this.logicalHeight;
        if (width === 0 || height === 0) return;

        ctx.clearRect(0, 0, width, height);

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

            ctx.beginPath();

            for (let i = 0; i < ashCount; i++) {
                const yRatio = ay[i] / height;

                const ashSizeMultiplier =
                    yRatio < 0.25
                        ? 1.5 - yRatio * 2
                        : 1;

                const radius = aRadius[i] * ashSizeMultiplier;

                ctx.moveTo(ax[i] + radius, ay[i]);
                ctx.arc(
                    ax[i],
                    ay[i],
                    radius,
                    0,
                    Math.PI * 2
                );

                aDrift[i] += aDriftSpeed[i];

                ax[i] += Math.sin(aDrift[i]) * 0.4;
                ay[i] += aSpeed[i];

                if (ay[i] - aRadius[i] > height) {
                    this._spawnAsh(i, width, 0);
                    ay[i] = -aRadius[i];
                }
            }

            ctx.fill();
        }

        const {
            count: emberCount,
            x: ex,
            y: ey,
            length: eLength,
            vx: evx,
            vy: evy
        } = this.embers;

        if (emberCount) {
            ctx.strokeStyle = EMBER_COLOR;
            ctx.lineWidth = 1.5;
            ctx.lineCap = "round";

            ctx.beginPath();

            for (let i = 0; i < emberCount; i++) {
                const yRatio = ey[i] / height;

                let sizeMultiplier;

                if (yRatio < 0.4) {
                    sizeMultiplier = 3 - yRatio * 4.5;
                } else if (yRatio < 0.5) {
                    sizeMultiplier = 1.2;
                } else {
                    const steps = Math.floor((yRatio - 0.5) / 0.15);
                    sizeMultiplier = 1.5 + steps * 0.3;
                }
                const len = eLength[i] * sizeMultiplier;

                const mag = Math.hypot(evx[i], evy[i]) || 1;

                const tx =
                    ex[i] -
                    (evx[i] / mag) * len;

                const ty =
                    ey[i] -
                    (evy[i] / mag) * len;

                ctx.moveTo(ex[i], ey[i]);
                ctx.lineTo(tx, ty);

                const speedMultiplier = ey[i] < height * 0.5 ? 0.5 : 1;

                evy[i] += GRAVITY;

                ex[i] += evx[i] * speedMultiplier;
                ey[i] += evy[i] * speedMultiplier;

                const offCanvas =
                    ey[i] - len > height ||
                    ey[i] + len < 0 ||
                    ex[i] < -len ||
                    ex[i] > width + len;

                if (offCanvas) {
                    this._spawnEmber(
                        i,
                        width,
                        height
                    );
                }
            }

            ctx.stroke();
        }
    }
}
