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

const TILE_HEIGHT_DIVISOR = 10;
const TILE_HEIGHT_MIN = 8;
const LINE_ROWS = 3;

export class VHS {
    constructor(canvas, ctx = null) {
        this.canvas = canvas;
        this.ctx = ctx ?? canvas.getContext("2d");
        this.active = false;
        this.rafId = null;
        this.frameCount = 0;

        this._scanCanvas = document.createElement("canvas");
        this._scanCanvas.className = canvas.className;
        this._scanCanvas.style.cssText = canvas.style.cssText;
        this._scanCanvas.style.pointerEvents = "none";
        canvas.insertAdjacentElement("afterend", this._scanCanvas);
        this._scanCtx = this._scanCanvas.getContext("2d");

        this._staticTile = document.createElement("canvas");
        this._staticTileCtx = this._staticTile.getContext("2d");

        this._lineImageData = null;
        this._lineBuf32 = null;

        this.scanlines = Array.from({length: 3}, () => ({
            y: 0,
            speed: 0,
            hidden: false
        }));

        this._noisePixel = new Uint32Array(NOISE_SIZE);
        this._noiseSkip = new Uint8Array(NOISE_SIZE);
        this._noiseScanColor = new Uint32Array(NOISE_SIZE);
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

    _drawStaticBase(width, height) {
        const tileHeight = Math.max(TILE_HEIGHT_MIN, Math.min(height, Math.round(height / TILE_HEIGHT_DIVISOR)));
        this._staticTile.width = width;
        this._staticTile.height = tileHeight;

        const staticImageData = this._staticTileCtx.createImageData(width, tileHeight);
        const staticBuf32 = new Uint32Array(staticImageData.data.buffer);

        let t = 0;
        for (let i = 0; i < staticBuf32.length; i += 4) {
            staticBuf32[i] = this._noisePixel[t];
            t = (t + 1) & NOISE_MASK;
        }
        this._staticTileCtx.putImageData(staticImageData, 0, 0);

        this.ctx.clearRect(0, 0, width, height);
        this.ctx.fillStyle = this.ctx.createPattern(this._staticTile, "repeat");
        this.ctx.fillRect(0, 0, width, height);
    }

    resize(width, height) {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        if (this.canvas.width === w && this.canvas.height === h) return;

        this.canvas.width = w;
        this.canvas.height = h;
        this._scanCanvas.width = w;
        this._scanCanvas.height = h;

        this._drawStaticBase(w, h);

        this._lineImageData = this._scanCtx.createImageData(w, LINE_ROWS);
        this._lineBuf32 = new Uint32Array(this._lineImageData.data.buffer);

        this.scanlines.forEach((line) => {
            line.y = Math.random() * h;
            line.speed = 1.0 + Math.random() * 0.8;
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

    _drawScanline(line, width, height) {
        const y = Math.floor(line.y);
        const noiseSkip = this._noiseSkip;
        const noiseScanColor = this._noiseScanColor;
        const lineBuf32 = this._lineBuf32;

        lineBuf32.fill(0);
        let visible = false;

        for (let yy = 0; yy < LINE_ROWS; yy++) {
            const row = y + yy;
            if (row < 0 || row >= height) continue;
            visible = true;

            let idx = yy * width;
            let t2 = row & NOISE_MASK;
            for (let x = 0; x < width; x++, idx++, t2 = (t2 + 1) & NOISE_MASK) {
                if (noiseSkip[t2]) continue;
                lineBuf32[idx] = noiseScanColor[t2];
            }
        }

        if (!visible) return;

        this._scanCtx.putImageData(this._lineImageData, 0, y);
    }

    drawFrame() {
        const {canvas} = this;
        if (!this._lineBuf32 || canvas.width === 0 || canvas.height === 0) return;

        const width = canvas.width;
        const height = canvas.height;

        this._regenNoise();
        this._scanCtx.clearRect(0, 0, width, height);

        this.updateOverlaps();

        for (const line of this.scanlines) {
            if (!line.hidden) this._drawScanline(line, width, height);
            line.y += line.speed;
        }

        for (const line of this.scanlines) {
            if (line.y >= height + 2) {
                line.y = -(height * (0.02 + Math.random() * 0.08));
                line.speed = 0.6 + Math.random() * 1.8;
                line.hidden = false;
            }
        }
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
        if (!this.active) return;
        this.active = false;
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
        this.rafId = null;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this._scanCtx.clearRect(0, 0, this._scanCanvas.width, this._scanCanvas.height);
    }
}
