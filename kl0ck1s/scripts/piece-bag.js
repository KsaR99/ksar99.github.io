"use strict";

export class PieceBag {
    #queue = [];
    #random;

    constructor(types, random = Math.random) {
        this.types = [...types];
        this.#random = random;
    }

    refill() {
        const bag = [...this.types];

        for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(this.#random() * (i + 1));
            [bag[i], bag[j]] = [bag[j], bag[i]];
        }

        this.#queue.push(...bag);
    }

    next() {
        this.#queue.length || this.refill();
        return this.#queue.shift();
    }
}
