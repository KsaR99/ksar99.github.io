"use strict";

import {GARBAGE_COLOR_INDEX} from "../shared/config.js";

export class Board {
    constructor(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.fullRowMask = (1 << cols) - 1;
        this.version = 0;
        this.reset();
    }

    /** occupancy[y] = bitmask of filled columns in row y (bit c = column c). */
    /** colors[y*cols+x] = colorIndex (0 = empty), used only for rendering the locked board. */
    reset() {
        this.occupancy = new Uint32Array(this.rows);
        this.colors = new Uint8Array(this.rows * this.cols);
        this.version++;
    }

    isInsideCols(x) {
        return x >= 0 && x < this.cols;
    }

    isAboveFloor(y) {
        return y < this.rows;
    }

    isCellFree(x, y) {
        if (y < 0) return true;
        return (this.occupancy[y] & (1 << x)) === 0;
    }

    collides(piece, offsetX, offsetY, mask = piece.mask) {
        const {width, height} = piece;

        for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
                if (!((mask >> (r * width + c)) & 1)) continue;

                const x = piece.x + c + offsetX;
                const y = piece.y + r + offsetY;

                if (!this.isInsideCols(x) || !this.isAboveFloor(y)) return true;
                if (!this.isCellFree(x, y)) return true;
            }
        }
        return false;
    }

    isCornerBlocked(x, y) {
        if (!this.isInsideCols(x)) return true;
        if (!this.isAboveFloor(y)) return true;
        return !this.isCellFree(x, y);
    }

    getCornerFlags(piece) {
        const {width, height} = piece;
        return {
            topLeft: this.isCornerBlocked(piece.x - 1, piece.y - 1),
            topRight: this.isCornerBlocked(piece.x + width, piece.y - 1),
            bottomLeft: this.isCornerBlocked(piece.x - 1, piece.y + height),
            bottomRight: this.isCornerBlocked(piece.x + width, piece.y + height),
        };
    }

    countBlockedCorners(piece) {
        return Object.values(this.getCornerFlags(piece)).filter(Boolean).length;
    }

    getDropOffset(piece) {
        let offset = 0;
        while (!this.collides(piece, 0, offset + 1)) {
            ++offset;
        }
        return offset;
    }

    getFullLineIndices() {
        const indices = [];
        for (let y = 0; y < this.rows; y++) {
            if (this.occupancy[y] === this.fullRowMask) indices.push(y);
        }
        return indices;
    }

    lockPiece(piece) {
        const {width, height, mask, colorIndex} = piece;

        for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
                if (!((mask >> (r * width + c)) & 1)) continue;

                const y = piece.y + r;
                const x = piece.x + c;
                if (y < 0) continue;

                this.occupancy[y] |= (1 << x);
                this.colors[y * this.cols + x] = colorIndex;
            }
        }

        this.version++;
    }

    clearFullLines() {
        const keptRows = [];
        for (let y = 0; y < this.rows; y++) {
            if (this.occupancy[y] !== this.fullRowMask) keptRows.push(y);
        }

        const cleared = this.rows - keptRows.length;
        if (cleared === 0) return 0;

        const newOccupancy = new Uint32Array(this.rows);
        const newColors = new Uint8Array(this.rows * this.cols);

        // Rebuild bottom-up: kept rows keep their relative order, shifted down.
        let dest = this.rows - 1;
        for (let i = keptRows.length - 1; i >= 0; i--, dest--) {
            const src = keptRows[i];
            newOccupancy[dest] = this.occupancy[src];
            newColors.set(
                this.colors.subarray(src * this.cols, (src + 1) * this.cols),
                dest * this.cols
            );
        }

        this.occupancy = newOccupancy;
        this.colors = newColors;
        this.version++;
        return cleared;
    }

    /**
     * Shifts the whole board up by `count` rows and fills that many new
     * rows at the bottom, each solid except for one random gap column.
     * Returns {toppedOut: true} if any of the rows pushed off the top were
     * occupied - the caller should treat that as an instant game over.
     */
    addGarbageLines(count) {
        if (count <= 0) return {toppedOut: false};

        let toppedOut = false;
        for (let y = 0; y < Math.min(count, this.rows); y++) {
            if (this.occupancy[y] !== 0) toppedOut = true;
        }

        const newOccupancy = new Uint32Array(this.rows);
        const newColors = new Uint8Array(this.rows * this.cols);

        for (let y = count; y < this.rows; y++) {
            newOccupancy[y - count] = this.occupancy[y];
            newColors.set(
                this.colors.subarray(y * this.cols, (y + 1) * this.cols),
                (y - count) * this.cols
            );
        }

        for (let i = 0; i < Math.min(count, this.rows); i++) {
            const y = this.rows - count + i;
            const gapCol = Math.floor(Math.random() * this.cols);
            let rowMask = 0;
            for (let x = 0; x < this.cols; x++) {
                if (x === gapCol) continue;
                rowMask |= (1 << x);
                newColors[y * this.cols + x] = GARBAGE_COLOR_INDEX;
            }
            newOccupancy[y] = rowMask;
        }

        this.occupancy = newOccupancy;
        this.colors = newColors;
        this.version++;
        return {toppedOut};
    }
}
