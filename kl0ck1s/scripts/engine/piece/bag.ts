"use strict";

export class PieceBag<T extends string = string> {
    readonly types: T[];
    #random: () => number;
    #queue: T[] = [];

    constructor(types: readonly T[], random: () => number = Math.random) {
        this.types = [...types];
        this.#random = random;
    }

    refill(): void {
        const bag = [...this.types];
        for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(this.#random() * (i + 1));
            [bag[i], bag[j]] = [bag[j], bag[i]];
        }
        this.#queue.push(...bag);
    }

    next(): T | undefined {
        if (!this.#queue.length) this.refill();
        return this.#queue.shift();
    }

    peek(count: number): T[] {
        while (this.#queue.length < count) this.refill();
        return this.#queue.slice(0, count);
    }

    reset(): void {
        this.#queue.length = 0;
    }
}
