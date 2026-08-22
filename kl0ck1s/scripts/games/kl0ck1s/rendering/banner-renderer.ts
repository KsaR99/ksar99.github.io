// @ts-nocheck
import {BOARD_CONFIG} from "../shared/config.js";
import type {Renderer} from "./renderer.js";

export class BannerRenderer {
    constructor(private readonly renderer: Renderer) {
    }

    getBannerAnchorY(board, surface = this.renderer) {
        const {boardCanvas} = surface;
        const boardConfig = BOARD_CONFIG;
        const size = boardConfig.CELL_SIZE;
        const highestRow = board?.getHighestOccupiedRow() ?? 2;
        const anchorRow = board && highestRow < board.rows ? highestRow : 2;
        return Math.min(anchorRow * size, boardCanvas.height - size);
    }

    getRotatedHalfExtentY(boxWidth, boxHeight, angleRad) {
        return (boxWidth / 2) * Math.abs(Math.sin(angleRad)) + (boxHeight / 2) * Math.abs(Math.cos(angleRad));
    }

    getLevelUpBannerMetrics(level, surface = this.renderer) {
        const {ctx} = surface;
        const boardConfig = BOARD_CONFIG;
        const fontSize = Math.max(12, Math.round(boardConfig.CELL_SIZE * 1.2));
        const text = this.renderer.i18n ? this.renderer.i18n.t("game.levelUpBanner", {level}) : `LEVEL ${level}`;
        const fontBody = getComputedStyle(document.documentElement)
            .getPropertyValue("--font-body")
            .trim();

        ctx.save();
        ctx.font = `bold ${fontSize}px ${fontBody}`;
        const paddingX = fontSize * 0.6;
        const paddingY = fontSize * 0.35;
        const textWidth = ctx.measureText(text).width;
        ctx.restore();

        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = fontSize + paddingY * 2;
        return {fontSize, fontBody, text, boxWidth, boxHeight, halfVertical: boxHeight / 2};
    }

    getComboBannerMetrics(combo, surface = this.renderer) {
        const {ctx} = surface;
        const boardConfig = BOARD_CONFIG;
        const fontSize = Math.max(12, Math.round(boardConfig.CELL_SIZE * 0.8));
        const text = this.renderer.i18n ? this.renderer.i18n.t("game.comboBanner", {combo}) : `COMBO x${combo}`;
        const fontBody = getComputedStyle(document.documentElement)
            .getPropertyValue("--font-body")
            .trim();

        ctx.save();
        ctx.font = `bold ${fontSize}px ${fontBody}`;
        const paddingX = fontSize * 0.6;
        const paddingY = fontSize * 0.35;
        const textWidth = ctx.measureText(text).width;
        ctx.restore();

        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = fontSize + paddingY * 2;
        const tiltAngle = Math.PI / 4;
        const halfVerticalRotated = this.renderer.getRotatedHalfExtentY(boxWidth, boxHeight, tiltAngle);
        const halfHorizontalRotated = (boxWidth / 2) * Math.abs(Math.cos(tiltAngle))
            + (boxHeight / 2) * Math.abs(Math.sin(tiltAngle));
        return {
            fontSize,
            fontBody,
            text,
            boxWidth,
            boxHeight,
            tiltAngle,
            halfVertical: halfVerticalRotated,
            halfHorizontal: halfHorizontalRotated
        };
    }

    resolveBannerCenters(board, surface = this.renderer, levelInfo = null, comboInfo = null) {
        const {boardCanvas} = surface;
        const anchorY = this.renderer.getBannerAnchorY(board, surface);
        const gap = 8;
        let levelCenterY = null;
        let comboCenterY = null;

        if (levelInfo) {
            const {halfVertical} = levelInfo.metrics;
            const minCenterY = halfVertical + 4;
            const maxCenterY = boardCanvas.height - halfVertical - 4;
            levelCenterY = Math.min(Math.max(anchorY - halfVertical - 4, minCenterY), maxCenterY);
        }

        if (comboInfo) {
            const {halfVertical} = comboInfo.metrics;
            const minCenterY = halfVertical + 4;
            const maxCenterY = boardCanvas.height - halfVertical - 4;
            comboCenterY = Math.min(Math.max(anchorY + halfVertical + 4, minCenterY), maxCenterY);
        }

        if (levelCenterY !== null && comboCenterY !== null) {
            const requiredGap = levelInfo.metrics.halfVertical + comboInfo.metrics.halfVertical + gap;
            const currentGap = comboCenterY - levelCenterY;
            if (currentGap < requiredGap) {
                const deficit = requiredGap - currentGap;
                const comboMaxCenterY = boardCanvas.height - comboInfo.metrics.halfVertical - 4;
                comboCenterY = Math.min(comboCenterY + deficit, comboMaxCenterY);
                const remaining = requiredGap - (comboCenterY - levelCenterY);
                if (remaining > 0) {
                    const levelMinCenterY = levelInfo.metrics.halfVertical + 4;
                    levelCenterY = Math.max(levelCenterY - remaining, levelMinCenterY);
                }
            }
        }

        return {levelCenterY, comboCenterY};
    }

    drawBanners(board, surface = this.renderer, level = null, combo = null) {
        const levelInfo = level !== null ? {metrics: this.renderer.getLevelUpBannerMetrics(level, surface)} : null;
        const comboInfo = combo !== null ? {metrics: this.renderer.getComboBannerMetrics(combo, surface)} : null;
        const {levelCenterY, comboCenterY} = this.renderer.resolveBannerCenters(board, surface, levelInfo, comboInfo);

        if (levelInfo) {
            this.renderer.drawLevelUpBanner(level, board, surface, levelCenterY);
        }
        if (comboInfo) {
            this.renderer.drawComboBanner(combo, board, surface, comboCenterY);
        }
    }

    drawLevelUpBanner(level, board, surface = this.renderer, centerYOverride = null) {
        const {ctx, boardCanvas} = surface;
        const boardConfig = BOARD_CONFIG;
        const centerX = boardCanvas.width / 2;
        const fontSize = Math.max(12, Math.round(boardConfig.CELL_SIZE * 0.9));
        const text = this.renderer.i18n ? this.renderer.i18n.t("game.levelUpBanner", {level}) : `LEVEL ${level}`;
        const fontBody = getComputedStyle(document.documentElement)
            .getPropertyValue("--font-body")
            .trim();

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `bold ${fontSize}px ${fontBody}`;

        const paddingX = fontSize * 0.6;
        const paddingY = fontSize * 0.35;
        const textWidth = ctx.measureText(text).width;
        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = fontSize + paddingY * 2;
        const halfVertical = boxHeight / 2;
        let centerY = centerYOverride;
        if (centerY === null) {
            const anchorY = this.renderer.getBannerAnchorY(board, surface);
            const maxCenterY = boardCanvas.height - halfVertical - 4;
            const minCenterY = halfVertical + 4;
            centerY = Math.min(Math.max(anchorY - halfVertical - 4, minCenterY), maxCenterY);
        }

        ctx.shadowBlur = 8;
        ctx.fillStyle = "oklch(0.15 0.01 90 / 0.72)";
        ctx.beginPath();
        ctx.roundRect(centerX - boxWidth / 2, centerY - boxHeight / 2, boxWidth, boxHeight, fontSize * 0.2);
        ctx.fill();

        if (this.renderer.glowEnabled) {
            ctx.shadowBlur = fontSize * 0.25;
            ctx.shadowColor = "oklch(0.491 0.064 124.064 / 0.85)";
        } else {
            ctx.shadowBlur = 0;
        }

        ctx.lineWidth = Math.max(2, fontSize * 0.12);
        ctx.strokeStyle = "oklch(0.1 0 0 / 0.85)";
        ctx.strokeText(text, centerX, centerY);

        ctx.fillStyle = "oklch(0.97 0.04 95)";
        ctx.fillText(text, centerX, centerY);
        ctx.restore();
    }

    drawComboBanner(combo, board, surface = this.renderer, centerYOverride = null) {
        const {ctx, boardCanvas} = surface;
        const boardConfig = BOARD_CONFIG;
        const fontSize = Math.max(12, Math.round(boardConfig.CELL_SIZE * 0.8));
        const text = this.renderer.i18n ? this.renderer.i18n.t("game.comboBanner", {combo}) : `COMBO x${combo}`;
        const fontBody = getComputedStyle(document.documentElement)
            .getPropertyValue("--font-body")
            .trim();

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `bold ${fontSize}px ${fontBody}`;

        const paddingX = fontSize * 0.6;
        const paddingY = fontSize * 0.35;
        const textWidth = ctx.measureText(text).width;
        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = fontSize + paddingY * 2;
        const tiltAngle = Math.PI / 4;
        const halfVerticalRotated = this.renderer.getRotatedHalfExtentY(boxWidth, boxHeight, tiltAngle);
        const halfHorizontalRotated = (boxWidth / 2) * Math.abs(Math.cos(tiltAngle))
            + (boxHeight / 2) * Math.abs(Math.sin(tiltAngle));
        let centerY = centerYOverride;
        if (centerY === null) {
            const anchorY = this.renderer.getBannerAnchorY(board, surface);
            const maxCenterY = boardCanvas.height - halfVerticalRotated - 4;
            const minCenterY = halfVerticalRotated + 4;
            centerY = Math.min(Math.max(anchorY + halfVerticalRotated + 4, minCenterY), maxCenterY);
        }
        const centerX = Math.max(boardCanvas.width - halfHorizontalRotated - 4, halfHorizontalRotated + 4);

        ctx.translate(centerX, centerY);
        ctx.rotate(tiltAngle);

        ctx.shadowBlur = 8;
        ctx.fillStyle = "oklch(0.15 0.01 90 / 0.72)";
        ctx.beginPath();
        ctx.roundRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, fontSize * 0.2);
        ctx.fill();

        if (this.renderer.glowEnabled) {
            ctx.shadowBlur = fontSize * 0.25;
            ctx.shadowColor = "oklch(0.3706 0.1479 24.04 / 0.85)";
        } else {
            ctx.shadowBlur = 0;
        }

        ctx.lineWidth = Math.max(2, fontSize * 0.12);
        ctx.strokeStyle = "oklch(0.1 0 0 / 0.85)";
        ctx.strokeText(text, 0, 0);

        ctx.fillStyle = "oklch(0.82 0.16 71.488)";
        ctx.fillText(text, 0, 0);
        ctx.restore();
    }
}
