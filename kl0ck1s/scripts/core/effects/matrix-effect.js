"use strict";

const CHARS = "Kl0ck1's";
const FONT_SIZE = 24;
const FALL_SPEED = 0.085; // rows per rendered frame (frame is throttled below)
const HEAD_COLOR = "oklch(0.85 0.1 144.74)";
const BODY_COLOR = "oklch(0.763 0.214 148.729)";
const DIM_COLOR = "oklch(0.451 0.121 149.242)";

export class MatrixEffect {
    constructor(canvas, ctx = null) {
        this.canvas = canvas;
        this.ctx = ctx ?? canvas.getContext("2d");
        this.active = false;
        this.rafId = null;
        this.frameCount = 0;
        this.columns = [];
        this._loop = this.loop.bind(this);
    }

    _spawnColumn(height, initial = false) {
        return {
            y: initial ? Math.random() * height : Math.random() * -height,
            speed: 0.6 + Math.random() * 1.1,
            charIndex: Math.floor(Math.random() * CHARS.length),
            switchEvery: 6 + Math.floor(Math.random() * 14),
            tick: Math.floor(Math.random() * 10),
            tailLength: 4 + Math.floor(Math.random() * 5),
        };
    }

    resize(width, height) {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        if (this._lastWidth === w && this._lastHeight === h && this.columns.length) return;
        this._lastWidth = w;
        this._lastHeight = h;

        this.canvas.width = w;
        this.canvas.height = h;

        const columnCount = Math.max(1, Math.floor(w / FONT_SIZE));
        this.columns = Array.from({length: columnCount}, () => this._spawnColumn(h, true));
        this.ctx.clearRect(0, 0, w, h);
    }

    drawFrame() {
        const {ctx, canvas, columns} = this;
        if (!columns.length || canvas.width === 0 || canvas.height === 0) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.font = `400 ${FONT_SIZE}px "Noto Sans Mono", monospace`;
        ctx.textBaseline = "middle";

        columns.forEach((col, i) => {
            const x = i * FONT_SIZE;

            for (let t = 0; t < col.tailLength; t++) {
                const y = col.y - t * FONT_SIZE;
                if (y < -FONT_SIZE || y > canvas.height) continue;

                const charIndex = (col.charIndex + t) % CHARS.length;
                const char = CHARS[charIndex];

                if (t === 0) ctx.fillStyle = HEAD_COLOR;
                else if (t < col.tailLength * 0.5) ctx.fillStyle = BODY_COLOR;
                else ctx.fillStyle = DIM_COLOR;

                ctx.fillText(char, x, y);
            }

            col.y += col.speed * FONT_SIZE * FALL_SPEED;
            ++col.tick;
            if (col.tick >= col.switchEvery) {
                col.tick = 0;
                col.charIndex = (col.charIndex + 1) % CHARS.length;
            }

            if (col.y - col.tailLength * FONT_SIZE > canvas.height) {
                const height = canvas.height;
                Object.assign(col, this._spawnColumn(height), {
                    y: -(FONT_SIZE + Math.random() * height * 0.3),
                });
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
