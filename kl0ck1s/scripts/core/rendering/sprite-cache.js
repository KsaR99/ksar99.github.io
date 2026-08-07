"use strict";

const GLOW_BLUR_RATIO = 0.1;
export const GHOST_ALPHA = 0.3;

export const SATURATION_STEP = 0.05;
export const SATURATION_LEVELS = Math.round(1 / SATURATION_STEP) + 1; // 21

const MAX_DYNAMIC_ATLAS_ROWS = 32;

export function factorForLevel(level) {
    return Math.max(0, 1 - level * SATURATION_STEP);
}

export function colorForLevel(color, level) {
    if (level <= 0) return color;
    return `oklch(from ${color} l calc(c * ${factorForLevel(level)}) h)`;
}

function paintBlock(spriteCtx, ox, oy, size, color) {
    const bevel = Math.max(1.5, Math.round(size * 0.16));

    spriteCtx.fillStyle = color;
    spriteCtx.fillRect(ox, oy, size, size);

    spriteCtx.fillStyle = "oklch(1 0 0 / 0.5)";
    spriteCtx.beginPath();
    spriteCtx.moveTo(ox, oy);
    spriteCtx.lineTo(ox + size, oy);
    spriteCtx.lineTo(ox + size - bevel, oy + bevel);
    spriteCtx.lineTo(ox + bevel, oy + bevel);
    spriteCtx.lineTo(ox + bevel, oy + size - bevel);
    spriteCtx.lineTo(ox, oy + size);
    spriteCtx.closePath();
    spriteCtx.fill();

    spriteCtx.fillStyle = "oklch(0 0 0 /  0.5)";
    spriteCtx.beginPath();
    spriteCtx.moveTo(ox + size, oy);
    spriteCtx.lineTo(ox + size, oy + size);
    spriteCtx.lineTo(ox, oy + size);
    spriteCtx.lineTo(ox + bevel, oy + size - bevel);
    spriteCtx.lineTo(ox + size - bevel, oy + size - bevel);
    spriteCtx.lineTo(ox + size - bevel, oy + bevel);
    spriteCtx.closePath();
    spriteCtx.fill();

    spriteCtx.strokeStyle = "oklch(0 0 0 / 0.6)";
    spriteCtx.lineWidth = 1;
    spriteCtx.strokeRect(ox + 0.5, oy + 0.5, size - 1, size - 1);
}

export function createBlockSprite(color, size, canvasFactory = () => document.createElement("canvas")) {
    const sprite = canvasFactory();
    sprite.width = size;
    sprite.height = size;

    const spriteCtx = sprite.getContext("2d", {colorSpace: "display-p3"});
    spriteCtx.imageSmoothingEnabled = false;

    paintBlock(spriteCtx, 0, 0, size, color);

    return sprite;
}

export function createGridCellSprite(size, canvasFactory = () => document.createElement("canvas")) {
    const sprite = canvasFactory();
    sprite.width = size;
    sprite.height = size;

    const spriteCtx = sprite.getContext("2d", {colorSpace: "display-p3"});
    spriteCtx.imageSmoothingEnabled = false;

    const bevel = Math.max(1, Math.round(size * 0.12));

    spriteCtx.fillStyle = "oklch(0 0 0 / 0.18)"; // top + left
    spriteCtx.beginPath();
    spriteCtx.moveTo(0, 0);
    spriteCtx.lineTo(size, 0);
    spriteCtx.lineTo(size - bevel, bevel);
    spriteCtx.lineTo(bevel, bevel);
    spriteCtx.lineTo(bevel, size - bevel);
    spriteCtx.lineTo(0, size);
    spriteCtx.closePath();
    spriteCtx.fill();

    spriteCtx.fillStyle = "oklch(1 0 0 / 0.08)"; // bottom + right
    spriteCtx.beginPath();
    spriteCtx.moveTo(size, 0);
    spriteCtx.lineTo(size, size);
    spriteCtx.lineTo(0, size);
    spriteCtx.lineTo(bevel, size - bevel);
    spriteCtx.lineTo(size - bevel, size - bevel);
    spriteCtx.lineTo(size - bevel, bevel);
    spriteCtx.closePath();
    spriteCtx.fill();

    spriteCtx.strokeStyle = "oklch(0 0 0 / 0.15)"; // border
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

export class SpriteCache {
    constructor(klockominos, canvasFactory) {
        this.klockominos = klockominos;
        this.canvasFactory = canvasFactory;
        this.size = 0;
        this.glowPad = 0;
        this.atlas = null;
        this.atlasRows = new Map();
        this.glowSprites = new Map();
        this.gridCellSprite = null;
        this._warmedGlowLevels = 0;
    }

    rebuild(size) {
        this.size = size;
        this.glowPad = Math.ceil(size * GLOW_BLUR_RATIO);
        this.glowSprites.clear();
        this._warmedGlowLevels = 0;
        this.gridCellSprite = createGridCellSprite(this.size, this.canvasFactory);

        const colors = [...new Set(Object.values(this.klockominos).map(({color}) => color))];
        this.atlasRows = new Map(colors.map((color, row) => [color, row]));

        this.atlas = this.canvasFactory();
        this.atlas.width = size * SATURATION_LEVELS;
        this.atlas.height = size * Math.max(1, colors.length);

        const atlasCtx = this.atlas.getContext("2d", {colorSpace: "display-p3"});
        atlasCtx.imageSmoothingEnabled = false;

        colors.forEach((color, row) => this._paintRow(atlasCtx, row, color));
    }

    _paintRow(atlasCtx, row, color) {
        for (let level = 0; level < SATURATION_LEVELS; level++) {
            paintBlock(atlasCtx, level * this.size, row * this.size, this.size, colorForLevel(color, level));
        }
    }

    _rowFor(color) {
        let row = this.atlasRows.get(color);
        if (row !== undefined) return row;

        if (this.atlasRows.size >= MAX_DYNAMIC_ATLAS_ROWS) return null;

        row = this.atlasRows.size;
        const neededHeight = (row + 1) * this.size;
        if (this.atlas.height < neededHeight) {
            const grown = this.canvasFactory();
            grown.width = this.atlas.width;
            grown.height = neededHeight;
            const growCtx = grown.getContext("2d", {colorSpace: "display-p3"});
            growCtx.imageSmoothingEnabled = false;
            growCtx.drawImage(this.atlas, 0, 0);
            this.atlas = grown;
        }
        this.atlasRows.set(color, row);
        this._paintRow(this.atlas.getContext("2d", {colorSpace: "display-p3"}), row, color);
        return row;
    }

    /**
     * Pre-paints glow sprites for every klockomino color, up front, instead of
     * letting getGlow() build them one-by-one the first time each color+level
     * combo is actually needed by a falling piece. Without this, the first
     * synchronous createGlowSprite() (canvas + shadowBlur) for a never-seen
     * combo happens mid-frame during real gameplay - cheap to absorb when
     * pieces fall slowly, but visible as a stutter on fast difficulties like
     * "pro" (20G), where new color/height combos keep showing up while the
     * game itself is already running flat out.
     *
     * Idempotent and incremental: only fills in whatever hasn't been warmed
     * yet for the requested size/level range, so it's cheap to call again
     * after a resize or after height-saturation gets toggled on.
     */
    warmGlow(size, saturationEnabled) {
        if (this.size !== size) this.rebuild(size);

        const levels = saturationEnabled ? SATURATION_LEVELS : 1;
        if (levels <= this._warmedGlowLevels) return;

        for (const color of this.atlasRows.keys()) {
            for (let level = this._warmedGlowLevels; level < levels; level++) {
                const key = level ? `${color}|${level}` : color;
                if (this.glowSprites.has(key)) continue;
                const resolvedColor = level ? colorForLevel(color, level) : color;
                this.glowSprites.set(key, createGlowSprite(resolvedColor, this.size, this.canvasFactory));
            }
        }
        this._warmedGlowLevels = levels;
    }

    getGridCell(currentSize) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        return this.gridCellSprite;
    }

    getRegion(color, currentSize, level = 0) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        const row = this._rowFor(color);
        if (row === null) return null;
        const col = Math.min(SATURATION_LEVELS - 1, Math.max(0, level));
        return {image: this.atlas, sx: col * this.size, sy: row * this.size, sw: this.size, sh: this.size};
    }

    getGlow(color, currentSize, level = 0) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        const key = level ? `${color}|${level}` : color;
        if (!this.glowSprites.has(key)) {
            const resolvedColor = level ? colorForLevel(color, level) : color;
            this.glowSprites.set(key, createGlowSprite(resolvedColor, this.size, this.canvasFactory));
        }
        return this.glowSprites.get(key);
    }
}
