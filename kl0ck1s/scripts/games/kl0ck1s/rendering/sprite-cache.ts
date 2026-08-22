// @ts-nocheck
export * from "./sprite-factory.js";
import {lightenOklch} from "../shared/utils.js";
import {KLOCKOMINOS} from "../shared/config.js";
import {
    colorForLevel,
    createBlockSprite,
    createGlowSprite,
    createGridCellSprite,
    createHardDropFlashSprite,
    createOutlineBlockSprite,
    createOutlineFallTrailSprite,
    createOutlineGhostSprite,
    createOutlineGlowSprite,
    createOutlineHardDropTrailSprite,
    fallTrailColor,
    GHOST_WHITE_COLOR,
    GLOW_BLUR_RATIO,
    hardDropTrailColor,
    isGlowRow,
    OUTLINE_GLOW_BLUR_RATIO,
    paintBlock,
    particleColor,
    SATURATION_LEVELS,
} from "./sprite-factory.js";

const MAX_DYNAMIC_ATLAS_ROWS = 32;

export class SpriteCache {

    klockominos: typeof KLOCKOMINOS;
    canvasFactory: () => HTMLCanvasElement;
    size: 0;
    atlasCellSize: 0 | number;
    glowPad: 0 | number;
    atlas: null;
    atlasRows: Map<string, number>;
    glowSprites: Map<string, HTMLCanvasElement>;
    blockSprites: Map<string, HTMLCanvasElement>;
    outlineSprites: Map<string, HTMLCanvasElement>;
    outlineGlowSprites: Map<string, HTMLCanvasElement>;
    outlineGhostSprites: Map<string, HTMLCanvasElement>;
    hardDropTrailSprites: Map<string, HTMLCanvasElement>;
    outlineHardDropTrailSprites: Map<string, HTMLCanvasElement>;
    fallTrailSprites: Map<string, HTMLCanvasElement>;
    outlineFallTrailSprites: Map<string, HTMLCanvasElement>;
    particleColors: Map<string, string>;
    gridCellSprite: null | HTMLCanvasElement;
    _warmedGlowLevels: 0 | number;
    _warmedHardDropTrailLevels: 0 | number;
    _warmedFallTrail: false | true;
    _warmedParticleColorLevels: 0 | number;
    hardDropFlashSprite: null;
    outlinePad: number;

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
        this.outlinePad = 0;
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

        const baseColors = [...new Set(Object.values(this.klockominos).map(({color}) => color))];
        const colors = [...new Set([
            ...baseColors,
            ...baseColors.map(color => lightenOklch(color)),
            GHOST_WHITE_COLOR,
        ])];
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

        const row = this._rowFor(color);
        if (row !== null) {
            return {
                image: this.atlas,
                sx: resolvedLevel * this.atlasCellSize,
                sy: row * this.atlasCellSize,
                sw: this.atlasCellSize,
                sh: this.atlasCellSize,
            };
        }

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
        if (!isGlowRow(row)) return this.getRegion(color, currentSize, level);

        const resolvedLevel = Math.min(SATURATION_LEVELS - 1, Math.max(0, Math.round(level)));
        const key = resolvedLevel ? `${color}|${resolvedLevel}` : color;
        if (!this.glowSprites.has(key)) {
            const resolvedColor = resolvedLevel ? colorForLevel(color, resolvedLevel) : color;
            this.glowSprites.set(key, createGlowSprite(resolvedColor, this.size, this.canvasFactory));
        }
        const image = this.glowSprites.get(key);
        return {image, sx: 0, sy: 0, sw: image.width, sh: image.height};
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
