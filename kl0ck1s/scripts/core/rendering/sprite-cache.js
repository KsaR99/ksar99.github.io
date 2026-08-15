"use strict";

const GLOW_BLUR_RATIO = 0.8;
const GLOW_TOP_ROWS = 5;

export const GHOST_ALPHA = 0.3;

export const SATURATION_STEP = 0.05;
export const SATURATION_LEVELS = Math.round(1 / SATURATION_STEP) + 1;

const MAX_DYNAMIC_ATLAS_ROWS = 32;

const BLOCK_CORNER_RADIUS = 10;
export {BLOCK_CORNER_RADIUS};

const BLOCK_CORNER_RADIUS_RATIO = 0.20;

function cornerRadiusForSize(size) {
    return Math.min(BLOCK_CORNER_RADIUS, size * BLOCK_CORNER_RADIUS_RATIO);
}

export {cornerRadiusForSize};


export function isGlowRow(row) {
    return row < GLOW_TOP_ROWS;
}

export function factorForLevel(level) {
    return Math.max(0, 1 - level * SATURATION_STEP);
}

export function colorForLevel(color, level) {
    if (level <= 0) return color;
    return `oklch(from ${color} l calc(c * ${factorForLevel(level)}) h)`;
}

function paintBlock(spriteCtx, ox, oy, size, color) {
    const bevel = Math.max(1.5, Math.round(size * 0.16));
    const radius = cornerRadiusForSize(size);

    spriteCtx.save();
    spriteCtx.beginPath();
    spriteCtx.roundRect(ox, oy, size, size, radius);
    spriteCtx.clip();

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

    spriteCtx.restore();

    spriteCtx.strokeStyle = "oklch(0 0 0 / 0.6)";
    spriteCtx.lineWidth = 1;
    spriteCtx.beginPath();
    spriteCtx.roundRect(ox + 0.5, oy + 0.5, size - 1, size - 1, Math.max(0, radius - 0.5));
    spriteCtx.stroke();
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

const OUTLINE_GLOW_BLUR_RATIO = 0.5;
const OUTLINE_BLOCK_BORDER_WIDTH_RATIO = 0.035;
const OUTLINE_GHOST_BORDER_WIDTH_RATIO = 0.02;
const OUTLINE_TOP_GLOW_BLUR_RATIO = 0.6;

function paintOutlineBlock(spriteCtx, ox, oy, size, color, borderWidth, blur) {
    spriteCtx.fillStyle = "oklch(0 0 0)";
    spriteCtx.beginPath();
    spriteCtx.roundRect(ox, oy, size, size, cornerRadiusForSize(size));
    spriteCtx.fill();

    paintOutlineBorder(spriteCtx, ox, oy, size, color, borderWidth, blur);
}

function paintOutlineBorder(spriteCtx, ox, oy, size, color, borderWidth, blur) {
    const inset = borderWidth / 2;
    const radius = Math.max(0, cornerRadiusForSize(size) - inset);
    spriteCtx.shadowColor = color;
    spriteCtx.shadowBlur = blur;
    spriteCtx.strokeStyle = color;
    spriteCtx.lineWidth = borderWidth;
    spriteCtx.beginPath();
    spriteCtx.roundRect(ox + inset, oy + inset, size - borderWidth, size - borderWidth, radius);
    spriteCtx.stroke();
    spriteCtx.shadowBlur = 0;
    spriteCtx.beginPath();
    spriteCtx.roundRect(ox + inset, oy + inset, size - borderWidth, size - borderWidth, radius);
    spriteCtx.stroke();
}

export function createOutlineBlockSprite(color, size, canvasFactory = () => document.createElement("canvas")) {
    const blur = size * OUTLINE_GLOW_BLUR_RATIO;
    const pad = Math.max(1, Math.ceil(blur));
    const borderWidth = Math.max(1, Math.round(size * OUTLINE_BLOCK_BORDER_WIDTH_RATIO));

    const sprite = canvasFactory();
    sprite.width = size + pad * 2;
    sprite.height = size + pad * 2;

    const spriteCtx = sprite.getContext("2d");
    spriteCtx.imageSmoothingEnabled = false;

    paintOutlineBlock(spriteCtx, pad, pad, size, color, borderWidth, blur);

    return sprite;
}

function paintOutlineTopGlowBlock(spriteCtx, ox, oy, size, color, borderWidth, blur) {
    spriteCtx.fillStyle = "oklch(0 0 0)";
    spriteCtx.beginPath();
    spriteCtx.roundRect(ox, oy, size, size, cornerRadiusForSize(size));
    spriteCtx.fill();

    const inset = borderWidth / 2;
    const radius = Math.max(0, cornerRadiusForSize(size) - inset);
    const haloColor = `oklch(from ${color} calc(l + 0.15) c h)`;

    spriteCtx.shadowColor = haloColor;
    spriteCtx.shadowBlur = blur;
    spriteCtx.strokeStyle = haloColor;
    spriteCtx.lineWidth = borderWidth;
    spriteCtx.beginPath();
    spriteCtx.roundRect(ox + inset, oy + inset, size - borderWidth, size - borderWidth, radius);
    spriteCtx.stroke();

    paintOutlineBorder(spriteCtx, ox, oy, size, color, borderWidth, blur * 0.5);
}

export function createOutlineGlowSprite(color, size, canvasFactory = () => document.createElement("canvas")) {
    const blur = size * OUTLINE_TOP_GLOW_BLUR_RATIO;
    const pad = Math.max(1, Math.ceil(blur));
    const borderWidth = Math.max(1, Math.round(size * OUTLINE_BLOCK_BORDER_WIDTH_RATIO));

    const sprite = canvasFactory();
    sprite.width = size + pad * 2;
    sprite.height = size + pad * 2;

    const spriteCtx = sprite.getContext("2d");
    spriteCtx.imageSmoothingEnabled = false;

    paintOutlineTopGlowBlock(spriteCtx, pad, pad, size, color, borderWidth, blur);

    return sprite;
}

export function createOutlineGhostSprite(color, size, canvasFactory = () => document.createElement("canvas")) {
    const blur = size * OUTLINE_GLOW_BLUR_RATIO;
    const pad = Math.max(1, Math.ceil(blur));
    const borderWidth = Math.max(1.5, Math.round(size * OUTLINE_GHOST_BORDER_WIDTH_RATIO));

    const sprite = canvasFactory();
    sprite.width = size + pad * 2;
    sprite.height = size + pad * 2;

    const spriteCtx = sprite.getContext("2d");
    spriteCtx.imageSmoothingEnabled = false;

    paintOutlineBorder(spriteCtx, pad, pad, size, color, borderWidth, blur);

    return sprite;
}

export function createOutlineFallTrailSprite(color, size, canvasFactory = () => document.createElement("canvas")) {
    const blur = size * OUTLINE_GLOW_BLUR_RATIO;
    const pad = Math.max(1, Math.ceil(blur));
    const borderWidth = Math.max(1, Math.round(size * OUTLINE_BLOCK_BORDER_WIDTH_RATIO));

    const sprite = canvasFactory();
    sprite.width = size + pad * 2;
    sprite.height = size + pad * 2;

    const spriteCtx = sprite.getContext("2d");
    spriteCtx.imageSmoothingEnabled = false;

    paintOutlineBorder(spriteCtx, pad, pad, size, fallTrailColor(color), borderWidth, blur);

    return sprite;
}

export function hardDropTrailColor(color, level = 0) {
    const resolvedColor = level ? colorForLevel(color, level) : color;
    return `oklch(from ${resolvedColor} calc(l + 0.3) c h / 0.7)`;
}

export function createOutlineHardDropTrailSprite(color, size, level = 0, canvasFactory = () => document.createElement("canvas")) {
    const blur = size * OUTLINE_GLOW_BLUR_RATIO;
    const pad = Math.max(1, Math.ceil(blur));
    const borderWidth = Math.max(1, Math.round(size * OUTLINE_BLOCK_BORDER_WIDTH_RATIO));

    const sprite = canvasFactory();
    sprite.width = size + pad * 2;
    sprite.height = size + pad * 2;

    const spriteCtx = sprite.getContext("2d");
    spriteCtx.imageSmoothingEnabled = false;

    paintOutlineBorder(spriteCtx, pad, pad, size, hardDropTrailColor(color, level), borderWidth, blur);

    return sprite;
}

export function fallTrailColor(color) {
    return `oklch(from ${color} calc(l + 0.75) c h / 0.35)`;
}

const HARD_DROP_FLASH_SPRITE_HEIGHT = 128;
export {HARD_DROP_FLASH_SPRITE_HEIGHT};

function createHardDropFlashSprite(canvasFactory) {
    const sprite = canvasFactory();
    sprite.width = 1;
    sprite.height = HARD_DROP_FLASH_SPRITE_HEIGHT;

    const spriteCtx = sprite.getContext("2d");
    const gradient = spriteCtx.createLinearGradient(0, 0, 0, HARD_DROP_FLASH_SPRITE_HEIGHT);
    gradient.addColorStop(0, "oklch(1 0 0 / 0)");
    gradient.addColorStop(0.35, "oklch(1 0 0 / 1)");
    gradient.addColorStop(0.65, "oklch(1 0 0 / 1)");
    gradient.addColorStop(1, "oklch(1 0 0 / 0)");

    spriteCtx.fillStyle = gradient;
    spriteCtx.fillRect(0, 0, 1, HARD_DROP_FLASH_SPRITE_HEIGHT);

    return sprite;
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
    const radius = cornerRadiusForSize(size);

    spriteCtx.save();
    spriteCtx.beginPath();
    spriteCtx.roundRect(0, 0, size, size, radius);
    spriteCtx.clip();

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

    spriteCtx.restore();

    spriteCtx.strokeStyle = "oklch(0 0 0 / 0.15)"; // border
    spriteCtx.lineWidth = 1;
    spriteCtx.beginPath();
    spriteCtx.roundRect(0.5, 0.5, size - 1, size - 1, Math.max(0, radius - 0.5));
    spriteCtx.stroke();

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
    spriteCtx.beginPath();
    spriteCtx.roundRect(pad, pad, size, size, cornerRadiusForSize(size));
    spriteCtx.fill();

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
        this.outlineSprites = new Map();
        this.outlineGlowSprites = new Map();
        this.outlineGhostSprites = new Map();
        this.hardDropTrailSprites = new Map();
        this.outlineHardDropTrailSprites = new Map();
        this.fallTrailSprites = new Map();
        this.outlineFallTrailSprites = new Map();
        this.particleColors = new Map();
        this.gridCellSprite = null;
        this._warmedGlowLevels = 0;
        this._warmedHardDropTrailLevels = 0;
        this._warmedFallTrail = false;
        this._warmedParticleColorLevels = 0;
        this.hardDropFlashSprite = null;
    }

    rebuild(size) {
        this.size = size;
        this.atlasCellSize = Math.max(1, Math.round(size));
        this.glowPad = Math.max(1, Math.ceil(size * GLOW_BLUR_RATIO * 2));
        this.outlinePad = Math.max(1, Math.ceil(size * OUTLINE_GLOW_BLUR_RATIO));
        this.glowSprites.clear();
        this.blockSprites.clear();
        this.outlineSprites.clear();
        this.outlineGlowSprites.clear();
        this.outlineGhostSprites.clear();
        this.hardDropTrailSprites.clear();
        this.outlineHardDropTrailSprites.clear();
        this.fallTrailSprites.clear();
        this.outlineFallTrailSprites.clear();
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
                if (!this.hardDropTrailSprites.has(key)) {
                    this.hardDropTrailSprites.set(
                        key, createBlockSprite(hardDropTrailColor(color, level), this.size, this.canvasFactory)
                    );
                }
                if (!this.outlineHardDropTrailSprites.has(key)) {
                    this.outlineHardDropTrailSprites.set(
                        key, createOutlineHardDropTrailSprite(color, this.size, level, this.canvasFactory)
                    );
                }
            }
        }
        this._warmedHardDropTrailLevels = levels;
    }

    warmFallTrail(size) {
        if (this.size !== size) this.rebuild(size);
        if (this._warmedFallTrail) return;

        for (const color of this.atlasRows.keys()) {
            if (!this.fallTrailSprites.has(color)) {
                this.fallTrailSprites.set(color, createBlockSprite(fallTrailColor(color), this.size, this.canvasFactory));
            }
            if (!this.outlineFallTrailSprites.has(color)) {
                this.outlineFallTrailSprites.set(color, createOutlineFallTrailSprite(color, this.size, this.canvasFactory));
            }
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

    getGlow(color, currentSize, level = 0, row = 0) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        if (!isGlowRow(row)) return this.getRegion(color, currentSize, level).image;

        const resolvedLevel = Math.min(SATURATION_LEVELS - 1, Math.max(0, Math.round(level)));
        const key = resolvedLevel ? `${color}|${resolvedLevel}` : color;
        if (!this.glowSprites.has(key)) {
            const resolvedColor = resolvedLevel ? colorForLevel(color, resolvedLevel) : color;
            this.glowSprites.set(key, createGlowSprite(resolvedColor, this.size, this.canvasFactory));
        }
        return this.glowSprites.get(key);
    }

    getOutline(color, currentSize, level = 0) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        const resolvedLevel = Math.min(SATURATION_LEVELS - 1, Math.max(0, Math.floor(level)));
        const key = resolvedLevel ? `${color}|${resolvedLevel}` : color;
        let sprite = this.outlineSprites.get(key);
        if (!sprite) {
            const resolvedColor = resolvedLevel ? colorForLevel(color, resolvedLevel) : color;
            sprite = createOutlineBlockSprite(resolvedColor, this.size, this.canvasFactory);
            this.outlineSprites.set(key, sprite);
        }
        return sprite;
    }

    getOutlineGlow(color, currentSize, level = 0, row = 0) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        if (!isGlowRow(row)) return this.getOutline(color, currentSize, level);

        const resolvedLevel = Math.min(SATURATION_LEVELS - 1, Math.max(0, Math.round(level)));
        const key = resolvedLevel ? `${color}|${resolvedLevel}` : color;
        if (!this.outlineGlowSprites.has(key)) {
            const resolvedColor = resolvedLevel ? colorForLevel(color, resolvedLevel) : color;
            this.outlineGlowSprites.set(key, createOutlineGlowSprite(resolvedColor, this.size, this.canvasFactory));
        }
        return this.outlineGlowSprites.get(key);
    }

    getOutlineGhost(color, currentSize, level = 0) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        const resolvedLevel = Math.min(SATURATION_LEVELS - 1, Math.max(0, Math.floor(level)));
        const key = resolvedLevel ? `${color}|${resolvedLevel}` : color;
        let sprite = this.outlineGhostSprites.get(key);
        if (!sprite) {
            const resolvedColor = resolvedLevel ? colorForLevel(color, resolvedLevel) : color;
            sprite = createOutlineGhostSprite(resolvedColor, this.size, this.canvasFactory);
            this.outlineGhostSprites.set(key, sprite);
        }
        return sprite;
    }

    getHardDropTrail(color, currentSize, level = 0, outline = false) {
        if (this.size !== currentSize) this.rebuild(currentSize);
        const key = level ? `${color}|${level}` : color;

        if (outline) {
            if (!this.outlineHardDropTrailSprites.has(key)) {
                this.outlineHardDropTrailSprites.set(
                    key, createOutlineHardDropTrailSprite(color, this.size, level, this.canvasFactory)
                );
            }
            return this.outlineHardDropTrailSprites.get(key);
        }

        if (!this.hardDropTrailSprites.has(key)) {
            this.hardDropTrailSprites.set(
                key, createBlockSprite(hardDropTrailColor(color, level), this.size, this.canvasFactory)
            );
        }
        return this.hardDropTrailSprites.get(key);
    }

    getFallTrail(color, currentSize, outline = false) {
        if (this.size !== currentSize) this.rebuild(currentSize);

        if (outline) {
            if (!this.outlineFallTrailSprites.has(color)) {
                this.outlineFallTrailSprites.set(color, createOutlineFallTrailSprite(color, this.size, this.canvasFactory));
            }
            return this.outlineFallTrailSprites.get(color);
        }

        if (!this.fallTrailSprites.has(color)) {
            this.fallTrailSprites.set(color, createBlockSprite(fallTrailColor(color), this.size, this.canvasFactory));
        }
        return this.fallTrailSprites.get(color);
    }

    getHardDropFlash() {
        if (!this.hardDropFlashSprite) {
            this.hardDropFlashSprite = createHardDropFlashSprite(this.canvasFactory);
        }
        return this.hardDropFlashSprite;
    }
}
