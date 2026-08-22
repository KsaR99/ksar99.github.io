"use strict";

export const GLOW_BLUR_RATIO = 0.8;
export const GLOW_TOP_ROWS = 5;
export const GHOST_WHITE_COLOR = "oklch(0.96 0 0)";

export const GHOST_OPACITY_DEFAULTS = {
    colorful: 0.5,
    ascii: 0.5,
    radioactive: 1.00,
    white: 0.2,
};

export const SATURATION_STEP = 0.05;
export const SATURATION_LEVELS = Math.round(1 / SATURATION_STEP) + 1;


export const BLOCK_CORNER_RADIUS = 10;

const BLOCK_CORNER_RADIUS_RATIO = 0.20;

export function cornerRadiusForSize(size: number) {
    return Math.min(BLOCK_CORNER_RADIUS, size * BLOCK_CORNER_RADIUS_RATIO);
}


export function isGlowRow(row: number) {
    return row < GLOW_TOP_ROWS;
}

export function factorForLevel(level: number) {
    return Math.max(0, 1 - level * SATURATION_STEP);
}

const OKLCH_MATCH = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i;

export function colorForLevel(color: string, level: number) {
    if (level <= 0) return color;
    const match = color.match(OKLCH_MATCH);
    if (!match) return color;
    const [, l, c, h, a] = match;
    const fadedChroma = parseFloat(c) * factorForLevel(level);
    const alphaSuffix = a ? ` / ${a}` : "";
    return `oklch(${l} ${fadedChroma} ${h}${alphaSuffix})`;
}

export function paintBlock(spriteCtx: CanvasRenderingContext2D, ox: number, oy: number, size: number, color: string) {
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

export function createBlockSprite(color: string, size: number, canvasFactory: () => HTMLCanvasElement = () => document.createElement("canvas")) {
    const sprite = canvasFactory();
    sprite.width = size;
    sprite.height = size;

    const spriteCtx = sprite.getContext("2d");
    if (!spriteCtx) throw new Error("2D canvas context is unavailable");
    spriteCtx.imageSmoothingEnabled = false;

    paintBlock(spriteCtx, 0, 0, size, color);

    return sprite;
}

export const OUTLINE_GLOW_BLUR_RATIO = 0.5;
const OUTLINE_BLOCK_BORDER_WIDTH_RATIO = 0.035;
const OUTLINE_GHOST_BORDER_WIDTH_RATIO = 0.02;
const OUTLINE_TOP_GLOW_BLUR_RATIO = 0.6;

export function paintOutlineBlock(spriteCtx: CanvasRenderingContext2D, ox: number, oy: number, size: number, color: string, borderWidth: number, blur: number) {
    spriteCtx.fillStyle = "oklch(0 0 0)";
    spriteCtx.beginPath();
    spriteCtx.roundRect(ox, oy, size, size, cornerRadiusForSize(size));
    spriteCtx.fill();

    paintOutlineBorder(spriteCtx, ox, oy, size, color, borderWidth, blur);
}

export function paintOutlineBorder(spriteCtx: CanvasRenderingContext2D, ox: number, oy: number, size: number, color: string, borderWidth: number, blur: number) {
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

export function createOutlineBlockSprite(color: string, size: number, canvasFactory: () => HTMLCanvasElement = () => document.createElement("canvas")) {
    const blur = size * OUTLINE_GLOW_BLUR_RATIO;
    const pad = Math.max(1, Math.ceil(blur));
    const borderWidth = Math.max(1, Math.round(size * OUTLINE_BLOCK_BORDER_WIDTH_RATIO));

    const sprite = canvasFactory();
    sprite.width = size + pad * 2;
    sprite.height = size + pad * 2;

    const spriteCtx = sprite.getContext("2d");
    if (!spriteCtx) throw new Error("2D canvas context is unavailable");
    spriteCtx.imageSmoothingEnabled = false;

    paintOutlineBlock(spriteCtx, pad, pad, size, color, borderWidth, blur);

    return sprite;
}

export function paintOutlineTopGlowBlock(spriteCtx: CanvasRenderingContext2D, ox: number, oy: number, size: number, color: string, borderWidth: number, blur: number) {
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

export function createOutlineGlowSprite(color: string, size: number, canvasFactory: () => HTMLCanvasElement = () => document.createElement("canvas")) {
    const blur = size * OUTLINE_TOP_GLOW_BLUR_RATIO;
    const pad = Math.max(1, Math.ceil(blur));
    const borderWidth = Math.max(1, Math.round(size * OUTLINE_BLOCK_BORDER_WIDTH_RATIO));

    const sprite = canvasFactory();
    sprite.width = size + pad * 2;
    sprite.height = size + pad * 2;

    const spriteCtx = sprite.getContext("2d");
    if (!spriteCtx) throw new Error("2D canvas context is unavailable");
    spriteCtx.imageSmoothingEnabled = false;

    paintOutlineTopGlowBlock(spriteCtx, pad, pad, size, color, borderWidth, blur);

    return sprite;
}

export function createOutlineGhostSprite(color: string, size: number, canvasFactory: () => HTMLCanvasElement = () => document.createElement("canvas")) {
    const blur = size * OUTLINE_GLOW_BLUR_RATIO;
    const pad = Math.max(1, Math.ceil(blur));
    const borderWidth = Math.max(1.5, Math.round(size * OUTLINE_GHOST_BORDER_WIDTH_RATIO));

    const sprite = canvasFactory();
    sprite.width = size + pad * 2;
    sprite.height = size + pad * 2;

    const spriteCtx = sprite.getContext("2d");
    if (!spriteCtx) throw new Error("2D canvas context is unavailable");
    spriteCtx.imageSmoothingEnabled = false;

    paintOutlineBorder(spriteCtx, pad, pad, size, color, borderWidth, blur);

    return sprite;
}

export function createOutlineFallTrailSprite(color: string, size: number, canvasFactory: () => HTMLCanvasElement = () => document.createElement("canvas")) {
    const blur = size * OUTLINE_GLOW_BLUR_RATIO;
    const pad = Math.max(1, Math.ceil(blur));
    const borderWidth = Math.max(1, Math.round(size * OUTLINE_BLOCK_BORDER_WIDTH_RATIO));

    const sprite = canvasFactory();
    sprite.width = size + pad * 2;
    sprite.height = size + pad * 2;

    const spriteCtx = sprite.getContext("2d");
    if (!spriteCtx) throw new Error("2D canvas context is unavailable");
    spriteCtx.imageSmoothingEnabled = false;

    paintOutlineBorder(spriteCtx, pad, pad, size, fallTrailColor(color), borderWidth, blur);

    return sprite;
}

export function hardDropTrailColor(color: string, level = 0) {
    const resolvedColor = level ? colorForLevel(color, level) : color;
    return `oklch(from ${resolvedColor} calc(l + 0.3) c h / 0.7)`;
}

export function createOutlineHardDropTrailSprite(color: string, size: number, level = 0, canvasFactory: () => HTMLCanvasElement = () => document.createElement("canvas")) {
    const blur = size * OUTLINE_GLOW_BLUR_RATIO;
    const pad = Math.max(1, Math.ceil(blur));
    const borderWidth = Math.max(1, Math.round(size * OUTLINE_BLOCK_BORDER_WIDTH_RATIO));

    const sprite = canvasFactory();
    sprite.width = size + pad * 2;
    sprite.height = size + pad * 2;

    const spriteCtx = sprite.getContext("2d");
    if (!spriteCtx) throw new Error("2D canvas context is unavailable");
    spriteCtx.imageSmoothingEnabled = false;

    paintOutlineBorder(spriteCtx, pad, pad, size, hardDropTrailColor(color, level), borderWidth, blur);

    return sprite;
}

export function fallTrailColor(color: string) {
    return `oklch(from ${color} calc(l + 0.75) c h / 0.35)`;
}

export const HARD_DROP_FLASH_SPRITE_HEIGHT = 128;

export function createHardDropFlashSprite(canvasFactory: () => HTMLCanvasElement) {
    const sprite = canvasFactory();
    sprite.width = 1;
    sprite.height = HARD_DROP_FLASH_SPRITE_HEIGHT;

    const spriteCtx = sprite.getContext("2d");
    if (!spriteCtx) throw new Error("2D canvas context is unavailable");
    const gradient = spriteCtx.createLinearGradient(0, 0, 0, HARD_DROP_FLASH_SPRITE_HEIGHT);
    gradient.addColorStop(0, "oklch(1 0 0 / 0)");
    gradient.addColorStop(0.35, "oklch(1 0 0 / 1)");
    gradient.addColorStop(0.65, "oklch(1 0 0 / 1)");
    gradient.addColorStop(1, "oklch(1 0 0 / 0)");

    spriteCtx.fillStyle = gradient;
    spriteCtx.fillRect(0, 0, 1, HARD_DROP_FLASH_SPRITE_HEIGHT);

    return sprite;
}

export function particleColor(color: string, level = 0) {
    const resolvedColor = level ? colorForLevel(color, level) : color;
    return `oklch(from ${resolvedColor} l c h / 0.55)`;
}

export function createGridCellSprite(size: number, canvasFactory: () => HTMLCanvasElement = () => document.createElement("canvas")) {
    const sprite = canvasFactory();
    sprite.width = size;
    sprite.height = size;

    const spriteCtx = sprite.getContext("2d");
    if (!spriteCtx) throw new Error("2D canvas context is unavailable");
    spriteCtx.imageSmoothingEnabled = false;

    const bevel = Math.max(1, Math.round(size * 0.12));
    const radius = cornerRadiusForSize(size);

    spriteCtx.save();
    spriteCtx.beginPath();
    spriteCtx.roundRect(0, 0, size, size, radius);
    spriteCtx.clip();

    spriteCtx.fillStyle = "oklch(0.1 0 0 / 0.4)"; // top + left
    spriteCtx.beginPath();
    spriteCtx.moveTo(0, 0);
    spriteCtx.lineTo(size, 0);
    spriteCtx.lineTo(size - bevel, bevel);
    spriteCtx.lineTo(bevel, bevel);
    spriteCtx.lineTo(bevel, size - bevel);
    spriteCtx.lineTo(0, size);
    spriteCtx.closePath();
    spriteCtx.fill();

    spriteCtx.fillStyle = "oklch(0.3 0 0 / 0.4)"; // bottom + right
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

export function createGlowSprite(color: string, size: number, canvasFactory: () => HTMLCanvasElement = () => document.createElement("canvas")) {
    const blur = size * GLOW_BLUR_RATIO;
    const pad = Math.max(1, Math.ceil(blur * 2));

    const sprite = canvasFactory();
    sprite.width = size + pad * 2;
    sprite.height = size + pad * 2;

    const spriteCtx = sprite.getContext("2d");
    if (!spriteCtx) throw new Error("2D canvas context is unavailable");
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

