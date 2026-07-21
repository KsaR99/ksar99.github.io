"use strict";

export class PersistentStore {
    constructor({
                    storage = (typeof window !== "undefined" ? window.storage : null),
                    fallback = (typeof localStorage !== "undefined" ? localStorage : null),
                } = {}) {
        this.storage = storage;
        this.fallback = fallback;
    }

    get hasStorage() {
        return Boolean(this.storage?.get && this.storage?.set);
    }

    async get(key) {
        if (this.hasStorage) {
            try {
                return (await this.storage.get(key, false))?.value ?? null;
            } catch {
                // to fallback
            }
        }
        return this.fallback ? this.fallback.getItem(key) : null;
    }

    async set(key, value) {
        if (this.hasStorage) {
            try {
                return this.storage.set(key, value, false);
            } catch {
                // to fallback
            }
        }
        this.fallback?.setItem(key, value);
    }
}
