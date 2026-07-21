"use strict";

export class Board {
    constructor(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.grid = this.createEmptyGrid();
    }

    createEmptyGrid() {
        return Array.from({length: this.rows}, () => Array(this.cols).fill(null));
    }

    isInsideCols(x) {
        return x >= 0 && x < this.cols;
    }

    isAboveFloor(y) {
        return y < this.rows;
    }

    isCellFree(x, y) {
        if (y < 0) return true;
        return this.grid[y][x] === null;
    }

    collides(piece, offsetX, offsetY, shape = piece.shape) {
        for (let r = 0; r < shape.length; r++) {
            for (let c = 0; c < shape[r].length; c++) {
                if (!shape[r][c]) continue;

                const x = piece.x + c + offsetX;
                const y = piece.y + r + offsetY;

                if (!this.isInsideCols(x) || !this.isAboveFloor(y)) return true;
                if (!this.isCellFree(x, y)) return true;
            }
        }
        return false;
    }

   getDropOffset(piece) {
        let offset = 0;
        while (!this.collides(piece, 0, offset + 1)) {
            offset++;
        }
        return offset;
    }

    getFullLineIndices() {
        const indices = [];
        this.grid.forEach((row, y) => {
            if (row.every((cell) => cell !== null)) indices.push(y);
        });
        return indices;
    }

    lockPiece(piece) {
        piece.shape.forEach((row, r) => {
            row.forEach((cell, c) => {
                if (!cell) return;
                const y = piece.y + r;
                const x = piece.x + c;
                if (y >= 0) this.grid[y][x] = piece.color;
            });
        });
    }

    clearFullLines() {
        let cleared = 0;

        this.grid = this.grid.filter((row) => {
            const isFull = row.every((cell) => cell !== null);
            if (isFull) cleared++;
            return !isFull;
        });

        while (this.grid.length < this.rows) {
            this.grid.unshift(Array(this.cols).fill(null));
        }

        return cleared;
    }

    reset() {
        this.grid = this.createEmptyGrid();
    }
}
