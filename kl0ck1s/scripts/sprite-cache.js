"use strict";

export function createBlockSprite(color, size, canvasFactory = () => document.createElement("canvas")) {
    const sprite = canvasFactory();
    sprite.width = size;
    sprite.height = size;

    const sctx = sprite.getContext("2d");
    sctx.imageSmoothingEnabled = false;

    const bevel = Math.max(2, Math.round(size * 0.16));

    sctx.fillStyle = color;
    sctx.fillRect(0, 0, size, size);

    sctx.fillStyle = "oklch(1 0 0 / 35%)";
    sctx.beginPath();
    sctx.moveTo(0, 0);
    sctx.lineTo(size, 0);
    sctx.lineTo(size - bevel, bevel);
    sctx.lineTo(bevel, bevel);
    sctx.lineTo(bevel, size - bevel);
    sctx.lineTo(0, size);
    sctx.closePath();
    sctx.fill();

    sctx.fillStyle = "oklch(0 0 0 / 35%)";
    sctx.beginPath();
    sctx.moveTo(size, 0);
    sctx.lineTo(size, size);
    sctx.lineTo(0, size);
    sctx.lineTo(bevel, size - bevel);
    sctx.lineTo(size - bevel, size - bevel);
    sctx.lineTo(size - bevel, bevel);
    sctx.closePath();
    sctx.fill();

    sctx.strokeStyle = "oklch(0 0 0 / 30%)";
    sctx.lineWidth = 1;
    sctx.strokeRect(0.5, 0.5, size - 1, size - 1);

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
