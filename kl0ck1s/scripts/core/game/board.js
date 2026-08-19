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

    reset() {
        this.occupancy = new Uint32Array(this.rows);
        this.colors = new Uint8Array(this.rows * this.cols);
        this.overflowBuffer = [];
        ++this.version;
    }

    #emptyGrid() {
        return {
            occupancy: new Uint32Array(this.rows),
            colors: new Uint8Array(this.rows * this.cols),
        };
    }

    #copyRowColors(newColors, srcY, destY) {
        newColors.set(
            this.colors.subarray(srcY * this.cols, (srcY + 1) * this.cols),
            destY * this.cols
        );
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

    getHighestOccupiedRow() {
        for (let y = 0; y < this.rows; y++) {
            if (this.occupancy[y] !== 0) return y;
        }
        return this.rows;
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

        const {occupancy: newOccupancy, colors: newColors} = this.#emptyGrid();

        let dest = this.rows - 1;
        for (let i = keptRows.length - 1; i >= 0; i--, dest--) {
            const src = keptRows[i];
            newOccupancy[dest] = this.occupancy[src];
            this.#copyRowColors(newColors, src, dest);
        }

        this.occupancy = newOccupancy;
        this.colors = newColors;
        this.version++;
        return cleared;
    }

    /**
     * Compacts every column independently, letting each column's filled
     * cells fall to fill any gaps beneath them - unlike a normal Tetris
     * clear, where whole rows shift down as a rigid block. Used by Cascade
     * mode so that clearing a line can drop overhanging blocks into holes
     * elsewhere on the board, potentially completing new lines.
     *
     * @param {Uint8Array|null} [dropGrid] - optional buffer (length rows*cols)
     *   to receive, for every surviving cell's *final* position, how many
     *   rows it fell from its pre-compaction position (0 if it didn't move).
     *   Lets a caller animate the per-column fall instead of only applying
     *   the result instantly.
     * @returns {boolean} true if any cell moved.
     */
    compactColumns(dropGrid = null) {
        let moved = false;

        for (let x = 0; x < this.cols; x++) {
            const bit = 1 << x;
            const stackColors = [];
            const stackFromRows = [];
            for (let y = 0; y < this.rows; y++) {
                if (this.occupancy[y] & bit) {
                    stackColors.push(this.colors[y * this.cols + x]);
                    stackFromRows.push(y);
                }
            }

            const startY = this.rows - stackColors.length;
            for (let y = 0; y < this.rows; y++) {
                const idx = y * this.cols + x;
                if (y >= startY) {
                    const i = y - startY;
                    const color = stackColors[i];
                    if (!(this.occupancy[y] & bit) || this.colors[idx] !== color) moved = true;
                    this.occupancy[y] |= bit;
                    this.colors[idx] = color;
                    if (dropGrid) dropGrid[idx] = y - stackFromRows[i];
                } else if (this.occupancy[y] & bit) {
                    moved = true;
                    this.occupancy[y] &= ~bit;
                    this.colors[idx] = 0;
                }
            }
        }

        if (moved) this.version++;
        return moved;
    }

    /**
     * Cascade-style clear: removes whichever rows are currently full, then
     * lets each column collapse independently via compactColumns() instead
     * of shifting the whole board down as one rigid block. This can drop
     * floating blocks into holes elsewhere on the board and form brand new
     * full rows without the player placing another piece - call this again
     * (checking getFullLineIndices()) to resolve a full cascade chain.
     *
     * @returns {{cleared: number, rows: number[], dropGrid: Uint8Array|null}}
     */
    collapseFullLines() {
        const rows = this.getFullLineIndices();
        if (rows.length === 0) return {cleared: 0, rows, dropGrid: null};

        for (const y of rows) {
            this.occupancy[y] = 0;
            this.colors.fill(0, y * this.cols, (y + 1) * this.cols);
        }

        const dropGrid = new Uint8Array(this.rows * this.cols);
        this.compactColumns(dropGrid);
        this.version++;
        return {cleared: rows.length, rows, dropGrid};
    }

    addGarbageLines(count) {
        if (count <= 0) return {toppedOut: false};

        let toppedOut = false;
        for (let y = 0; y < Math.min(count, this.rows); y++) {
            if (this.occupancy[y] !== 0) toppedOut = true;
        }

        const {occupancy: newOccupancy, colors: newColors} = this.#emptyGrid();

        for (let y = count; y < this.rows; y++) {
            newOccupancy[y - count] = this.occupancy[y];
            this.#copyRowColors(newColors, y, y - count);
        }

        const gapCol = Math.floor(Math.random() * this.cols);
        for (let i = 0; i < Math.min(count, this.rows); i++) {
            const y = this.rows - count + i;
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
        ++this.version;
        return {toppedOut};
    }

    emptyRowsFromTop(limit = this.rows) {
        let count = 0;
        for (let y = 0; y < this.rows && count < limit; y++) {
            if (this.occupancy[y] !== 0) break;
            count++;
        }
        return count;
    }

    shiftDown(amount) {
        if (amount <= 0) return 0;
        const shift = Math.min(amount, this.rows);
        if (shift <= 0) return 0;

        const hiddenRows = [];
        for (let y = this.rows - shift; y < this.rows; y++) {
            hiddenRows.push({
                occ: this.occupancy[y],
                colors: this.colors.slice(y * this.cols, (y + 1) * this.cols),
            });
        }
        this.overflowBuffer.unshift(...hiddenRows);

        const {occupancy: newOccupancy, colors: newColors} = this.#emptyGrid();

        for (let y = 0; y < this.rows - shift; y++) {
            newOccupancy[y + shift] = this.occupancy[y];
            this.#copyRowColors(newColors, y, y + shift);
        }

        this.occupancy = newOccupancy;
        this.colors = newColors;
        ++this.version;
        return shift;
    }

    shiftUp(amount) {
        if (amount <= 0) return 0;
        const shift = Math.min(amount, this.rows, this.emptyRowsFromTop(amount), this.overflowBuffer.length);
        if (shift <= 0) return 0;

        const {occupancy: newOccupancy, colors: newColors} = this.#emptyGrid();

        for (let y = shift; y < this.rows; y++) {
            newOccupancy[y - shift] = this.occupancy[y];
            this.#copyRowColors(newColors, y, y - shift);
        }

        const restoredRows = this.overflowBuffer.splice(0, shift);
        for (let i = 0; i < shift; i++) {
            const y = this.rows - shift + i;
            newOccupancy[y] = restoredRows[i].occ;
            newColors.set(restoredRows[i].colors, y * this.cols);
        }

        this.occupancy = newOccupancy;
        this.colors = newColors;
        ++this.version;
        return shift;
    }
}
