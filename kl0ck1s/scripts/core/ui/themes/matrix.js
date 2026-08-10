"use strict";

const CHARS = "Kl0ck1's";
const FONT_SIZE = 22;
const FALL_SPEED = 0.1; // Rows per rendered frame
const HEAD_COLOR = "oklch(0.751 0.133 144.116)";
const BODY_COLOR = "oklch(0.543 0.123 151.327)";
const DIM_COLOR = "oklch(0.3 0.075 152.239)";

export class Matrix {
    constructor(canvas, ctx = null) {
        this.canvas = canvas;
        this.ctx = ctx ?? canvas.getContext("2d");
        this.active = false;
        this.rafId = null;
        this.frameCount = 0;

        this.count = 0;
        this.y = new Float32Array(0);
        this.speed = new Float32Array(0);
        this.charIndex = new Uint8Array(0);
        this.switchEvery = new Uint8Array(0);
        this.tick = new Uint8Array(0);
        this.tailLength = new Uint8Array(0);

        this._loop = this.loop.bind(this);
    }

    _spawnColumn(i, height, initial = false) {
        this.y[i] = initial ? Math.random() * height : Math.random() * -height;
        this.speed[i] = 0.6 + Math.random() * 1.1;
        this.charIndex[i] = Math.floor(Math.random() * CHARS.length);
        this.switchEvery[i] = 6 + Math.floor(Math.random() * 14);
        this.tick[i] = Math.floor(Math.random() * 10);
        this.tailLength[i] = 4 + Math.floor(Math.random() * 5);
    }

    resize(width, height) {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        if (this._lastWidth === w && this._lastHeight === h && this.count) return;
        this._lastWidth = w;
        this._lastHeight = h;

        this.canvas.width = w;
        this.canvas.height = h;

        this.count = Math.max(1, Math.floor(w / FONT_SIZE));
        this.y = new Float32Array(this.count);
        this.speed = new Float32Array(this.count);
        this.charIndex = new Uint8Array(this.count);
        this.switchEvery = new Uint8Array(this.count);
        this.tick = new Uint8Array(this.count);
        this.tailLength = new Uint8Array(this.count);
        for (let i = 0; i < this.count; i++) this._spawnColumn(i, h, true);
        this.ctx.clearRect(0, 0, w, h);
    }

    drawFrame() {
        const {ctx, canvas, count, y, charIndex, tailLength} = this;
        if (!count || canvas.width === 0 || canvas.height === 0) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.font = `400 ${FONT_SIZE}px "Noto Sans Mono", monospace`;
        ctx.textBaseline = "middle";

        ctx.fillStyle = HEAD_COLOR;
        for (let i = 0; i < count; i++) {
            const ty = y[i];
            if (ty < -FONT_SIZE || ty > canvas.height) continue;
            ctx.fillText(CHARS[charIndex[i]], i * FONT_SIZE, ty);
        }

        ctx.fillStyle = BODY_COLOR;
        for (let i = 0; i < count; i++) {
            const tail = tailLength[i];
            const bodyEnd = tail * 0.5;
            const x = i * FONT_SIZE;
            for (let t = 1; t < bodyEnd; t++) {
                const ty = y[i] - t * FONT_SIZE;
                if (ty < -FONT_SIZE || ty > canvas.height) continue;
                ctx.fillText(CHARS[(charIndex[i] + t) % CHARS.length], x, ty);
            }
        }

        ctx.fillStyle = DIM_COLOR;
        for (let i = 0; i < count; i++) {
            const tail = tailLength[i];
            const bodyEnd = tail * 0.5;
            const x = i * FONT_SIZE;
            for (let t = Math.max(1, Math.ceil(bodyEnd)); t < tail; t++) {
                const ty = y[i] - t * FONT_SIZE;
                if (ty < -FONT_SIZE || ty > canvas.height) continue;
                ctx.fillText(CHARS[(charIndex[i] + t) % CHARS.length], x, ty);
            }
        }

        const {speed, switchEvery, tick} = this;
        for (let i = 0; i < count; i++) {
            y[i] += speed[i] * FONT_SIZE * FALL_SPEED;
            tick[i]++;
            if (tick[i] >= switchEvery[i]) {
                tick[i] = 0;
                charIndex[i] = (charIndex[i] + 1) % CHARS.length;
            }

            if (y[i] - tailLength[i] * FONT_SIZE > canvas.height) {
                const height = canvas.height;
                this._spawnColumn(i, height);
                y[i] = -(FONT_SIZE + Math.random() * height * 0.3);
            }
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
