// @ts-nocheck
import type {Game} from "../../game/game.js";
import {BOARD_CONFIG} from "../../shared/config.js";

"use strict";

const OPPONENT_BOARD_FALLBACK_CELL_PX = 24;

export class OpponentBoardView {

    game: Game;
    dom: Document;
    panelEl: null;
    headerEl: null;
    nameEl: null;
    boardHost: null;
    localHeaderEl: null;
    raceMeterEl: null;
    raceMeterFillEl: null;
    canvasEl: null;
    canvasCtx: null;
    surface: null;
    _draw: ((ctx: CanvasRenderingContext2D) => void) | null;
    _handleWindowResize: (() => void) | null;
    _emptyCells: null | Uint8Array<ArrayBuffer>;

    constructor(game, dom) {
        this.game = game;
        this.dom = dom;

        this.panelEl = null;
        this.headerEl = null;
        this.nameEl = null;
        this.boardHost = null;
        this.localHeaderEl = null;
        this.raceMeterEl = null;
        this.raceMeterFillEl = null;
        this.canvasEl = null;
        this.canvasCtx = null;
        this.surface = null;
        this._draw = null;
        this._handleWindowResize = null;
        this._emptyCells = null;
    }

    show(localName, remoteName, {onLayoutResize, draw} = {}) {
        this.hide();

        if (!globalThis.matchMedia?.("(width >= 48rem)").matches) return;

        const boardHost = this.dom.querySelector(".app__board");
        if (!boardHost) return;

        const localHeader = this.dom.createElement("div");
        localHeader.className = "mp-opponent-column__header mp-local-board-header";

        const localNameEl = this.dom.createElement("span");
        localNameEl.className = "mp-opponent-column__name";
        localNameEl.textContent = localName;
        localHeader.appendChild(localNameEl);

        boardHost.prepend(localHeader);
        this.boardHost = boardHost;
        this.localHeaderEl = localHeader;

        const panel = this.dom.createElement("div");
        panel.className = "app__sidebar mp-opponent-column";
        panel.dataset.role = "mp-opponent-panel";

        const header = this.dom.createElement("div");
        header.className = "mp-opponent-column__header";

        const name = this.dom.createElement("span");
        name.className = "mp-opponent-column__name";
        name.textContent = remoteName;
        header.appendChild(name);

        panel.appendChild(header);

        const boardEl = this.dom.createElement("div");
        boardEl.className = "board mp-opponent-column__board";

        const bg = this.dom.createElement("div");
        bg.setAttribute("aria-hidden", "true");
        bg.className = "board__bg";

        const stage = this.dom.createElement("div");
        stage.className = "board__stage";

        const canvas = this.dom.createElement("canvas");
        canvas.className = "board__canvas mp-opponent-column__canvas";
        canvas.dataset.role = "mp-opponent-canvas";

        const filterEl = this.dom.createElement("div");
        filterEl.className = "board__filter board__filter--none";

        const filterCanvas = this.dom.createElement("canvas");
        filterCanvas.className = "board__filter-canvas";
        filterEl.appendChild(filterCanvas);

        stage.appendChild(canvas);
        stage.appendChild(filterEl);
        boardEl.appendChild(bg);
        boardEl.appendChild(stage);
        panel.appendChild(boardEl);

        boardHost.insertAdjacentElement("afterend", panel);

        const raceMeter = this.dom.createElement("div");
        raceMeter.className = "app__sidebar mp-race-meter";
        raceMeter.dataset.role = "mp-race-meter";
        const raceMeterFill = this.dom.createElement("div");
        raceMeterFill.className = "mp-race-meter__fill";
        raceMeterFill.dataset.role = "mp-race-meter-fill";
        raceMeter.appendChild(raceMeterFill);
        boardHost.insertAdjacentElement("afterend", raceMeter);

        this.panelEl = panel;
        this.headerEl = header;
        this.nameEl = name;
        this.raceMeterEl = raceMeter;
        this.raceMeterFillEl = raceMeterFill;
        this.canvasEl = canvas;
        this.canvasCtx = canvas.getContext("2d");
        this.surface = this.game.renderer?.createSurface(this.canvasCtx, canvas) ?? null;
        this.game.themeOverlay.registerTarget("opponent", {overlayEl: filterEl, canvas: filterCanvas, boardEl});
        this._draw = draw ?? null;

        onLayoutResize?.();
        this.syncCanvasSize();

        this._handleWindowResize = () => this.syncCanvasSize();
        const resizeTarget = globalThis.visualViewport ?? globalThis.window ?? null;
        resizeTarget?.addEventListener("resize", this._handleWindowResize);
    }

    syncCanvasSize() {
        const canvas = this.canvasEl;
        if (!canvas) return;
        const cellSize = BOARD_CONFIG.CELL_SIZE || OPPONENT_BOARD_FALLBACK_CELL_PX;
        const width = cellSize * BOARD_CONFIG.COLS;
        const height = cellSize * BOARD_CONFIG.ROWS;
        if (canvas.width === width && canvas.height === height) return;
        canvas.width = width;
        canvas.height = height;
        this.game.themeOverlay.resize(width, height, "opponent");
        this._draw?.();
    }

    hide(onLayoutResize) {
        if (!this.panelEl && !this.localHeaderEl) return;
        this.game.themeOverlay.unregisterTarget("opponent");
        this.panelEl?.remove();
        this.panelEl = null;
        this.headerEl = null;
        this.nameEl = null;
        this.raceMeterEl?.remove();
        this.raceMeterEl = null;
        this.raceMeterFillEl = null;
        this.localHeaderEl?.remove();
        this.localHeaderEl = null;
        if (this.boardHost) {
            this.boardHost.style.paddingTop = "";
            this.boardHost = null;
        }
        this.canvasEl = null;
        this.canvasCtx = null;
        this.surface = null;
        this._draw = null;
        if (this._handleWindowResize) {
            const resizeTarget = globalThis.visualViewport ?? globalThis.window ?? null;
            resizeTarget?.removeEventListener("resize", this._handleWindowResize);
            this._handleWindowResize = null;
        }
        onLayoutResize?.();
    }

    setName(name) {
        if (this.nameEl) this.nameEl.textContent = name;
    }

    setPausedVisual(paused) {
        if (!this.panelEl) return;
        const board = this.panelEl.querySelector(".mp-opponent-column__board");
        if (board) board.classList.toggle("mp-opponent-board--paused", Boolean(paused));
    }

    updateRaceMeter(percent) {
        const fill = this.raceMeterFillEl;
        if (!fill) return;
        fill.style.height = `${Math.max(0, Math.min(100, percent))}%`;
        fill.classList.toggle("mp-race-meter__fill--winning", percent > 50);
        fill.classList.toggle("mp-race-meter__fill--losing", percent < 50);
    }

    resetRaceMeter() {
        const fill = this.raceMeterFillEl;
        if (!fill) return;
        fill.style.height = "50%";
        fill.classList.remove("mp-race-meter__fill--winning", "mp-race-meter__fill--losing");
    }

    buildClearFragments(cells, lineIndices) {
        const renderer = this.game.renderer;
        const surface = this.surface;
        if (!renderer || !surface || !cells || lineIndices.length === 0) return [];

        const {COLS, ROWS} = BOARD_CONFIG;
        return renderer.buildClearFragments({
            cells,
            cols: COLS,
            rows: ROWS,
            lineIndices,
            size: renderer.boardConfig.CELL_SIZE,
        });
    }

    _boardView(cells, version) {
        const {COLS, ROWS} = BOARD_CONFIG;
        if (!this._emptyCells) this._emptyCells = new Uint8Array(COLS * ROWS);
        return {cols: COLS, rows: ROWS, colors: cells || this._emptyCells, version};
    }

    draw(cells, version, livePiece = null, hardDropTrail = null, hardDropFlash = null, hardcoreMaskRow = null, theme = "none") {
        const surface = this.surface;
        const renderer = this.game.renderer;
        if (!surface || !renderer) return;

        const board = this._boardView(cells, version);
        const previous = {
            outline: renderer.outlineBlocksEnabled,
            ascii: renderer.asciiFallingPiecesEnabled,
            ghost: renderer.ghostType,
        };
        const visual = this.game.multiplayerController?.role === "bot"
            ? {
                blockType: this.game.settings.blockType ?? (this.game.settings.asciiFallingPieces ? "ascii" : (this.game.settings.outlineBlocks ? "radioactive" : "colorful")),
                ghostType: this.game.settings.ghostType ?? "white",
            }
            : {
                blockType: this.game.multiplayerController?._remoteBlockType ?? "colorful",
                ghostType: this.game.multiplayerController?._remoteGhostType ?? "white",
            };
        renderer.setOutlineBlocksEnabled(visual.blockType === "radioactive");
        renderer.setAsciiFallingPiecesEnabled(visual.blockType === "ascii");
        renderer.setGhostType(visual.ghostType);
        try {
            renderer.drawBoard(board, surface);

            if (hardcoreMaskRow !== null) {
                renderer.drawHardcoreMask(board, hardcoreMaskRow, theme, surface);
            }

            if (hardDropTrail) {
                renderer.drawHardDropTrail(hardDropTrail.entries, hardDropTrail.progress, surface);
            }

            if (hardDropFlash) {
                renderer.drawHardDropImpactFlash(hardDropFlash.entry, hardDropFlash.progress, surface);
            }

            if (livePiece) {
                const piece = {
                    x: livePiece.x,
                    y: livePiece.y,
                    mask: livePiece.mask,
                    renderMask: livePiece.renderMask,
                    width: livePiece.width,
                    height: livePiece.height,
                    pivotX: livePiece.pivotX,
                    pivotY: livePiece.pivotY,
                    renderAngle: livePiece.renderAngle || 0,
                    color: renderer.colorPalette[livePiece.colorIndex],
                };
                if (livePiece.ghostY !== undefined) {
                    const ghostBoard = {
                        rows: board.rows,
                        getDropOffset: () => Math.max(0, Number(livePiece.ghostY) - Number(livePiece.y ?? 0)),
                    };
                    renderer.drawGhost(piece, ghostBoard, surface);
                }
                renderer.drawPiece(piece, board, surface);
            }
        } finally {
            renderer.setOutlineBlocksEnabled(previous.outline);
            renderer.setAsciiFallingPiecesEnabled(previous.ascii);
            renderer.setGhostType(previous.ghost);
        }
    }

    drawClearingFrame(rc, progress) {
        const surface = this.surface;
        const renderer = this.game.renderer;
        if (!surface || !renderer || !rc?.cells) return;

        const {COLS, ROWS} = BOARD_CONFIG;
        const board = {cols: COLS, rows: ROWS, colors: rc.cells, version: rc.version};
        renderer.drawClearingFrame(board, rc.lines, rc.dropRows, rc.fragments || [], progress, surface);
    }
}
