"use strict";

const GLOW_BLUR_RATIO = 0.4;
const GHOST_ALPHA = 0.3;

export function createBlockSprite(color, size, canvasFactory = () => document.createElement("canvas")) {
    const sprite = canvasFactory();
    sprite.width = size;
    sprite.height = size;

    const spriteCtx = sprite.getContext("2d", {colorSpace: "display-p3"});
    spriteCtx.imageSmoothingEnabled = false;

    const bevel = Math.max(1.5, Math.round(size * 0.16));

    spriteCtx.fillStyle = color;
    spriteCtx.fillRect(0, 0, size, size);

    spriteCtx.fillStyle = "oklch(1 0 0 / 0.5)";
    spriteCtx.beginPath();
    spriteCtx.moveTo(0, 0);
    spriteCtx.lineTo(size, 0);
    spriteCtx.lineTo(size - bevel, bevel);
    spriteCtx.lineTo(bevel, bevel);
    spriteCtx.lineTo(bevel, size - bevel);
    spriteCtx.lineTo(0, size);
    spriteCtx.closePath();
    spriteCtx.fill();

    spriteCtx.fillStyle = "oklch(0 0 0 /  0.5)";
    spriteCtx.beginPath();
    spriteCtx.moveTo(size, 0);
    spriteCtx.lineTo(size, size);
    spriteCtx.lineTo(0, size);
    spriteCtx.lineTo(bevel, size - bevel);
    spriteCtx.lineTo(size - bevel, size - bevel);
    spriteCtx.lineTo(size - bevel, bevel);
    spriteCtx.closePath();
    spriteCtx.fill();

    spriteCtx.strokeStyle = "oklch(0 0 0 / 0.6)";
    spriteCtx.lineWidth = 1;
    spriteCtx.strokeRect(0.5, 0.5, size - 1, size - 1);

    return sprite;
}

export function createGlowSprite(color, size, canvasFactory = () => document.createElement("canvas")) {
    const blur = size * GLOW_BLUR_RATIO;
    const pad = Math.ceil(blur);
    const base = createBlockSprite(color, size, canvasFactory);

    const sprite = canvasFactory();
    sprite.width = size + pad * 2;
    sprite.height = size + pad * 2;

    const spriteCtx = sprite.getContext("2d", {colorSpace: "display-p3"});
    spriteCtx.imageSmoothingEnabled = false;

    spriteCtx.shadowColor = color;
    spriteCtx.shadowBlur = blur;
    spriteCtx.fillStyle = color;
    spriteCtx.fillRect(pad, pad, size, size);

    spriteCtx.shadowBlur = 0;
    spriteCtx.drawImage(base, pad, pad);

    return sprite;
}

export function createGhostSprite(color, size, canvasFactory = () => document.createElement("canvas")) {
    const base = createBlockSprite(color, size, canvasFactory);

    const sprite = canvasFactory();
    sprite.width = size;
    sprite.height = size;

    const spriteCtx = sprite.getContext("2d", {colorSpace: "display-p3"});
    spriteCtx.imageSmoothingEnabled = false;
    spriteCtx.globalAlpha = GHOST_ALPHA;
    spriteCtx.drawImage(base, 0, 0);

    return sprite;
}

export class SpriteCache {
    constructor(klockominos, canvasFactory) {
        this.klockominos = klockominos;
        this.canvasFactory = canvasFactory;
        this.size = 0;
        this.glowPad = 0;
        this.sprites = new Map();
        this.glowSprites = new Map();
        this.ghostSprites = new Map();
    }

    rebuild(size) {
        this.size = size;
        this.glowPad = Math.ceil(size * GLOW_BLUR_RATIO);
        this.sprites.clear();
        this.glowSprites.clear();
        this.ghostSprites.clear();

        const colors = new Set(Object.values(this.klockominos).map(({color}) => color));
        colors.forEach((color) => {
            this.sprites.set(color, createBlockSprite(color, this.size, this.canvasFactory));
            this.glowSprites.set(color, createGlowSprite(color, this.size, this.canvasFactory));
            this.ghostSprites.set(color, createGhostSprite(color, this.size, this.canvasFactory));
        });
    }

    get(color, currentSize) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        if (!this.sprites.has(color)) {
            this.sprites.set(color, createBlockSprite(color, this.size, this.canvasFactory));
        }
        return this.sprites.get(color);
    }

    getGlow(color, currentSize) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        if (!this.glowSprites.has(color)) {
            this.glowSprites.set(color, createGlowSprite(color, this.size, this.canvasFactory));
        }
        return this.glowSprites.get(color);
    }

    getGhost(color, currentSize) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        if (!this.ghostSprites.has(color)) {
            this.ghostSprites.set(color, createGhostSprite(color, this.size, this.canvasFactory));
        }
        return this.ghostSprites.get(color);
    }
}
