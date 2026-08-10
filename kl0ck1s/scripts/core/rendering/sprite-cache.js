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

    const spriteCtx = sprite.getContext("2d");
    spriteCtx.imageSmoothingEnabled = false;

    paintBlock(spriteCtx, 0, 0, size, color);

    return sprite;
}

export function hardDropTrailColor(color, level = 0) {
    const resolvedColor = level ? colorForLevel(color, level) : color;
    return `oklch(from ${resolvedColor} calc(l + 0.3) c h / 0.7)`;
}

export function fallTrailColor(color) {
    return `oklch(from ${color} calc(l + 0.75) c h / 0.35)`;
}

export function particleColor(color, level = 0) {
    const resolvedColor = level ? colorForLevel(color, level) : color;
    return `oklch(from ${resolvedColor} l c h / 0.55)`;
}

export function createGridCellSprite(size, canvasFactory = () => document.createElement("canvas")) {
    const sprite = canvasFactory();
    sprite.width = size;
    sprite.height = size;

    const spriteCtx = sprite.getContext("2d");
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
    const pad = Math.max(1, Math.ceil(blur * 2));

    const sprite = canvasFactory();
    sprite.width = size + pad * 2;
    sprite.height = size + pad * 2;

    const spriteCtx = sprite.getContext("2d");
    spriteCtx.imageSmoothingEnabled = false;

    spriteCtx.shadowColor = color;
    spriteCtx.shadowBlur = blur;
    spriteCtx.fillStyle = color;
    spriteCtx.fillRect(pad, pad, size, size);

    spriteCtx.shadowBlur = 0;
    paintBlock(spriteCtx, pad, pad, size, color);

    return sprite;
}

export class SpriteCache {
    constructor(klockominos, canvasFactory) {
        this.klockominos = klockominos;
        this.canvasFactory = canvasFactory;
        this.size = 0;
        this.atlasCellSize = 0;
        this.glowPad = 0;
        this.atlas = null;
        this.atlasRows = new Map();
        this.glowSprites = new Map();
        this.blockSprites = new Map();
        this.hardDropTrailSprites = new Map();
        this.fallTrailSprites = new Map();
        this.particleColors = new Map();
        this.gridCellSprite = null;
        this._warmedGlowLevels = 0;
        this._warmedHardDropTrailLevels = 0;
        this._warmedFallTrail = false;
        this._warmedParticleColorLevels = 0;
    }

    rebuild(size) {
        this.size = size;
        this.atlasCellSize = Math.max(1, Math.round(size));
        this.glowPad = Math.max(1, Math.ceil(size * GLOW_BLUR_RATIO * 2));
        this.glowSprites.clear();
        this.blockSprites.clear();
        this.hardDropTrailSprites.clear();
        this.fallTrailSprites.clear();
        this._warmedGlowLevels = 0;
        this._warmedHardDropTrailLevels = 0;
        this._warmedFallTrail = false;
        this.gridCellSprite = createGridCellSprite(this.size, this.canvasFactory);

        const colors = [...new Set(Object.values(this.klockominos).map(({color}) => color))];
        this.atlasRows = new Map(colors.map((color, row) => [color, row]));

        this.atlas = this.canvasFactory();
        this.atlas.width = this.atlasCellSize * SATURATION_LEVELS;
        this.atlas.height = this.atlasCellSize * Math.max(1, colors.length);

        const atlasCtx = this.atlas.getContext("2d");
        atlasCtx.imageSmoothingEnabled = false;

        colors.forEach((color, row) => this._paintRow(atlasCtx, row, color));
    }

    _paintRow(atlasCtx, row, color) {
        for (let level = 0; level < SATURATION_LEVELS; level++) {
            paintBlock(atlasCtx, level * this.atlasCellSize, row * this.atlasCellSize, this.atlasCellSize, colorForLevel(color, level));
        }
    }

    _rowFor(color) {
        let row = this.atlasRows.get(color);
        if (row !== undefined) return row;

        if (this.atlasRows.size >= MAX_DYNAMIC_ATLAS_ROWS) return null;

        row = this.atlasRows.size;
        const neededHeight = (row + 1) * this.atlasCellSize;
        if (this.atlas.height < neededHeight) {
            const grown = this.canvasFactory();
            grown.width = this.atlas.width;
            grown.height = neededHeight;
            const growCtx = grown.getContext("2d");
            growCtx.imageSmoothingEnabled = false;
            growCtx.drawImage(this.atlas, 0, 0);
            this.atlas = grown;
        }
        this.atlasRows.set(color, row);
        this._paintRow(this.atlas.getContext("2d"), row, color);
        return row;
    }

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

    warmHardDropTrail(size, saturationEnabled) {
        if (this.size !== size) this.rebuild(size);

        const levels = saturationEnabled ? SATURATION_LEVELS : 1;
        if (levels <= this._warmedHardDropTrailLevels) return;

        for (const color of this.atlasRows.keys()) {
            for (let level = this._warmedHardDropTrailLevels; level < levels; level++) {
                const key = level ? `${color}|${level}` : color;
                if (this.hardDropTrailSprites.has(key)) continue;
                this.hardDropTrailSprites.set(
                    key, createBlockSprite(hardDropTrailColor(color, level), this.size, this.canvasFactory)
                );
            }
        }
        this._warmedHardDropTrailLevels = levels;
    }

    warmFallTrail(size) {
        if (this.size !== size) this.rebuild(size);
        if (this._warmedFallTrail) return;

        for (const color of this.atlasRows.keys()) {
            if (this.fallTrailSprites.has(color)) continue;
            this.fallTrailSprites.set(color, createBlockSprite(fallTrailColor(color), this.size, this.canvasFactory));
        }
        this._warmedFallTrail = true;
    }

    warmParticleColors(size, saturationEnabled) {
        if (this.size !== size) this.rebuild(size);

        const levels = saturationEnabled ? SATURATION_LEVELS : 1;
        if (levels <= this._warmedParticleColorLevels) return;

        for (const color of this.atlasRows.keys()) {
            for (let level = this._warmedParticleColorLevels; level < levels; level++) {
                const key = level ? `${color}|${level}` : color;
                if (this.particleColors.has(key)) continue;
                this.particleColors.set(key, particleColor(color, level));
            }
        }
        this._warmedParticleColorLevels = levels;
    }

    getParticleColor(color, level = 0) {
        const key = level ? `${color}|${level}` : color;
        if (!this.particleColors.has(key)) {
            this.particleColors.set(key, particleColor(color, level));
        }
        return this.particleColors.get(key);
    }

    getGridCell(currentSize) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        return this.gridCellSprite;
    }

    getRegion(color, currentSize, level = 0) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        const resolvedLevel = Math.min(SATURATION_LEVELS - 1, Math.max(0, Math.floor(level)));
        const key = resolvedLevel ? `${color}|${resolvedLevel}` : color;
        let image = this.blockSprites.get(key);
        if (!image) {
            const resolvedColor = resolvedLevel ? colorForLevel(color, resolvedLevel) : color;
            image = createBlockSprite(resolvedColor, this.size, this.canvasFactory);
            this.blockSprites.set(key, image);
        }
        return {image, sx: 0, sy: 0, sw: this.size, sh: this.size};
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

    getHardDropTrail(color, currentSize, level = 0) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        const key = level ? `${color}|${level}` : color;
        if (!this.hardDropTrailSprites.has(key)) {
            this.hardDropTrailSprites.set(
                key, createBlockSprite(hardDropTrailColor(color, level), this.size, this.canvasFactory)
            );
        }
        return this.hardDropTrailSprites.get(key);
    }

    getFallTrail(color, currentSize) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        if (!this.fallTrailSprites.has(color)) {
            this.fallTrailSprites.set(color, createBlockSprite(fallTrailColor(color), this.size, this.canvasFactory));
        }
        return this.fallTrailSprites.get(color);
    }
}
