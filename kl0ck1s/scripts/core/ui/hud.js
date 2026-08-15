"use strict";

export class HUD {
    constructor({
                    scoreEl, linesEl, bestEl, overlayEl,
                    nextPieceCardEl = null, statsStatusEl = null, difficultyEl = null,
                    difficultyBarEl = null, statsCardEl = null, i18n = null,
                    timeEl = null, droughtEl = null, tetrisRateEl = null, ppsEl = null,
                    objectiveEl = null, objectiveRowEl = null,
                    objectiveBarEl = null, objectiveBarTrackEl = null, linesRowEl = null,
                    bestRowEl = null, difficultyRowEl = null,
                }) {
        this.scoreEl = scoreEl;
        this.linesEl = linesEl;
        this.linesRowEl = linesRowEl;
        this.bestEl = bestEl;
        this.bestRowEl = bestRowEl;
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
        this.difficultyRowEl = difficultyRowEl;

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
            objectiveColorMode: undefined,
            objectiveUrgency: undefined,
            hasObjective: undefined,
            hasLinesRow: undefined,
            hasRecord: undefined,
            hasLevelProgress: undefined,
            hasPlayedBefore: undefined,
            isPlaying: undefined,
            statsStatusMode: undefined,
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

    setPlaying(isPlaying, mode = null) {
        if (this._cache.isPlaying === isPlaying && this._cache.statsStatusMode === mode) return;
        this._cache.isPlaying = isPlaying;
        this._cache.statsStatusMode = mode;

        if (this.nextPieceCardEl) {
            this.nextPieceCardEl.classList.toggle("card--hidden", !isPlaying);
        }
        if (this.statsStatusEl) {
            const text = isPlaying && mode
                ? (this.i18n ? this.i18n.t(`modes.${mode}.name`) : mode)
                : (this.i18n ? this.i18n.t("sidebar.statusLast") : "Last game");

            if (this._cache.statsStatusText !== text) {
                this._cache.statsStatusText = text;
                this.statsStatusEl.textContent = text;
            }
            this.statsStatusEl.classList.toggle("stats__status--live", isPlaying);
        }
    }

    update({
               score, lines, best, difficulty, difficultyPercent, gameTime, drought, tetrisRate, pps,
               objective, objectivePercent, objectiveUrgency, objectiveColorMode, noLeaderboard, hasLevelProgress,
           }) {
        this._setText(this.scoreEl, "score", score);
        this._setText(this.linesEl, "lines", lines);
        this._setText(this.bestEl, "best", best);

        if (this.bestRowEl) {
            const hasRecord = !noLeaderboard;
            if (this._cache.hasRecord !== hasRecord) {
                this._cache.hasRecord = hasRecord;
                this.bestRowEl.classList.toggle("stats__row--hidden", !hasRecord);
            }
        }

        if (this.linesRowEl) {
            const hideLinesRow = objectiveColorMode === "ramp";
            if (this._cache.hasLinesRow !== !hideLinesRow) {
                this._cache.hasLinesRow = !hideLinesRow;
                this.linesRowEl.classList.toggle("stats__row--hidden", hideLinesRow);
            }
        }

        if (this.difficultyEl && difficulty !== undefined) {
            this._setText(this.difficultyEl, "difficulty", difficulty);
        }

        if (this.difficultyRowEl && hasLevelProgress !== undefined) {
            if (this._cache.hasLevelProgress !== hasLevelProgress) {
                this._cache.hasLevelProgress = hasLevelProgress;
                this.difficultyRowEl.classList.toggle("stats__row--hidden", !hasLevelProgress);
            }
        }

        if (this.difficultyBarEl && difficultyPercent !== undefined && hasLevelProgress !== false) {
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
                if (this._cache.objectivePercent !== objectivePercent || this._cache.objectiveColorMode !== objectiveColorMode) {
                    this._cache.objectivePercent = objectivePercent;
                    this._cache.objectiveColorMode = objectiveColorMode;
                    this.objectiveBarEl.style.width = `${objectivePercent}%`;
                    this.objectiveBarEl.style.backgroundColor = objectiveColorMode === "ramp"
                        ? `color-mix(in oklch, var(--accent-2) ${100 - objectivePercent}%, var(--good) ${objectivePercent}%)`
                        : "";
                }
            }

            if (this.objectiveBarTrackEl && this._cache.objectiveUrgency !== objectiveUrgency) {
                this._cache.objectiveUrgency = objectiveUrgency;
                const urgencyClasses = this.objectiveBarTrackEl.classList;
                urgencyClasses.remove("progress-bar--warning", "progress-bar--danger");
                if (objectiveUrgency) urgencyClasses.add(`progress-bar--${objectiveUrgency}`);
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

        const tintClasses = screen.classList;
        tintClasses.remove("screen--countdown--red", "screen--countdown--yellow", "screen--countdown--green");
        if (tint) tintClasses.add(`screen--countdown--${tint}`);

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
        this.overlayEl.classList.remove("board__overlay--visible", "board__overlay--transparent");
        this.overlayEl.replaceChildren();
    }
}
