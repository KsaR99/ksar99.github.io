"use strict";

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function packRGBA(r, g, b, a) {
    return LITTLE_ENDIAN
        ? ((a << 24) | (b << 16) | (g << 8) | r)
        : ((r << 24) | (g << 16) | (b << 8) | a);
}

const SCANLINE_COLORS = [
    [255, 255, 255],
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
].map(([r, g, b]) => packRGBA(r, g, b, 155));

const OVERLAP_THRESHOLD = 3;

const NOISE_SIZE = 256;
const NOISE_MASK = NOISE_SIZE - 1;

export class VhsNoise {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d", {colorSpace: "display-p3", willReadFrequently: true});
        this.active = false;
        this.rafId = null;
        this.frameCount = 0;

        this.imageData = null;
        this.buf32 = null;

        this.scanlines = Array.from({length: 4}, () => ({
            y: 0,
            speed: 0,
            hidden: false
        }));

        this._noisePixel = new Uint32Array(NOISE_SIZE);
        this._noiseSkip = new Uint8Array(NOISE_SIZE);
        this._noiseScanColor = new Uint32Array(NOISE_SIZE);
        this._noiseOffset = 0;
        this._regenNoise();

        this._loop = this.loop.bind(this);
    }

    _regenNoise() {
        for (let i = 0; i < NOISE_SIZE; i++) {
            const shade = Math.random() < 0.5 ? 255 : 0;
            const alpha = Math.random() * 20;
            this._noisePixel[i] = packRGBA(shade, shade, shade, alpha);
            this._noiseSkip[i] = Math.random() < 0.15 ? 1 : 0;
            this._noiseScanColor[i] = SCANLINE_COLORS[Math.floor(Math.random() * SCANLINE_COLORS.length)];
        }
    }

    resize(width, height) {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        if (this.canvas.width === w && this.canvas.height === h) return;

        this.canvas.width = w;
        this.canvas.height = h;

        this.imageData = this.ctx.createImageData(w, h);
        this.buf32 = new Uint32Array(this.imageData.data.buffer);

        this.scanlines.forEach((line) => {
            line.y = Math.random() * h;
            line.speed = 0.4 + Math.random() * 1.2;
            line.hidden = false;
        });
    }

    updateOverlaps() {
        const lines = this.scanlines;
        for (let i = 0; i < lines.length; i++) {
            for (let j = i + 1; j < lines.length; j++) {
                const a = lines[i];
                const b = lines[j];
                if (a.hidden || b.hidden) continue;
                if (Math.abs(a.y - b.y) < OVERLAP_THRESHOLD) {
                    b.hidden = true;
                }
            }
        }
    }

    drawFrame() {
        const {ctx, canvas, buf32} = this;
        if (!buf32 || canvas.width === 0 || canvas.height === 0) return;

        buf32.fill(0);

        const width = canvas.width;
        const height = canvas.height;

        this._regenNoise();
        const noisePixel = this._noisePixel;
        const offset = (this._noiseOffset + 1) & NOISE_MASK;
        this._noiseOffset = offset;

        let t = offset;
        for (let i = 0; i < buf32.length; i += 4) {
            buf32[i] = noisePixel[t];
            t = (t + 1) & NOISE_MASK;
        }

        this.updateOverlaps();

        const noiseSkip = this._noiseSkip;
        const noiseScanColor = this._noiseScanColor;

        for (const line of this.scanlines) {
            if (!line.hidden) {
                const y = Math.floor(line.y);

                for (let yy = 0; yy < 2; yy++) {
                    const row = y + yy;
                    if (row < 0 || row >= height) continue;

                    let idx = row * width;
                    let t2 = (offset + row) & NOISE_MASK;
                    for (let x = 0; x < width; x++, idx++, t2 = (t2 + 1) & NOISE_MASK) {
                        if (noiseSkip[t2]) continue;
                        buf32[idx] = noiseScanColor[t2];
                    }
                }
            }

            line.y += line.speed;
        }

        for (const line of this.scanlines) {
            if (line.y >= height + 2) {
                line.y = -(height * (0.02 + Math.random() * 0.08));
                line.speed = 0.6 + Math.random() * 1.8;
                line.hidden = false;
            }
        }

        ctx.putImageData(this.imageData, 0, 0);
    }

    loop() {
        if (!this.active) return;
        this.frameCount = (this.frameCount + 1) % 3;
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
        this.active = false;
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
        this.rafId = null;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
}