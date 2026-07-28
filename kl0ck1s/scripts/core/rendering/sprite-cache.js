"use strict";

export function createBlockSprite(color, size, canvasFactory = () => document.createElement("canvas")) {
    const sprite = canvasFactory();
    sprite.width = size;
    sprite.height = size;

    const spriteCtx = sprite.getContext("2d");
    spriteCtx.imageSmoothingEnabled = false;

    const bevel = Math.max(2, Math.round(size * 0.16));

    spriteCtx.fillStyle = color;
    spriteCtx.fillRect(0, 0, size, size);

    spriteCtx.fillStyle = "oklch(1 0 0 / 40%)";
    spriteCtx.beginPath();
    spriteCtx.moveTo(0, 0);
    spriteCtx.lineTo(size, 0);
    spriteCtx.lineTo(size - bevel, bevel);
    spriteCtx.lineTo(bevel, bevel);
    spriteCtx.lineTo(bevel, size - bevel);
    spriteCtx.lineTo(0, size);
    spriteCtx.closePath();
    spriteCtx.fill();

    spriteCtx.fillStyle = "oklch(0 0 0 / 25%)";
    spriteCtx.beginPath();
    spriteCtx.moveTo(size, 0);
    spriteCtx.lineTo(size, size);
    spriteCtx.lineTo(0, size);
    spriteCtx.lineTo(bevel, size - bevel);
    spriteCtx.lineTo(size - bevel, size - bevel);
    spriteCtx.lineTo(size - bevel, bevel);
    spriteCtx.closePath();
    spriteCtx.fill();

    spriteCtx.strokeStyle = "oklch(0.5 0 0 / 30%)";
    spriteCtx.lineWidth = 1;
    spriteCtx.strokeRect(0.5, 0.5, size - 1, size - 1);

    return sprite;
}

export class SpriteCache {
    constructor(klockominos, canvasFactory) {
        this.klockominos = klockominos;
        this.canvasFactory = canvasFactory;
        this.size = 0;
        this.sprites = new Map();
    }

    rebuild(size) {
        this.size = size;
        this.sprites.clear();
        Object.values(this.klockominos).forEach(({color}) => {
            this.sprites.set(color, createBlockSprite(color, this.size, this.canvasFactory));
        });
    }

    get(color, currentSize) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        return this.sprites.get(color);
    }
}
