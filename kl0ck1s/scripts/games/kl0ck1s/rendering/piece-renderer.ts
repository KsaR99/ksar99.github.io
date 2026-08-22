// @ts-nocheck
import type {KlockominoType} from "../shared/config.js";
import {forEachShapeCell, getTightBounds, lightenOklch} from "../shared/utils.js";
import {FALL_TRAIL_ALPHA_CACHE, HARD_DROP_TRAIL_ALPHAS} from "../game/game-constants.js";
import {colorForLevel, cornerRadiusForSize, fallTrailColor, HARD_DROP_FLASH_SPRITE_HEIGHT} from "./sprite-cache.js";
import type {Renderer} from "./renderer.js";

const GHOST_MIN_DROP_ROWS = 3;
const GHOST_WHITE_COLOR = "oklch(0.96 0 0)";

export class PieceRenderer {
    _hardDropTrailCacheCanvas = null;
    _hardDropTrailCacheCtx = null;
    _hardDropTrailCacheKey = "";
    _hardDropTrailCacheEntries = null;
    _ghostCache = new Map();

    constructor(private readonly renderer: Renderer) {
    }

    _ensureHardDropTrailCache(width, height) {
        if (!this._hardDropTrailCacheCanvas) {
            this._hardDropTrailCacheCanvas = document.createElement("canvas");
            this._hardDropTrailCacheCtx = this._hardDropTrailCacheCanvas.getContext("2d");
        }
        if (this._hardDropTrailCacheCanvas.width !== width) this._hardDropTrailCacheCanvas.width = width;
        if (this._hardDropTrailCacheCanvas.height !== height) this._hardDropTrailCacheCanvas.height = height;
        return this._hardDropTrailCacheCtx;
    }

    _buildHardDropTrailCache(entries, size, rows, outline, boardWidth, boardHeight) {
        const ctx = this._ensureHardDropTrailCache(boardWidth, boardHeight);
        if (!ctx) return null;
        ctx.clearRect(0, 0, boardWidth, boardHeight);
        ctx.save();
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (!entry?.mask) continue;
            const alpha = HARD_DROP_TRAIL_ALPHAS[i] ?? 0;
            if (alpha <= 0.02) break;
            ctx.globalAlpha = alpha;
            const w = entry.width, h = entry.height;
            const ex = entry.x, ey = entry.y;
            for (let r = 0; r < h; r++) {
                const y = ey + r;
                if (y < 0 || y >= rows) continue;
                const level = this.renderer.saturationLevelForRow(Math.round(y), rows);
                const sprite = this.renderer.spriteCache.getHardDropTrail(entry.color, size, level, outline);
                if (!sprite) continue;
                const offset = (sprite.width - size) / 2;
                const rowBase = r * w;
                for (let c = 0; c < w; c++) {
                    if ((entry.mask >> (rowBase + c)) & 1) {
                        ctx.drawImage(sprite, (ex + c) * size - offset, y * size - offset);
                    }
                }
            }
        }
        ctx.restore();
        return this._hardDropTrailCacheCanvas;
    }

    _ghostCacheKey(piece, board, offset, size) {
        const ghostY = piece.y + offset;
        return [
            piece.type, piece.mask, piece.width, piece.height, piece.color, ghostY, size,
            this.renderer.ghostType,
            this.renderer.transparencyEnabled ? 1 : 0,
            this.renderer.outlineBlocksEnabled ? 1 : 0,
            this.renderer.ghostType === "ascii" ? 0 : (this.renderer.heightSaturationEnabled ? 1 : 0),
            board.rows
        ].join("|");
    }

    _drawGhostFillCell(context, x, y, color, size, level, cache = this.renderer.spriteCache) {
        const region = cache.getRegion(color, size, level);
        if (!region) {
            context.fillStyle = color;
            context.fillRect(x * size, y * size, size, size);
            return;
        }
        context.drawImage(region.image, region.sx, region.sy, region.sw, region.sh,
            x * size, y * size, size, size);
    }

    _buildGhostCache(piece, board, offset, size) {
        const key = this._ghostCacheKey(piece, board, offset, size);
        const cached = this._ghostCache.get(key);
        if (cached) return cached;

        const padding = Math.max(2, Math.ceil(size * 0.2));
        const width = piece.width * size + padding * 2;
        const height = piece.height * size + padding * 2;
        const fillCanvas = document.createElement("canvas");
        const borderCanvas = document.createElement("canvas");
        fillCanvas.width = borderCanvas.width = width;
        fillCanvas.height = borderCanvas.height = height;

        const fillCtx = fillCanvas.getContext("2d");
        const borderCtx = borderCanvas.getContext("2d");
        if (!fillCtx || !borderCtx) return null;

        const baseColor = this.renderer.ghostType === "white" ? GHOST_WHITE_COLOR : piece.color;
        const fillColor = this.renderer.transparencyEnabled ? baseColor : lightenOklch(baseColor);

        if (this.renderer.ghostType === "ascii") {
            fillCtx.save();
            fillCtx.translate(padding, padding);
            fillCtx.font = `bold ${Math.max(10, Math.floor(size * .62))}px monospace`;
            fillCtx.textAlign = "center";
            fillCtx.textBaseline = "middle";
            fillCtx.fillStyle = piece.color;
            fillCtx.globalAlpha = 1;
            fillCtx.strokeStyle = "oklch(0 0 0 / .85)";
            fillCtx.lineWidth = Math.max(1, size * .05);
            forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
                const y = piece.y + r + offset;
                if (y < 0) return;
                fillCtx.strokeText("[ ]", c * size + size / 2, r * size + size / 2);
                fillCtx.fillText("[ ]", c * size + size / 2, r * size + size / 2);
            });
            fillCtx.restore();
        } else if (this.renderer.ghostType === "radioactive") {
            fillCtx.save();
            fillCtx.translate(padding, padding);
            fillCtx.fillStyle = "oklch(0 0 0)";
            forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
                const y = piece.y + r + offset;
                if (y < 0) return;
                fillCtx.fillRect(c * size, r * size, size, size);
            });
            fillCtx.restore();

            const sprite = this.renderer.spriteCache.getOutlineGhost(piece.color, size, 0);
            if (sprite) {
                const spriteOffset = (sprite.width - size) / 2;
                forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
                    const y = piece.y + r + offset;
                    if (y < 0) return;
                    borderCtx.drawImage(sprite, padding + c * size - spriteOffset, padding + r * size - spriteOffset);
                });
            }
        } else {
            fillCtx.save();
            fillCtx.translate(padding, padding);
            forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
                const y = piece.y + r + offset;
                if (y < 0) return;
                const level = this.renderer.ghostType === "white"
                    ? 0
                    : (this.renderer.heightSaturationEnabled ? Math.max(0, piece.height - 1 - r) : 0);
                this._drawGhostFillCell(fillCtx, c, r, fillColor, size, level);
            });
            fillCtx.restore();

            borderCtx.save();
            borderCtx.translate(padding, padding);
            borderCtx.lineWidth = 1;
            const radius = cornerRadiusForSize(size);
            const pathsByColor = new Map();

            forEachShapeCell(piece.mask, piece.width, piece.height, (r, c) => {
                const y = piece.y + r + offset;
                if (y < 0) return;
                const level = this.renderer.ghostType === "white"
                    ? 0
                    : (this.renderer.heightSaturationEnabled ? Math.max(0, piece.height - 1 - r) : 0);
                const strokeColor = colorForLevel(baseColor, level);
                let path = pathsByColor.get(strokeColor);
                if (!path) {
                    path = new Path2D();
                    pathsByColor.set(strokeColor, path);
                }
                path.roundRect(c * size + 0.5, r * size + 0.5, size - 1, size - 1, Math.max(0, radius - 0.5));
            });

            for (const [strokeColor, path] of pathsByColor) {
                borderCtx.strokeStyle = strokeColor;
                borderCtx.stroke(path);
            }
            borderCtx.restore();
        }

        const result = {fillCanvas, borderCanvas};
        if (this._ghostCache.size >= 24) {
            const first = this._ghostCache.keys().next().value;
            if (first) this._ghostCache.delete(first);
        }
        this._ghostCache.set(key, result);
        return result;
    }

    drawCell(context, x, y, color, size, {
        glow = false,
        ghost = false,
        level = 0,
        cache = this.renderer.spriteCache
    } = {}) {
        if (this.renderer.outlineBlocksEnabled) {
            const isGlow = glow && this.renderer.glowEnabled;
            const sprite = isGlow
                ? cache.getOutlineGlow(color, size, level, y)
                : cache.getOutline(color, size, level);
            const offset = (sprite.width - size) / 2;

            context.save();
            if (!isGlow) {
                context.beginPath();
                context.rect(x * size, y * size, size, size);
                context.clip();
            }
            if (ghost) context.globalAlpha *= this.renderer.ghostOpacity;
            context.drawImage(sprite, x * size - offset, y * size - offset);
            context.restore();
            return;
        }

        glow = glow && this.renderer.glowEnabled;

        if (glow) {
            const region = cache.getGlow(color, size, level, y);
            if (region) {
                const offsetX = (region.sw - size) / 2;
                const offsetY = (region.sh - size) / 2;
                context.drawImage(
                    region.image, region.sx, region.sy, region.sw, region.sh,
                    x * size - offsetX, y * size - offsetY, region.sw, region.sh
                );
            } else {
                context.fillStyle = color;
                context.fillRect(x * size, y * size, size, size);
            }
            return;
        }

        const region = cache.getRegion(color, size, level);
        if (!region) {
            context.fillStyle = color;
            context.fillRect(x * size, y * size, size, size);
            return;
        }

        if (ghost) {
            context.save();
            context.globalAlpha *= this.renderer.ghostOpacity;
        }

        context.drawImage(region.image, region.sx, region.sy, region.sw, region.sh, x * size, y * size, size, size);

        if (ghost)
            context.restore();
    }

    drawRotationIndicator(piece, direction, surface = this.renderer) {
        if (!piece || !direction) return;

        const size = this.renderer.boardConfig.CELL_SIZE;
        const {ctx} = surface;
        const pivotX = piece.pivotX ?? (piece.width / 2);
        const pivotY = piece.pivotY ?? (piece.height / 2);
        const cx = (piece.x + pivotX) * size;
        const cy = (piece.y + pivotY) * size;
        const lengths = [0.5, 0.3, 0.12];
        const totalArc = Math.PI * (220 / 180);
        const tipAngle = -Math.PI / 2;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(2, size * 0.07);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = piece.color;

        for (let i = 0; i < lengths.length; i++) {
            const radius = size * (1.65 + i * 0.28);
            const arc = totalArc * lengths[i];
            const startAngle = direction > 0
                ? tipAngle - arc
                : tipAngle + arc;

            ctx.beginPath();
            ctx.arc(0, 0, radius, startAngle, tipAngle, direction < 0);
            ctx.stroke();
        }

        ctx.restore();
    }

    drawPiece(piece, board, surface = this.renderer) {
        const size = this.renderer.boardConfig.CELL_SIZE;
        if (this.renderer.asciiFallingPiecesEnabled) return this._drawAsciiPiece(piece, surface);
        const angle = piece.renderAngle || 0;
        const scale = piece.renderScale || 1;
        const transformed = angle !== 0 || scale !== 1;

        if (surface.webgl && !transformed) {
            const renderMask = piece.renderMask ?? piece.mask;
            surface.webgl.begin(surface.boardCanvas.width, surface.boardCanvas.height, false);
            forEachShapeCell(renderMask, piece.width, piece.height, (r, c) => {
                const y = piece.y + r;
                if (y < 0) return;
                const level = board ? this.renderer.saturationLevelForRow(Math.round(y), board.rows) : 0;
                const sprite = this.renderer.outlineBlocksEnabled
                    ? this.renderer.spriteCache.getOutlineGlow(piece.color, size, level, y)
                    : this.renderer.spriteCache.getGlow(piece.color, size, level, y);
                surface.webgl.addCell(piece.x + c, y, size, sprite);
            });
            return;
        }

        const {ctx} = surface;
        if (transformed) {
            const pivotX = piece.pivotX ?? (piece.width / 2);
            const pivotY = piece.pivotY ?? (piece.height / 2);
            const cx = (piece.x + pivotX) * size;
            const cy = (piece.y + pivotY) * size;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle * Math.PI / 180);
            if (scale !== 1) ctx.scale(scale, scale);
            ctx.translate(-cx, -cy);
        }
        const renderMask = piece.renderMask ?? piece.mask;
        forEachShapeCell(renderMask, piece.width, piece.height, (r, c) => {
            const y = piece.y + r;
            if (y < 0 && !transformed) return;
            const level = board ? this.renderer.saturationLevelForRow(Math.round(y), board.rows) : 0;
            this.renderer.drawCell(ctx, piece.x + c, y, piece.color, size, {glow: true, level});
        });
        if (transformed) ctx.restore();
    }


    _drawAsciiCells(ctx, mask, width, height, color, size, colOffset, rowOffset, {bounds = null} = {}) {
        const minX = bounds?.minX ?? 0;
        const minY = bounds?.minY ?? 0;
        ctx.save();
        ctx.font = `bold ${Math.max(10, Math.floor(size * .62))}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = color;
        ctx.strokeStyle = "oklch(0 0 0 / .85)";
        ctx.lineWidth = Math.max(1, size * .05);
        forEachShapeCell(mask, width, height, (r, c) => {
            const x = colOffset + (c - minX);
            const y = rowOffset + (r - minY);
            if (y < 0) return;
            const tx = x * size + size / 2;
            const ty = y * size + size / 2;
            ctx.strokeText("[ ]", tx, ty);
            ctx.fillText("[ ]", tx, ty);
        });
        ctx.restore();
    }

    _drawAsciiPiece(piece, surface) {
        const size = this.renderer.boardConfig.CELL_SIZE;
        const ctx = surface.ctx;
        const angle = piece.renderAngle || 0, scale = piece.renderScale || 1;
        const transformed = angle !== 0 || scale !== 1;
        if (transformed) {
            const px = piece.pivotX ?? piece.width / 2, py = piece.pivotY ?? piece.height / 2;
            const cx = (piece.x + px) * size, cy = (piece.y + py) * size;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle * Math.PI / 180);
            if (scale !== 1) ctx.scale(scale, scale);
            ctx.translate(-cx, -cy);
        }
        const mask = piece.renderMask ?? piece.mask;
        this._drawAsciiCells(ctx, mask, piece.width, piece.height, piece.color, size, piece.x, piece.y);
        if (transformed) ctx.restore();
    }

    drawFallTrail(trail, headIndex, count, surface = this.renderer) {
        if (count === 0) return;

        const size = this.renderer.boardConfig.CELL_SIZE;
        const {ctx} = surface;
        const capacity = trail.length;
        const alphas = FALL_TRAIL_ALPHA_CACHE[count];

        ctx.save();
        for (let i = 0; i < count; i++) {
            const alpha = alphas[i];
            if (alpha <= 0.02) break;

            const idx = (headIndex - 1 - i + capacity * 2) % capacity;
            const snap = trail[idx];
            if (!snap.mask) continue;

            ctx.globalAlpha = alpha;
            if (this.renderer.asciiFallingPiecesEnabled) {
                this._drawAsciiCells(
                    ctx, snap.mask, snap.width, snap.height, snap.color, size, snap.x, snap.y
                );
                continue;
            }

            const sprite = this.renderer.spriteCache.getFallTrail(snap.color, size, this.renderer.outlineBlocksEnabled);
            const offset = sprite ? (sprite.width - size) / 2 : 0;
            forEachShapeCell(snap.mask, snap.width, snap.height, (r, c) => {
                const x = snap.x + c;
                const y = snap.y + r;
                if (y < 0) return;
                if (sprite) {
                    ctx.drawImage(sprite, x * size - offset, y * size - offset);
                } else {
                    ctx.fillStyle = fallTrailColor(snap.color);
                    ctx.fillRect(x * size, y * size, size, size);
                }
            });
        }
        ctx.restore();
    }

    drawHardDropTrail(entries, progress, surface = this.renderer) {
        if (!entries || entries.length === 0) return;

        const size = this.renderer.boardConfig.CELL_SIZE;
        const fade = 1 - Math.min(1, progress);
        if (fade <= 0.02) return;

        const ctx = surface.ctx;
        if (!ctx) return;

        if (this.renderer.asciiFallingPiecesEnabled) {
            ctx.save();
            ctx.globalAlpha = fade;
            for (const entry of entries) {
                if (!entry?.mask) continue;
                this._drawAsciiCells(
                    ctx, entry.mask, entry.width, entry.height, entry.color, size, entry.x, entry.y
                );
            }
            ctx.restore();
            return;
        }

        const boardWidth = surface.boardCanvas.width;
        const boardHeight = surface.boardCanvas.height;
        const rows = this.renderer.boardConfig.ROWS;
        const outline = this.renderer.outlineBlocksEnabled;
        const key = `${size}|${rows}|${outline ? 1 : 0}|${boardWidth}x${boardHeight}|${this.renderer.heightSaturationEnabled ? 1 : 0}`;
        if (this._hardDropTrailCacheEntries !== entries || this._hardDropTrailCacheKey !== key) {
            this._buildHardDropTrailCache(entries, size, rows, outline, boardWidth, boardHeight);
            this._hardDropTrailCacheKey = key;
            this._hardDropTrailCacheEntries = entries;
        }

        const canvas = this._hardDropTrailCacheCanvas;
        if (!canvas) return;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.drawImage(canvas, 0, 0);
        ctx.restore();
    }

    drawHardDropImpactFlash(entry, progress, surface = this.renderer) {
        if (!entry || !entry.mask || progress >= 1) return;

        this.renderer.drawImpactFlash(entry, progress, surface);
        this.renderer.drawHardDropImpactSparks(entry, progress, surface);
    }

    drawLockImpactFlash(entry, progress, surface = this.renderer) {
        if (!entry || !entry.mask || progress >= 1) return;

        this.renderer.drawImpactFlash(entry, progress, surface);
    }

    drawImpactFlash(entry, progress, surface = this.renderer) {
        const size = this.renderer.boardConfig.CELL_SIZE;
        const {ctx} = surface;

        const pieceTop = Math.round(entry.y * size);
        const pieceHeight = Math.round(entry.height * size);
        const bandHeight = Math.max(size * 1.8, pieceHeight * 1.4);
        const travel = pieceHeight + bandHeight;
        const centerY = pieceTop + pieceHeight - progress * travel + bandHeight / 2;
        const alpha = 1 - progress;

        ctx.save();

        ctx.beginPath();
        forEachShapeCell(entry.mask, entry.width, entry.height, (r, c) => {
            ctx.rect(
                Math.round((entry.x + c) * size),
                Math.round((entry.y + r) * size),
                size,
                size,
            );
        });
        ctx.clip();

        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = alpha;

        const sprite = this.renderer.spriteCache.getHardDropFlash();
        ctx.drawImage(
            sprite, 0, 0, 1, HARD_DROP_FLASH_SPRITE_HEIGHT,
            entry.x * size, centerY - bandHeight / 2, entry.width * size, bandHeight,
        );
        ctx.restore();
    }

    drawHardDropImpactSparks(entry, progress, surface = this.renderer) {
        const size = this.renderer.boardConfig.CELL_SIZE;
        const {ctx} = surface;
        const alpha = 1 - progress;
        if (alpha <= 0.02) return;

        const originX = (entry.x + entry.width / 2) * size;
        const originY = (entry.y + entry.height) * size;

        const sparks = [
            {dx: -0.55, dy: 0.85},
            {dx: -0.85, dy: 0.55},
            {dx: 0.55, dy: 0.85},
            {dx: 0.85, dy: 0.55},
            {dx: -0.75, dy: -0.7, big: true},
            {dx: 0.75, dy: -0.7, big: true},
        ];

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.lineCap = "round";
        ctx.strokeStyle = `oklch(1 0 0 / ${alpha})`;

        for (const spark of sparks) {
            const length = size * (spark.big ? 0.9 : 0.5);
            const travel = size * (spark.big ? 1.6 : 1.0) * progress;
            const startX = originX + spark.dx * travel;
            const startY = originY + spark.dy * travel;
            const endX = startX + spark.dx * length;
            const endY = startY + spark.dy * length;

            ctx.lineWidth = spark.big ? Math.max(2, size * 0.09) : Math.max(1.5, size * 0.06);
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
        }

        ctx.restore();
    }

    drawPreviewPiece(ctx, piece, colOffset, rowOffset, size, {
        glow = true,
        levelFor = null,
        cache = this.renderer.spriteCache
    } = {}) {
        if (!piece?.mask) return;
        const {mask, width, height, color, bounds} = piece;
        if (this.renderer.asciiFallingPiecesEnabled) {
            this._drawAsciiCells(ctx, mask, width, height, color, size, colOffset, rowOffset, {bounds});
            return;
        }
        forEachShapeCell(mask, width, height, (r, c) => {
            const x = colOffset + (c - bounds.minX);
            const y = rowOffset + (r - bounds.minY);
            const localY = r - bounds.minY;
            const level = levelFor ? levelFor(localY) : 0;
            this.renderer.drawCell(ctx, x, y, color, size, {glow, level, cache});
        });
    }

    drawPreviewGhost(ctx, piece, colOffset, ghostTopRow, pieceRows, size, cache = this.renderer.spriteCache) {
        if (!piece?.mask || this.renderer.ghostType === "off") return;

        const {mask, width, height, color, bounds} = piece;
        const applyOpacity = this.renderer.transparencyEnabled;

        if (this.renderer.ghostType === "radioactive") {
            ctx.save();
            if (applyOpacity) ctx.globalAlpha *= this.renderer.ghostOpacity;
            ctx.fillStyle = "oklch(0 0 0)";
            forEachShapeCell(mask, width, height, (r, c) => {
                const x = colOffset + (c - bounds.minX);
                const y = ghostTopRow + (r - bounds.minY);
                ctx.fillRect(x * size, y * size, size, size);
            });
            ctx.restore();

            const sprite = cache.getOutlineGhost(color, size, 0);
            if (!sprite) return;
            const offset = (sprite.width - size) / 2;
            ctx.save();
            ctx.globalAlpha = 1;
            forEachShapeCell(mask, width, height, (r, c) => {
                const x = colOffset + (c - bounds.minX);
                const y = ghostTopRow + (r - bounds.minY);
                ctx.drawImage(sprite, x * size - offset, y * size - offset);
            });
            ctx.restore();
            return;
        }

        if (this.renderer.ghostType === "ascii") {
            ctx.save();
            if (applyOpacity) ctx.globalAlpha *= this.renderer.ghostOpacity;
            this._drawAsciiCells(ctx, mask, width, height, color, size, colOffset, ghostTopRow, {bounds});
            ctx.restore();
            return;
        }

        const baseColor = this.renderer.ghostType === "white" ? GHOST_WHITE_COLOR : color;
        const fillColor = applyOpacity ? baseColor : lightenOklch(baseColor);

        ctx.save();
        if (applyOpacity) ctx.globalAlpha *= this.renderer.ghostOpacity;
        forEachShapeCell(mask, width, height, (r, c) => {
            const x = colOffset + (c - bounds.minX);
            const localY = r - bounds.minY;
            const y = ghostTopRow + localY;
            const level = this.renderer.ghostType === "white"
                ? 0
                : (this.renderer.heightSaturationEnabled ? Math.max(0, pieceRows - 1 - localY) : 0);
            this._drawGhostFillCell(ctx, x, y, fillColor, size, level, cache);
        });
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        const radius = cornerRadiusForSize(size);
        forEachShapeCell(mask, width, height, (r, c) => {
            const x = colOffset + (c - bounds.minX);
            const localY = r - bounds.minY;
            const y = ghostTopRow + localY;
            const level = this.renderer.ghostType === "white"
                ? 0
                : (this.renderer.heightSaturationEnabled ? Math.max(0, pieceRows - 1 - localY) : 0);
            ctx.strokeStyle = colorForLevel(baseColor, level);
            ctx.beginPath();
            ctx.roundRect(x * size + 0.5, y * size + 0.5, size - 1, size - 1, Math.max(0, radius - 0.5));
            ctx.stroke();
        });
        ctx.restore();
    }

    drawGhost(piece, board, surface = this.renderer) {
        if (this.renderer.ghostType === "off") return;

        const offset = board.getDropOffset(piece);
        if (offset <= GHOST_MIN_DROP_ROWS) return;

        const size = this.renderer.boardConfig.CELL_SIZE;
        const cached = this._buildGhostCache(piece, board, offset, size);
        if (!cached) return;

        const ctx = surface.ctx;
        if (!ctx) return;

        const padding = Math.max(2, Math.ceil(size * 0.2));
        const x = piece.x * size - padding;
        const y = (piece.y + offset) * size - padding;

        ctx.save();
        if (this.renderer.transparencyEnabled) ctx.globalAlpha *= this.renderer.ghostOpacity;
        ctx.drawImage(cached.fillCanvas, x, y);
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(cached.borderCanvas, x, y);
        ctx.restore();
    }

    drawNext(types: KlockominoType[] = []) {
        const {nextCtxs, nextCanvases, nextPreviewCellSize} = this.renderer;
        if (nextCanvases.length === 0) return;
        nextCanvases.forEach((nextCanvas, i) => {
            const nextCtx = nextCtxs[i];
            if (!nextCtx) return;
            nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);

            const type = types[i];
            if (!type) return;

            const {states, width, height, color} = this.renderer.klockominos[type];
            const mask = states[0];
            const bounds = getTightBounds(mask, width, height);
            const offsetX = (nextCanvas.width / nextPreviewCellSize - bounds.width) / 2 - bounds.minX;
            const offsetY = (nextCanvas.height / nextPreviewCellSize - bounds.height) / 2 - bounds.minY;

            if (this.renderer.asciiFallingPiecesEnabled) {
                this._drawAsciiCells(nextCtx, mask, width, height, color, nextPreviewCellSize, offsetX, offsetY);
            } else {
                forEachShapeCell(mask, width, height, (r, c) => {
                    this.renderer.drawCell(nextCtx, offsetX + c, offsetY + r, color, nextPreviewCellSize, {cache: this.renderer.nextSpriteCache});
                });
            }
        });
    }
}
