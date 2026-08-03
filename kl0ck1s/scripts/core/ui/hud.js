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
     * @param {import("../services/i18n.js").I18n} [elements.i18n]
     * @param {HTMLElement} [elements.timeEl]
     * @param {HTMLElement} [elements.droughtEl]
     * @param {HTMLElement} [elements.tetrisRateEl]
     * @param {HTMLElement} [elements.ppsEl]
     * @param {HTMLElement} [elements.objectiveEl]
     * @param {HTMLElement} [elements.objectiveRowEl]
     * @param {HTMLElement} [elements.objectiveBarEl]
     * @param {HTMLElement} [elements.objectiveBarTrackEl]
     */
    constructor({
                    scoreEl, linesEl, bestEl, overlayEl,
                    nextPieceCardEl = null, statsStatusEl = null, difficultyEl = null,
                    difficultyBarEl = null, statsCardEl = null, i18n = null,
                    timeEl = null, droughtEl = null, tetrisRateEl = null, ppsEl = null,
                    objectiveEl = null, objectiveRowEl = null,
                    objectiveBarEl = null, objectiveBarTrackEl = null,
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
        this.objectiveEl = objectiveEl;
        this.objectiveRowEl = objectiveRowEl;
        this.objectiveBarEl = objectiveBarEl;
        this.objectiveBarTrackEl = objectiveBarTrackEl;

        this._cache = {
            score: undefined,
            lines: undefined,
            best: undefined,
            difficulty: undefined,
            difficultyPercent: undefined,
            gameTime: undefined,
            drought: undefined,
            tetrisRate: undefined,
            pps: undefined,
            objective: undefined,
            objectivePercent: undefined,
            objectiveUrgency: undefined,
            hasObjective: undefined,
            hasPlayedBefore: undefined,
            isPlaying: undefined,
            statsStatusText: undefined,
        };
    }

    _setText(el, cacheKey, value) {
        if (this._cache[cacheKey] === value) return;
        this._cache[cacheKey] = value;
        el.textContent = value;
    }

    setHasPlayedBefore(hasPlayedBefore) {
        if (this._cache.hasPlayedBefore === hasPlayedBefore) return;
        this._cache.hasPlayedBefore = hasPlayedBefore;

        if (this.statsCardEl) {
            this.statsCardEl.classList.toggle("card--hidden", !hasPlayedBefore);
        }
    }

    setPlaying(isPlaying) {
        if (this._cache.isPlaying === isPlaying) return;
        this._cache.isPlaying = isPlaying;

        if (this.nextPieceCardEl) {
            this.nextPieceCardEl.classList.toggle("card--hidden", !isPlaying);
        }
        if (this.statsStatusEl) {
            const text = this.i18n
                ? this.i18n.t(isPlaying ? "sidebar.statusLive" : "sidebar.statusLast")
                : (isPlaying ? "Current game" : "Last game");

            if (this._cache.statsStatusText !== text) {
                this._cache.statsStatusText = text;
                this.statsStatusEl.textContent = text;
            }
            this.statsStatusEl.classList.toggle("stats__status--live", isPlaying);
        }
    }

    update({
               score, lines, best, difficulty, difficultyPercent, gameTime, drought, tetrisRate, pps,
               objective, objectivePercent, objectiveUrgency, objectiveColorMode,
           }) {
        this._setText(this.scoreEl, "score", score);
        this._setText(this.linesEl, "lines", lines);
        this._setText(this.bestEl, "best", best);

        if (this.difficultyEl && difficulty !== undefined) {
            this._setText(this.difficultyEl, "difficulty", difficulty);
        }

        if (this.difficultyBarEl && difficultyPercent !== undefined) {
            if (this._cache.difficultyPercent !== difficultyPercent) {
                this._cache.difficultyPercent = difficultyPercent;
                this.difficultyBarEl.style.width = `${difficultyPercent}%`;
            }
        }

        if (this.timeEl && gameTime !== undefined) {
            this._setText(this.timeEl, "gameTime", gameTime);
        }

        if (this.droughtEl && drought !== undefined) {
            this._setText(this.droughtEl, "drought", drought);
        }

        if (this.tetrisRateEl && tetrisRate !== undefined) {
            this._setText(this.tetrisRateEl, "tetrisRate", tetrisRate);
        }

        if (this.ppsEl && pps !== undefined) {
            this._setText(this.ppsEl, "pps", pps);
        }

        if (objective !== undefined) {
            const hasObjective = objective !== null;

            if (this.objectiveRowEl && this._cache.hasObjective !== hasObjective) {
                this._cache.hasObjective = hasObjective;
                this.objectiveRowEl.classList.toggle("stats__row--hidden", !hasObjective);
            }

            if (this.objectiveEl && hasObjective) {
                this._setText(this.objectiveEl, "objective", objective);
            }

            if (this.objectiveBarEl && hasObjective && objectivePercent !== undefined && objectivePercent !== null) {
                if (this._cache.objectivePercent !== objectivePercent) {
                    this._cache.objectivePercent = objectivePercent;
                    this.objectiveBarEl.style.width = `${objectivePercent}%`;

                    // "ramp" mode (Sprint): ease the fill color from neutral toward
                    // "good" as lines closed in on the target - set directly here
                    // rather than via a CSS class, since it needs the continuous
                    // percent rather than a handful of discrete steps.
                    this.objectiveBarEl.style.backgroundColor = objectiveColorMode === "ramp"
                        ? `color-mix(in oklch, var(--accent-2) ${100 - objectivePercent}%, var(--good) ${objectivePercent}%)`
                        : "";
                }
            }

            if (this.objectiveBarTrackEl && this._cache.objectiveUrgency !== objectiveUrgency) {
                this._cache.objectiveUrgency = objectiveUrgency;
                if (objectiveUrgency) {
                    this.objectiveBarTrackEl.dataset.urgency = objectiveUrgency;
                } else {
                    delete this.objectiveBarTrackEl.dataset.urgency;
                }
            }
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
