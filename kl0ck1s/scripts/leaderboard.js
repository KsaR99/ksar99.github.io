"use strict";

export class Leaderboard {
    static SCORES_KEY = "klockis-scores";
    static NAME_KEY = "klockis-last-name";
    static MAX_ENTRIES = 10;

    constructor(store, dom = (typeof document !== "undefined" ? document : null)) {
        this.store = store;
        this.dom = dom;
        this.cache = [];
        this.lastNameCache = "";
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
        list.sort((a, b) => b.score - a.score);
        this.cache = list.slice(0, Leaderboard.MAX_ENTRIES);

        await this.store.set(Leaderboard.SCORES_KEY, JSON.stringify(this.cache));

        return this.cache;
    }

    async loadLastName() {
        this.lastNameCache = (await this.store.get(Leaderboard.NAME_KEY)) || "";
        return this.lastNameCache;
    }

    async setLastName(name) {
        this.lastNameCache = name;
        await this.store.set(Leaderboard.NAME_KEY, name);
    }

    bestScore() {
        return this.cache.length ? this.cache[0].score : 0;
    }

    formatDate(iso) {
        const date = new Date(iso);
        return date.toLocaleString("pl-PL", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit",
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
            row.querySelector('[data-field="score"]').textContent = entry.score;
            row.querySelector('[data-field="level"]').textContent = entry.level;
            row.querySelector('[data-field="lines"]').textContent = entry.lines;
            row.querySelector('[data-field="date"]').textContent = this.formatDate(entry.date);
            tbody.appendChild(row);
        });

        return table;
    }
}
