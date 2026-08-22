// @ts-nocheck
export type CanvasDom = {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
};

function required<T extends Element>(root: ParentNode, selector: string): T {
    const element = root.querySelector<T>(selector);
    if (!element) {
        throw new Error(`Required DOM element not found: ${selector}`);
    }
    return element;
}

function requiredById<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) {
        throw new Error(`Required DOM element not found: #${id}`);
    }
    return element as T;
}

function canvas(root: ParentNode, selector: string): CanvasDom {
    const element = required<HTMLCanvasElement>(root, selector);
    const context = element.getContext("2d");
    if (!context) {
        throw new Error(`2D canvas context is unavailable: ${selector}`);
    }
    context.imageSmoothingEnabled = false;
    return {canvas: element, context};
}

export interface AppDom {
    body: HTMLBodyElement;
    app: HTMLElement;
    bootScreen: HTMLElement;
    bootBarFill: HTMLElement;
    bootStatus: HTMLElement;
    boardStage: HTMLElement;
    board: HTMLElement;
    boardCanvas: HTMLCanvasElement;
    boardContext: CanvasRenderingContext2D;
    themeCanvas: HTMLCanvasElement;
    themeContext: CanvasRenderingContext2D;
    sidebarStats: HTMLElement;
    statsCard: HTMLElement;
    statusCard: HTMLElement;
    nextPieceCard: HTMLElement;
    nextCanvases: HTMLCanvasElement[];
    nextContexts: CanvasRenderingContext2D[];
}

export function collectAppDom(): AppDom {
    const body = document.body;
    if (!body) throw new Error("Document body is required");

    const app = required<HTMLElement>(body, ".app");
    const bootScreen = requiredById<HTMLElement>("boot-screen");
    const bootBarFill = required<HTMLElement>(bootScreen, "#boot-bar-fill");
    const bootStatus = required<HTMLElement>(bootScreen, "#boot-status");

    const boardStage = required<HTMLElement>(body, ".board__stage");
    const board = required<HTMLElement>(boardStage, "#klockis-board").parentElement;
    if (!board) throw new Error("Board container is required");

    const boardSurface = canvas(boardStage, "#klockis-board");
    const themeSurface = canvas(boardStage, "#filter-canvas");

    const sidebarStats = required<HTMLElement>(body, ".sidebar--stats");
    const statsCard = required<HTMLElement>(sidebarStats, '[data-role="stats-card"]');
    const statusCard = required<HTMLElement>(sidebarStats, '[data-role="status-card"]');
    const nextPieceCard = required<HTMLElement>(sidebarStats, '[data-role="next-piece-card"]');

    const nextSurfaces = Array.from(
        nextPieceCard.querySelectorAll<HTMLCanvasElement>(".next-piece__canvas"),
    ).map((element) => {
        const context = element.getContext("2d");
        if (!context) throw new Error("Next-piece canvas context is unavailable");
        context.imageSmoothingEnabled = false;
        return {canvas: element, context};
    });

    return {
        body,
        app,
        bootScreen,
        bootBarFill,
        bootStatus,
        boardStage,
        board,
        boardCanvas: boardSurface.canvas,
        boardContext: boardSurface.context,
        themeCanvas: themeSurface.canvas,
        themeContext: themeSurface.context,
        sidebarStats,
        statsCard,
        statusCard,
        nextPieceCard,
        nextCanvases: nextSurfaces.map(({canvas: element}) => element),
        nextContexts: nextSurfaces.map(({context}) => context),
    };
}
