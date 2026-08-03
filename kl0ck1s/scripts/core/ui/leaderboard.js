"use strict";

import {formatDurationPrecise, formatNumber} from "../shared/utils.js";

export class Leaderboard {
    static SCORES_KEY = "klockis-scores";
    static NAME_KEY = "klockis-last-name";
    static TODAY_BEST_KEY = "klockis-today-best";
    static MAX_ENTRIES = 10;

    constructor(store, dom = globalThis.document ?? null, i18n = null) {
        this.store = store;
        this.dom = dom;
        this.i18n = i18n;
        this.cache = [];
        this.lastNameCache = "";
        this.todayBestCache = null;
    }

    isToday(iso) {
        return new Date(iso).toDateString() === new Date().toDateString();
    }

    entryMode(entry) {
        return entry.mode || "marathon";
    }

    // Sprint and Cheese Race are both races against the clock - fastest
    // finish wins, so they're ranked by time rather than score. Every other
    // mode (including the score-attack finishes of Dig Survival/Countdown)
    // ranks by score, same as Marathon/Ultra/Survival always have.
    isTimedRaceMode(mode) {
        return mode === "sprint" || mode === "cheeseRace";
    }

    compareEntries(a, b, mode) {
        if (this.isTimedRaceMode(mode)) return (a.timeMs ?? Infinity) - (b.timeMs ?? Infinity);
        return b.score - a.score;
    }

    /** Entries for one mode, sorted best-first by that mode's own ranking criteria (score, or time for Sprint). */
    forMode(mode) {
        return this.cache
            .filter((entry) => this.entryMode(entry) === mode)
            .sort((a, b) => this.compareEntries(a, b, mode));
    }

    bestEntry(mode = "marathon") {
        return this.forMode(mode)[0] ?? null;
    }

    async loadTodayBest() {
        let stored = null;
        try {
            const raw = await this.store.get(Leaderboard.TODAY_BEST_KEY);
            stored = raw ? JSON.parse(raw) : null;
        } catch {
            stored = null;
        }
        this.todayBestCache = stored && this.isToday(stored.date) ? stored : null;
        return this.todayBestCache;
    }

    async recordIfTodayBest(entry) {
        const current = this.todayBestCache;
        const currentIsToday = current && this.isToday(current.date);
        if (!currentIsToday || entry.score > current.score) {
            this.todayBestCache = entry;
            await this.store.set(Leaderboard.TODAY_BEST_KEY, JSON.stringify(entry));
        }
        return this.todayBestCache;
    }

    async load() {
        try {
            const raw = await this.store.get(Leaderboard.SCORES_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            this.cache = Array.isArray(parsed) ? parsed : [];
        } catch {
            this.cache = [];
        }
        return this.cache;
    }

    async add(entry) {
        const list = this.cache.slice();
        list.push(entry);

        const byMode = new Map();
        list.forEach((e) => {
            const mode = this.entryMode(e);
            if (!byMode.has(mode)) byMode.set(mode, []);
            byMode.get(mode).push(e);
        });

        const trimmed = [];
        byMode.forEach((entries, mode) => {
            entries.sort((a, b) => this.compareEntries(a, b, mode));
            trimmed.push(...entries.slice(0, Leaderboard.MAX_ENTRIES));
        });

        this.cache = trimmed;
        await this.store.set(Leaderboard.SCORES_KEY, JSON.stringify(this.cache));

        return this.forMode(this.entryMode(entry));
    }

    async loadLastName() {
        this.lastNameCache = (await this.store.get(Leaderboard.NAME_KEY)) || "";
        return this.lastNameCache;
    }

    async setLastName(name) {
        this.lastNameCache = name;
        await this.store.set(Leaderboard.NAME_KEY, name);
    }

    bestScore(mode = "marathon") {
        return this.bestEntry(mode)?.score ?? 0;
    }

    todayBestEntry() {
        return this.todayBestCache;
    }

    /**
     * Leaderboard dates are formatted relative to "now":
     * - Different year: day/month/year + time
     * - Same year, different month: day/month + time
     * - Same month, different day: day + time
     * - Same day: time only
     */
    formatDate(iso) {
        const date = new Date(iso);
        const now = new Date();
        const locale = this.i18n?.locale || "en-US";

        const sameYear = date.getFullYear() === now.getFullYear();
        const sameMonth = sameYear && date.getMonth() === now.getMonth();
        const sameDay = sameMonth && date.getDate() === now.getDate();

        if (sameDay) {
            return date.toLocaleString(locale, {
                hour: "2-digit",
                minute: "2-digit",
            });
        }

        if (sameMonth) {
            return date.toLocaleString(locale, {
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
            });
        }

        if (sameYear) {
            return date.toLocaleString(locale, {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
            });
        }

        return date.toLocaleString(locale, {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    renderTable(list, highlightEntry = null) {
        if (list.length === 0) {
            return this.dom.getElementById("tpl-leaderboard-empty").content.cloneNode(true);
        }

        const table = this.dom.getElementById("tpl-leaderboard-table").content.cloneNode(true);
        const tbody = table.querySelector('[data-field="rows"]');
        const podiumBadges = ["🥇", "🥈", "🥉"];

        list.forEach((entry, i) => {
            const row = this.dom.getElementById("tpl-leaderboard-row").content.cloneNode(true);
            row.querySelector(".leaderboard__row").classList.toggle("leaderboard__row--new", entry === highlightEntry);
            row.querySelector('[data-field="rank"]').innerHTML = (i < 3 ? podiumBadges[i] : `&nbsp;${i + 1}`);
            row.querySelector('[data-field="name"]').textContent = entry.name;
            row.querySelector('[data-field="score"]').textContent = formatNumber(entry.score);
            row.querySelector('[data-field="time"]').textContent = this.isTimedRaceMode(this.entryMode(entry))
                ? formatDurationPrecise(entry.timeMs)
                : "—";
            row.querySelector('[data-field="level"]').textContent = entry.level;
            row.querySelector('[data-field="lines"]').textContent = entry.lines;
            row.querySelector('[data-field="date"]').textContent = this.formatDate(entry.date);
            tbody.appendChild(row);
        });

        return table;
    }
}
