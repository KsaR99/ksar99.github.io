"use strict";

export class HUD {
    /**
     * @param {object} elements
     * @param {HTMLElement} elements.scoreEl
     * @param {HTMLElement} elements.linesEl
     * @param {HTMLElement} elements.bestEl
     * @param {HTMLElement} elements.overlayEl
     * @param {HTMLElement} [elements.nextPieceCardEl]
     * @param {HTMLElement} [elements.statsStatusEl]
     * @param {HTMLElement} [elements.difficultyEl]
     * @param {HTMLElement} [elements.difficultyBarEl]
     * @param {HTMLElement} [elements.statsCardEl]
     * @param {import("./i18n.js").I18n} [elements.i18n]
     * @param {HTMLElement} [elements.timeEl]
     * @param {HTMLElement} [elements.droughtEl]
     * @param {HTMLElement} [elements.tetrisRateEl]
     * @param {HTMLElement} [elements.ppsEl]
     */
    constructor({
                    scoreEl, linesEl, bestEl, overlayEl,
                    nextPieceCardEl = null, statsStatusEl = null, difficultyEl = null,
                    difficultyBarEl = null, statsCardEl = null, i18n = null,
                    timeEl = null, droughtEl = null, tetrisRateEl = null, ppsEl = null,
                }) {
        this.scoreEl = scoreEl;
        this.linesEl = linesEl;
        this.bestEl = bestEl;
        this.overlayEl = overlayEl;
        this.nextPieceCardEl = nextPieceCardEl;
        this.statsStatusEl = statsStatusEl;
        this.difficultyEl = difficultyEl;
        this.difficultyBarEl = difficultyBarEl;
        this.statsCardEl = statsCardEl;
        this.i18n = i18n;
        this.timeEl = timeEl;
        this.droughtEl = droughtEl;
        this.tetrisRateEl = tetrisRateEl;
        this.ppsEl = ppsEl;
    }

    setHasPlayedBefore(hasPlayedBefore) {
        if (this.statsCardEl) {
            this.statsCardEl.classList.toggle("card--hidden", !hasPlayedBefore);
        }
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

    update({score, lines, best, difficulty, difficultyPercent, gameTime, drought, tetrisRate, pps}) {
        this.scoreEl.textContent = score;
        this.linesEl.textContent = lines;
        this.bestEl.textContent = best;
        if (this.difficultyEl && difficulty !== undefined) {
            this.difficultyEl.textContent = difficulty;
        }
        if (this.difficultyBarEl && difficultyPercent !== undefined) {
            this.difficultyBarEl.style.width = `${difficultyPercent}%`;
        }
        if (this.timeEl && gameTime !== undefined) {
            this.timeEl.textContent = gameTime;
        }
        if (this.droughtEl && drought !== undefined) {
            this.droughtEl.textContent = drought;
        }
        if (this.tetrisRateEl && tetrisRate !== undefined) {
            this.tetrisRateEl.textContent = tetrisRate;
        }
        if (this.ppsEl && pps !== undefined) {
            this.ppsEl.textContent = pps;
        }
    }

    showScreen(node, {transparentOverlay = false} = {}) {
        this.overlayEl.replaceChildren(node);
        this.overlayEl.classList.add("board__overlay--visible");
        this.overlayEl.classList.toggle("board__overlay--transparent", transparentOverlay);
    }

    updateCountdown(number, tint) {
        const screen = this.overlayEl.querySelector('[data-role="countdown-screen"]');
        if (!screen) return false;

        screen.dataset.tint = tint;

        const numberEl = screen.querySelector('[data-field="number"]');
        if (numberEl) {
            numberEl.textContent = number;
            numberEl.classList.remove("countdown__number");
            void numberEl.offsetWidth;
            numberEl.classList.add("countdown__number");
        }

        return true;
    }

    hideOverlay() {
        this.overlayEl.classList.remove("board__overlay--visible");
        this.overlayEl.classList.remove("board__overlay--transparent");
        this.overlayEl.replaceChildren();
    }
}
