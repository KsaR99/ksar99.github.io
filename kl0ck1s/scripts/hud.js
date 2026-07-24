"use strict";

export class HUD {
    /**
     * @param {object} elements
     * @param {HTMLElement} elements.scoreEl
     * @param {HTMLElement} elements.levelEl
     * @param {HTMLElement} elements.linesEl
     * @param {HTMLElement} elements.bestEl
     * @param {HTMLElement} elements.overlayEl
     * @param {HTMLElement} [elements.nextPieceCardEl]
     * @param {HTMLElement} [elements.statsStatusEl]
     * @param {import("./i18n.js").I18n} [elements.i18n]
     */
    constructor({
                    scoreEl, levelEl, linesEl, bestEl, overlayEl,
                    nextPieceCardEl = null, statsStatusEl = null, i18n = null,
                }) {
        this.scoreEl = scoreEl;
        this.levelEl = levelEl;
        this.linesEl = linesEl;
        this.bestEl = bestEl;
        this.overlayEl = overlayEl;
        this.nextPieceCardEl = nextPieceCardEl;
        this.statsStatusEl = statsStatusEl;
        this.i18n = i18n;
    }

    setPlaying(isPlaying) {
        if (this.nextPieceCardEl) {
            this.nextPieceCardEl.classList.toggle("card--hidden", !isPlaying);
        }
        if (this.statsStatusEl) {
            this.statsStatusEl.textContent = this.i18n
                ? this.i18n.t(isPlaying ? "sidebar.statusLive" : "sidebar.statusLast")
                : (isPlaying ? "Current game" : "Last game");
            this.statsStatusEl.classList.toggle("stats__status--live", isPlaying);
        }
    }

    update({score, level, lines, best}) {
        this.scoreEl.textContent = score;
        this.levelEl.textContent = level;
        this.linesEl.textContent = lines;
        this.bestEl.textContent = best;
    }

    showScreen(node) {
        this.overlayEl.replaceChildren(node);
        this.overlayEl.classList.add("board__overlay--visible");
    }

    hideOverlay() {
        this.overlayEl.classList.remove("board__overlay--visible");
        this.overlayEl.replaceChildren();
    }
}
