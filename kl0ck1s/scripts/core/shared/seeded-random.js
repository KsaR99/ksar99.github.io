"use strict";

/**
 * Deterministic, fast PRNG (mulberry32). Given the same seed it always
 * produces the same sequence of [0, 1) floats - used so a bot match can
 * hand the player and the bot two independently-advancing PieceBags that
 * still draw pieces in the exact same order, the way a fair local 1v1
 * would.
 *
 * @param {number} seed - any 32-bit integer.
 * @returns {() => number} a function with the same shape as Math.random.
 */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A fresh random 32-bit seed, suitable for handing to mulberry32(). */
export function randomSeed() {
    return (Math.random() * 0xffffffff) >>> 0;
}
