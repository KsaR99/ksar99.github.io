"use strict";

const CHARS = "Kl0ck1's";
const FONT_SIZE = 18;
const FONT = `400 ${FONT_SIZE}px "Noto Sans Mono", monospace`;
const FALL_SPEED = 0.1; // Rows per rendered frame
const HEAD_COLOR = "oklch(0.751 0.133 144.116)";
const BODY_COLOR = "oklch(0.543 0.123 151.327)";
const DIM_COLOR = "oklch(0.363 0.093 151.376)";

const GLYPH_COLORS = [HEAD_COLOR, BODY_COLOR, DIM_COLOR];
const GLYPH_H = FONT_SIZE * 2;
const MIN_TAIL_LENGTH = 4;
const MAX_TAIL_LENGTH = 8;

let glyphSprites = null;
let columnSprites = null;

function getGlyphSprites() {
    if (glyphSprites) return glyphSprites;

    glyphSprites = GLYPH_COLORS.map((color) => {
        const row = new Array(CHARS.length);

        for (let c = 0; c < CHARS.length; c++) {
            const sprite = document.createElement("canvas");
            sprite.width = FONT_SIZE;
            sprite.height = GLYPH_H;

            const sctx = sprite.getContext("2d");
            sctx.font = FONT;
            sctx.textBaseline = "middle";
            sctx.fillStyle = color;
            sctx.fillText(CHARS[c], 0, GLYPH_H / 2);

            row[c] = sprite;
        }

        return row;
    });

    return glyphSprites;
}

function getColumnSprites() {
    if (columnSprites) return columnSprites;

    const sprites = new Array(CHARS.length);

    for (let charIndex = 0; charIndex < CHARS.length; charIndex++) {
        const tails = new Array(MAX_TAIL_LENGTH);

        for (
            let tailLength = MIN_TAIL_LENGTH;
            tailLength <= MAX_TAIL_LENGTH;
            tailLength++
        ) {
            const height = GLYPH_H + (tailLength - 1) * FONT_SIZE;
            const sprite = document.createElement("canvas");

            sprite.width = FONT_SIZE;
            sprite.height = height;

            const sctx = sprite.getContext("2d");

            const bodyEnd = tailLength * 0.5;
            const [headSprites, bodySprites, dimSprites] = glyphSprites;

            sctx.drawImage(
                headSprites[charIndex],
                0,
                0
            );

            for (let t = 1; t < bodyEnd; t++) {
                sctx.drawImage(
                    bodySprites[(charIndex + t) % CHARS.length],
                    0,
                    t * FONT_SIZE
                );
            }

            for (
                let t = Math.max(1, Math.ceil(bodyEnd));
                t < tailLength;
                t++
            ) {
                sctx.drawImage(
                    dimSprites[(charIndex + t) % CHARS.length],
                    0,
                    t * FONT_SIZE
                );
            }

            tails[tailLength] = sprite;
        }

        sprites[charIndex] = tails;
    }

    columnSprites = sprites;
    return columnSprites;
}

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

        getGlyphSprites();
        this._columnSprites = getColumnSprites();

        this._loop = this.loop.bind(this);
    }

    _spawnColumn(i, height, initial = false) {
        this.y[i] = initial
            ? Math.random() * height
            : -(FONT_SIZE + Math.random() * height * 0.3);

        this.speed[i] = 0.6 + Math.random() * 1.1;
        this.charIndex[i] = Math.floor(Math.random() * CHARS.length);
        this.switchEvery[i] = 6 + Math.floor(Math.random() * 14);
        this.tick[i] = Math.floor(Math.random() * 10);
        this.tailLength[i] =
            MIN_TAIL_LENGTH +
            Math.floor(Math.random() * (MAX_TAIL_LENGTH - MIN_TAIL_LENGTH + 1));
    }

    resize(width, height) {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));

        if (
            this._lastWidth === w &&
            this._lastHeight === h &&
            this.count
        ) {
            return;
        }

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

        for (let i = 0; i < this.count; i++) {
            this._spawnColumn(i, h, true);
        }

        this.ctx.clearRect(0, 0, w, h);
    }

    drawFrame() {
        const {
            ctx,
            canvas,
            count,
            y,
            speed,
            charIndex,
            switchEvery,
            tick,
            tailLength,
            _columnSprites: sprites
        } = this;

        const width = canvas.width;
        const height = canvas.height;

        if (!count || width === 0 || height === 0) return;

        ctx.clearRect(0, 0, width, height);

        const spriteDy = GLYPH_H / 2;

        for (let i = 0; i < count; i++) {
            const ty = y[i];
            const tail = tailLength[i];

            if (
                ty < -FONT_SIZE &&
                ty - tail * FONT_SIZE < -FONT_SIZE
            ) {
                continue;
            }

            if (ty - (tail - 1) * FONT_SIZE > height) {
                continue;
            }

            ctx.drawImage(
                sprites[charIndex[i]][tail],
                i * FONT_SIZE,
                ty - spriteDy
            );
        }

        for (let i = 0; i < count; i++) {
            y[i] += speed[i] * FONT_SIZE * FALL_SPEED;

            tick[i]++;

            if (tick[i] >= switchEvery[i]) {
                tick[i] = 0;
                charIndex[i] = (charIndex[i] + 1) % CHARS.length;
            }

            if (y[i] - tailLength[i] * FONT_SIZE > height) {
                this._spawnColumn(i, height);
            }
        }
    }

    loop() {
        if (!this.active) return;

        this.frameCount = (this.frameCount + 1) % 2;

        if (this.frameCount === 0) {
            this.drawFrame();
        }

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

        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
        }

        this.rafId = null;
        this.ctx.clearRect(
            0,
            0,
            this.canvas.width,
            this.canvas.height
        );
    }
}
