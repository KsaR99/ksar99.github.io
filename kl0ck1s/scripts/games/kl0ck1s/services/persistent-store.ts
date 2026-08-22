// @ts-nocheck
"use strict";

export class PersistentStore {

    storage: {
        get(key: string, raw?: boolean): Promise<{ value?: string } | null>;
        set(key: string, value: string, raw?: boolean): Promise<void>;
    } | null;
    fallback: Storage;

    constructor({
                    storage = globalThis.storage ?? null,
                    fallback = globalThis.localStorage ?? null,
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
                await this.storage.set(key, value, false);
                return;
            } catch {
                // fallback
            }
        }

        this.fallback?.setItem(key, value);
    }

    async delete(key) {
        if (this.hasStorage) {
            try {
                await this.storage.delete(key, false);
                return;
            } catch {
                // fallback
            }
        }

        this.fallback?.removeItem(key);
    }
}
