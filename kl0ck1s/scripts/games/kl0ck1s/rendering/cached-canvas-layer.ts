// @ts-nocheck
"use strict";

export class CachedCanvasLayer {

    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;

    constructor() {
        this.canvas = document.createElement("canvas");
        this.ctx = this.canvas.getContext("2d");
    }

    resize(width, height) {
        const h = Math.max(1, height);
        if (this.canvas.width !== width) this.canvas.width = width;
        if (this.canvas.height !== h) this.canvas.height = h;
    }
}
