"use strict";

const ASH_COLOR = "oklch(0.472 0.059 47.407 / 0.75)";
const EMBER_COLOR = "oklch(0.725 0.178 46.868 / 0.9)";

const ASH_DENSITY = 1 / 27000; // ash spheres per square pixel (half as many as before)
const EMBER_DENSITY = 0.08;    // embers per pixel of width (3x more than before)

const GRAVITY = 0.05;          // pulls embers back down after launch

export class Volcano {
    constructor(canvas, ctx = null) {
        this.canvas = canvas;
        this.ctx = ctx ?? canvas.getContext("2d");
        this.active = false;
        this.rafId = null;
        this.frameCount = 0;

        this.ashCount = 0;
        this.ax = new Float32Array(0);
        this.ay = new Float32Array(0);
        this.aRadius = new Float32Array(0);
        this.aSpeed = new Float32Array(0);
        this.aDrift = new Float32Array(0);
        this.aDriftSpeed = new Float32Array(0);

        this.emberCount = 0;
        this.ex = new Float32Array(0);
        this.ey = new Float32Array(0);
        this.eLength = new Float32Array(0);
        this.evx = new Float32Array(0);
        this.evy = new Float32Array(0);

        this._loop = this.loop.bind(this);
    }

    _spawnAsh(i, width, height, initial = false) {
        this.ax[i] = Math.random() * width;
        this.ay[i] = initial ? Math.random() * height : Math.random() * -height;
        this.aRadius[i] = 1.5 + Math.random() * 8.5;
        this.aSpeed[i] = 0.15 + Math.random() * 1.5;
        this.aDrift[i] = Math.random() * Math.PI * 2;
        this.aDriftSpeed[i] = 0.005 + Math.random() * 0.015;
    }

    _spawnEmber(i, width, height) {
        this.ex[i] = Math.random() * width;
        this.ey[i] = Math.random() * height;
        this.eLength[i] = 1.5 + Math.random() * 7;

        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 4;
        this.evx[i] = Math.cos(angle) * speed;
        this.evy[i] = Math.sin(angle) * speed;
    }

    resize(width, height) {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        if (this._lastWidth === w && this._lastHeight === h && this.ashCount && this.emberCount) return;
        this._lastWidth = w;
        this._lastHeight = h;

        this.canvas.width = w;
        this.canvas.height = h;

        this.ashCount = Math.max(8, Math.round(w * h * ASH_DENSITY));
        this.ax = new Float32Array(this.ashCount);
        this.ay = new Float32Array(this.ashCount);
        this.aRadius = new Float32Array(this.ashCount);
        this.aSpeed = new Float32Array(this.ashCount);
        this.aDrift = new Float32Array(this.ashCount);
        this.aDriftSpeed = new Float32Array(this.ashCount);
        for (let i = 0; i < this.ashCount; i++) this._spawnAsh(i, w, h, true);

        this.emberCount = Math.max(4, Math.round(w * EMBER_DENSITY));
        this.ex = new Float32Array(this.emberCount);
        this.ey = new Float32Array(this.emberCount);
        this.eLength = new Float32Array(this.emberCount);
        this.evx = new Float32Array(this.emberCount);
        this.evy = new Float32Array(this.emberCount);
        for (let i = 0; i < this.emberCount; i++) this._spawnEmber(i, w, h);

        this.ctx.clearRect(0, 0, w, h);
    }

    drawFrame() {
        const {ctx, canvas} = this;
        if (canvas.width === 0 || canvas.height === 0) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (this.ashCount) {
            const {ax, ay, aRadius, aSpeed, aDrift, aDriftSpeed, ashCount} = this;
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

        if (this.emberCount) {
            const {ex, ey, eLength, evx, evy, emberCount} = this;
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
