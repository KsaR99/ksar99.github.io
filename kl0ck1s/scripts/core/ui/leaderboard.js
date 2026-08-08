"use strict";

import {formatDuration, formatDurationPrecise, formatNumber} from "../shared/utils.js";

export class Leaderboard {
    static SCORES_KEY = "klockis-scores";
    static NAME_KEY = "klockis-last-name";
    static TODAY_BEST_KEY = "klockis-today-best";
    static PROFILES_KEY = "klockis-profiles";
    static PROFILE_SETTINGS_KEY = "klockis-profile-settings";
    static PROFILE_TRASH_KEY = "klockis-profile-trash";
    static MAX_ENTRIES = 10;
    static MAX_PROFILES = 12;
    static PROFILE_TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

    constructor(store, dom = globalThis.document ?? null, i18n = null) {
        this.store = store;
        this.dom = dom;
        this.i18n = i18n;
        this.cache = [];
        this.lastNameCache = "";
        this.todayBestCache = null;
        this.profile = "";
        this.profiles = [];
        this.trash = [];
    }

    scoresKey() {
        return this.profile ? `${Leaderboard.SCORES_KEY}::${this.profile}` : Leaderboard.SCORES_KEY;
    }

    profileSettingsKey(name) {
        return `${Leaderboard.PROFILE_SETTINGS_KEY}::${name}`;
    }

    async migrateLegacyScores() {
        if (!this.profile) return;
        const existing = await this.store.get(this.scoresKey());
        if (existing) return;

        const legacy = await this.store.get(Leaderboard.SCORES_KEY);
        if (!legacy) return;

        await this.store.set(this.scoresKey(), legacy);
        await this.store.delete(Leaderboard.SCORES_KEY);
    }

    async loadProfiles() {
        try {
            const raw = await this.store.get(Leaderboard.PROFILES_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            this.profiles = Array.isArray(parsed) ? parsed : [];
        } catch {
            this.profiles = [];
        }
        return this.profiles;
    }

    async rememberProfile(name) {
        if (!name) return this.profiles;
        const others = this.profiles.filter((n) => n !== name);
        this.profiles = [name, ...others].slice(0, Leaderboard.MAX_PROFILES);
        await this.store.set(Leaderboard.PROFILES_KEY, JSON.stringify(this.profiles));
        return this.profiles;
    }

    async switchProfile(name) {
        this.profile = name;
        await this.setLastName(name);
        if (this.trash.some((entry) => entry.name === name)) {
            this.trash = this.trash.filter((entry) => entry.name !== name);
            await this.store.set(Leaderboard.PROFILE_TRASH_KEY, JSON.stringify(this.trash));
        }
        await this.rememberProfile(name);
        await this.load();
        return this.cache;
    }

    async renameProfile(oldName, newName) {
        const trimmed = (newName || "").trim();
        if (!trimmed || trimmed === oldName) return this.profile;

        if (this.profiles.includes(trimmed)) {
            return this.switchProfile(trimmed);
        }

        const oldScoresKey = oldName ? `${Leaderboard.SCORES_KEY}::${oldName}` : Leaderboard.SCORES_KEY;
        const scores = await this.store.get(oldScoresKey);
        if (scores) {
            await this.store.set(`${Leaderboard.SCORES_KEY}::${trimmed}`, scores);
            await this.store.delete(oldScoresKey);
        }

        const settings = await this.store.get(this.profileSettingsKey(oldName));
        if (settings) {
            await this.store.set(this.profileSettingsKey(trimmed), settings);
            await this.store.delete(this.profileSettingsKey(oldName));
        }

        this.profiles = this.profiles.map((n) => (n === oldName ? trimmed : n));
        await this.store.set(Leaderboard.PROFILES_KEY, JSON.stringify(this.profiles));

        this.profile = trimmed;
        await this.setLastName(trimmed);
        await this.load();
        return trimmed;
    }

    async loadProfileSettings(name) {
        try {
            const raw = await this.store.get(this.profileSettingsKey(name));
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    async saveProfileSettings(name, data) {
        if (!name) return;
        await this.store.set(this.profileSettingsKey(name), JSON.stringify(data));
    }

    async loadTrash() {
        let entries = [];
        try {
            const raw = await this.store.get(Leaderboard.PROFILE_TRASH_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            entries = Array.isArray(parsed) ? parsed : [];
        } catch {
            entries = [];
        }

        const now = Date.now();
        const active = [];
        const expired = [];
        entries.forEach((entry) => {
            if (!entry || typeof entry.name !== "string") return;
            if (now - entry.deletedAt < Leaderboard.PROFILE_TRASH_RETENTION_MS) {
                active.push(entry);
            } else {
                expired.push(entry);
            }
        });

        if (expired.length) {
            await Promise.all(expired.map((entry) => this.purgeProfileData(entry.name)));
            await this.store.set(Leaderboard.PROFILE_TRASH_KEY, JSON.stringify(active));
        }

        this.trash = active;
        return this.trash;
    }

    async purgeProfileData(name) {
        await this.store.delete(`${Leaderboard.SCORES_KEY}::${name}`);
        await this.store.delete(this.profileSettingsKey(name));
    }

    async deleteProfile(name) {
        if (!name) return;

        this.profiles = this.profiles.filter((n) => n !== name);
        await this.store.set(Leaderboard.PROFILES_KEY, JSON.stringify(this.profiles));

        this.trash = [{name, deletedAt: Date.now()}, ...this.trash.filter((entry) => entry.name !== name)];
        await this.store.set(Leaderboard.PROFILE_TRASH_KEY, JSON.stringify(this.trash));

        if (this.profile === name) {
            this.profile = "";
            this.cache = [];
            await this.setLastName("");
        }
    }

    async restoreProfile(name) {
        if (!name) return;
        this.trash = this.trash.filter((entry) => entry.name !== name);
        await this.store.set(Leaderboard.PROFILE_TRASH_KEY, JSON.stringify(this.trash));
        await this.rememberProfile(name);
    }

    isToday(iso) {
        return new Date(iso).toDateString() === new Date().toDateString();
    }

    entryMode(entry) {
        return entry.mode || "marathon";
    }

    isTimedRaceMode(mode) {
        return mode === "sprint" || mode === "cheeseRace";
    }

    compareEntries(a, b, mode) {
        if (this.isTimedRaceMode(mode)) return (a.timeMs ?? Infinity) - (b.timeMs ?? Infinity);
        return b.score - a.score;
    }

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
            const raw = await this.store.get(this.scoresKey());
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
        await this.store.set(this.scoresKey(), JSON.stringify(this.cache));

        return this.forMode(this.entryMode(entry));
    }

    async loadLastName() {
        this.lastNameCache = (await this.store.get(Leaderboard.NAME_KEY)) || "";
        this.profile = this.lastNameCache;
        return this.lastNameCache;
    }

    async setLastName(name) {
        this.lastNameCache = name;
        await this.store.set(Leaderboard.NAME_KEY, name);
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
            row.querySelector('[data-field="time"]').textContent = Number.isFinite(entry.timeMs)
                ? (this.isTimedRaceMode(this.entryMode(entry))
                    ? formatDurationPrecise(entry.timeMs)
                    : formatDuration(entry.timeMs))
                : "—";
            row.querySelector('[data-field="level"]').textContent = entry.level;
            row.querySelector('[data-field="lines"]').textContent = entry.lines;
            row.querySelector('[data-field="date"]').textContent = this.formatDate(entry.date);
            tbody.appendChild(row);
        });

        return table;
    }
}
