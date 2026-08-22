"use strict";

import {calculateCellSize} from "../games/kl0ck1s/rendering/board-sizing.js";
import type {Renderer} from "../games/kl0ck1s/rendering/renderer.js";
import type {Game} from "../games/kl0ck1s/game/game.js";

type BoardConfig = {
    CELL_SIZE: number;
    ROWS: number;
    COLS: number;
    MIN_CELL_SIZE: number;
    MAX_CELL_SIZE: number;
};

export class AppLayout {
    constructor(
        private readonly bodyEl: HTMLElement,
        private readonly appEl: HTMLElement,
        private readonly boardDiv: HTMLElement,
        private readonly boardCanvas: HTMLCanvasElement,
        private readonly ctx: CanvasRenderingContext2D,
        private readonly boardConfig: BoardConfig,
        private readonly renderer: Renderer,
        private readonly game: Game,
    ) {
    }

    resizeBoardCanvas(): void {
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
        const {verticalChrome, horizontalChrome} = this.getChrome();
        const availableHeight = Math.max(0, viewportHeight - verticalChrome);
        const availableWidth = Math.max(0, viewportWidth - horizontalChrome);

        this.boardConfig.CELL_SIZE = calculateCellSize({
            availableHeight,
            availableWidth,
            rows: this.boardConfig.ROWS,
            cols: this.boardConfig.COLS,
            minCellSize: this.boardConfig.MIN_CELL_SIZE,
            maxCellSize: this.boardConfig.MAX_CELL_SIZE,
        });

        this.boardCanvas.width = this.boardConfig.CELL_SIZE * this.boardConfig.COLS;
        this.boardCanvas.height = this.boardConfig.CELL_SIZE * this.boardConfig.ROWS;
        this.renderer.resizeBoardSurface?.(this.boardCanvas.width, this.boardCanvas.height);
        this.ctx.imageSmoothingEnabled = false;
        this.game.themeOverlay.resize(this.boardCanvas.width, this.boardCanvas.height);
    }

    getChrome(): { verticalChrome: number; horizontalChrome: number } {
        const bodyStyle = getComputedStyle(this.bodyEl);
        const appStyle = getComputedStyle(this.appEl);
        const boardWrap = this.boardDiv.parentElement;
        const boardWrapStyle = getComputedStyle(boardWrap ?? this.boardDiv);
        const boardStyle = getComputedStyle(this.boardDiv);

        const verticalChrome =
            this.px(bodyStyle.paddingTop) + this.px(bodyStyle.paddingBottom) +
            this.px(appStyle.paddingTop) + this.px(appStyle.paddingBottom) +
            this.px(boardWrapStyle.paddingTop) + this.px(boardWrapStyle.paddingBottom) +
            this.px(boardWrapStyle.borderTopWidth) + this.px(boardWrapStyle.borderBottomWidth) +
            this.px(boardStyle.borderTopWidth) + this.px(boardStyle.borderBottomWidth);

        const {width: sidebarsWidth, count: inFlowSidebars} = this.getSidebarInlineFootprint();
        const rowGap = this.px(appStyle.columnGap);
        const horizontalChrome =
            this.px(bodyStyle.paddingLeft) + this.px(bodyStyle.paddingRight) +
            this.px(appStyle.paddingLeft) + this.px(appStyle.paddingRight) +
            this.px(boardWrapStyle.paddingLeft) + this.px(boardWrapStyle.paddingRight) +
            this.px(boardWrapStyle.borderLeftWidth) + this.px(boardWrapStyle.borderRightWidth) +
            this.px(boardStyle.borderLeftWidth) + this.px(boardStyle.borderRightWidth) +
            sidebarsWidth + rowGap * inFlowSidebars;

        return {verticalChrome, horizontalChrome};
    }

    private getSidebarInlineFootprint(): { width: number; count: number } {
        let width = 0;
        let count = 0;
        this.bodyEl.querySelectorAll<HTMLElement>(".app__sidebar").forEach((el) => {
            if (getComputedStyle(el as unknown as Element).position !== "fixed") {
                width += el.getBoundingClientRect().width;
                ++count;
            }
        });
        return {width, count};
    }

    private px(value: string): number {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
}
