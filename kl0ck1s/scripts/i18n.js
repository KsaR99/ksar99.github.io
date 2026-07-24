"use strict";

const LANGUAGES = {
    en: "English",
    pl: "Polski",
    es: "Español",
    de: "Deutsch",
    nl: "Nederlands",
    ru: "Русский",
};
const SUPPORTED_LANGUAGES = Object.keys(LANGUAGES);
const DEFAULT_LANGUAGE = "en";
const STORAGE_KEY = "klockis-lang";
const LOCALE_STORAGE_KEY = "klockis-locale";

export class I18n {
    /**
     * @param {object} [options]
     * @param {string} [options.basePath] - path to the folder containing "<lang>.json" files
     * @param {Storage|null} [options.storage]
     * @param {Navigator|null} [options.navigatorRef]
     * @param {Document|null} [options.documentRef]
     */
    constructor({
                    basePath = "i18n/",
                    storage = (typeof localStorage !== "undefined" ? localStorage : null),
                    navigatorRef = (typeof navigator !== "undefined" ? navigator : null),
                    documentRef = (typeof document !== "undefined" ? document : null),
                } = {}) {
        this.basePath = basePath;
        this.storage = storage;
        this.navigatorRef = navigatorRef;
        this.documentRef = documentRef;
        this.lang = DEFAULT_LANGUAGE;
        this.dict = {};
        this.browserLocale = null;
    }

    /** Prefers the visitor's own regional tag (e.g. "en-GB") when known, otherwise the language's default region. */
    get locale() {
        return this.browserLocale || this.dict.locale || "en-US";
    }

    /** Map of supported language codes to their native display names, e.g. {en: "English", pl: "Polski"}. */
    get languages() {
        return LANGUAGES;
    }

    /** Reads the browser's preferred languages and picks the first supported one, keeping its full regional tag (e.g. "en-GB"). */
    detectBrowserLanguage() {
        const candidates = this.navigatorRef?.languages?.length
            ? this.navigatorRef.languages
            : [this.navigatorRef?.language].filter(Boolean);

        for (const candidate of candidates) {
            const short = candidate.slice(0, 2).toLowerCase();
            if (SUPPORTED_LANGUAGES.includes(short)) return {lang: short, locale: candidate};
        }
        return {lang: DEFAULT_LANGUAGE, locale: null};
    }

    /** Stored preference (with its remembered regional tag) wins; otherwise fall back to browser detection (first run). */
    resolveInitialLanguage() {
        const stored = this.storage?.getItem(STORAGE_KEY);
        if (stored && SUPPORTED_LANGUAGES.includes(stored)) {
            return {lang: stored, locale: this.storage?.getItem(LOCALE_STORAGE_KEY) || null};
        }
        return this.detectBrowserLanguage();
    }

    async loadDictionary(lang) {
        const response = await fetch(`${this.basePath}${lang}.json`);
        if (!response.ok) throw new Error(`Failed to load translations for "${lang}"`);
        return response.json();
    }

    /** Resolves the initial language (stored choice, or browser detection on first run) and loads it. */
    async init() {
        const stored = this.storage?.getItem(STORAGE_KEY);
        const {lang, locale} = this.resolveInitialLanguage();
        await this.setLanguage(lang, {persist: !stored, browserLocale: locale});
        return this;
    }

    /**
     * Loads and activates a language, updating <html lang> and (optionally) localStorage.
     * @param {string} lang
     * @param {object} [opts]
     * @param {boolean} [opts.persist] - whether to remember this choice in localStorage
     * @param {string|null} [opts.browserLocale] - the full regional tag (e.g. "en-GB") this language was
     *   detected from, used for date/number formatting. Omit when the language was chosen manually, so
     *   formatting falls back to the language's default region.
     */
    async setLanguage(lang, {persist = true, browserLocale = null} = {}) {
        const resolved = SUPPORTED_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;

        try {
            this.dict = await this.loadDictionary(resolved);
            this.lang = resolved;
        } catch {
            if (resolved !== DEFAULT_LANGUAGE) {
                this.dict = await this.loadDictionary(DEFAULT_LANGUAGE);
                this.lang = DEFAULT_LANGUAGE;
            }
            return this;
        }

        this.browserLocale = browserLocale;

        if (persist) {
            this.storage?.setItem(STORAGE_KEY, this.lang);
            if (browserLocale) this.storage?.setItem(LOCALE_STORAGE_KEY, browserLocale);
            else this.storage?.removeItem(LOCALE_STORAGE_KEY);
        }
        if (this.documentRef) this.documentRef.documentElement.lang = this.lang;

        return this;
    }

    /**
     * Looks up a dot-path key (e.g. "screens.paused.title") and substitutes {placeholders}.
     * Returns the key itself if nothing is found, so missing translations are easy to spot.
     */
    t(key, vars = {}) {
        const value = key
            .split(".")
            .reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), this.dict);

        if (typeof value !== "string") return key;

        return value.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
    }

    /**
     * Translates every [data-i18n] / [data-i18n-placeholder] element under root.
     * Safe to call repeatedly (e.g. after cloning a <template> or switching language).
     */
    applyStatic(root) {
        if (!root) return;

        root.querySelectorAll?.("[data-i18n]").forEach((el) => {
            el.textContent = this.t(el.dataset.i18n);
        });

        root.querySelectorAll?.("[data-i18n-placeholder]").forEach((el) => {
            el.placeholder = this.t(el.dataset.i18nPlaceholder);
        });

        root.querySelectorAll?.("[data-i18n-title]").forEach((el) => {
            el.title = this.t(el.dataset.i18nTitle);
        });
    }
}
