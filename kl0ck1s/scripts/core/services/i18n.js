"use strict";

const LANGUAGES = {
    en: "English",
    pl: "Polski",
    es: "Español",
    de: "Deutsch",
    nl: "Nederlands",
    ru: "Русский",
    cs: "Čeština",
    sk: "Slovenčina",
    it: "Italiano",
    ja: "日本語",
    fr: "Français",
    ko: "한국어",
    id: "Bahasa Indonesia",
    ary: "الدارجة المغربية",
};
const SUPPORTED_LANGUAGES = Object.keys(LANGUAGES);
const DEFAULT_LANGUAGE = "en";
const STORAGE_KEY = "klockis-lang";
const LOCALE_STORAGE_KEY = "klockis-locale";

function deepMergeDicts(base, override) {
    if (typeof override !== "object" || override === null || Array.isArray(override)) {
        return override === undefined ? base : override;
    }
    const result = {...(typeof base === "object" && base !== null ? base : {})};
    for (const key of Object.keys(override)) {
        result[key] = deepMergeDicts(base?.[key], override[key]);
    }
    return result;
}

export class I18n {
    constructor({
                    basePath = "assets/i18n/",
                    storage = globalThis.localStorage ?? null,
                    navigatorRef = globalThis.navigator ?? null,
                    documentRef = globalThis.document ?? null,
                } = {}) {
        this.basePath = basePath;
        this.storage = storage;
        this.navigatorRef = navigatorRef;
        this.documentRef = documentRef;
        this.lang = DEFAULT_LANGUAGE;
        this.dict = {};
        this.browserLocale = null;
        this._referenceDict = null;
    }

    get locale() {
        return this.browserLocale || this.dict.locale || "en-US";
    }

    get languages() {
        return LANGUAGES;
    }

    detectBrowserLanguage() {
        const candidates = this.navigatorRef?.languages?.length
            ? this.navigatorRef.languages
            : [this.navigatorRef?.language].filter(Boolean);

        const sortedCodes = [...SUPPORTED_LANGUAGES].sort((a, b) => b.length - a.length);

        for (const candidate of candidates) {
            const lower = candidate.toLowerCase();

            if (SUPPORTED_LANGUAGES.includes("ary") && /^ar-(ma|eh)\b/.test(lower)) {
                return {lang: "ary", locale: candidate};
            }

            for (const code of sortedCodes) {
                if (lower === code || lower.startsWith(`${code}-`)) {
                    return {lang: code, locale: candidate};
                }
            }
        }
        return {lang: DEFAULT_LANGUAGE, locale: null};
    }

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

    async loadReferenceDictionary() {
        if (!this._referenceDict) {
            this._referenceDict = await this.loadDictionary(DEFAULT_LANGUAGE);
        }
        return this._referenceDict;
    }

    async init() {
        const stored = this.storage?.getItem(STORAGE_KEY);
        const {lang, locale} = this.resolveInitialLanguage();
        await this.setLanguage(lang, {persist: !stored, browserLocale: locale});
        return this;
    }

    async setLanguage(lang, {persist = true, browserLocale = null} = {}) {
        const resolved = SUPPORTED_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;

        try {
            const loaded = await this.loadDictionary(resolved);
            this.dict = resolved === DEFAULT_LANGUAGE
                ? loaded
                : deepMergeDicts(await this.loadReferenceDictionary(), loaded);
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

    t(key, vars = {}) {
        const value = key
            .split(".")
            .reduce((node, part) => node?.[part], this.dict);

        if (typeof value !== "string") return key;

        return value.replace(/\{(\w+)}/g, (match, name) => (name in vars ? String(vars[name]) : match));
    }

    raw(key) {
        return key
            .split(".")
            .reduce((node, part) => node?.[part], this.dict);
    }

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
