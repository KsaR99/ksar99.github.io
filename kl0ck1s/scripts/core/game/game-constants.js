"use strict";

/** Which board corners count as the "front" of a T piece for each rotation state, used for T-spin detection. */
export const T_FRONT_CORNERS = [
    ["topLeft", "topRight"],
    ["topRight", "bottomRight"],
    ["bottomLeft", "bottomRight"],
    ["topLeft", "bottomLeft"],
];

/**
 * Derives the reverse-rotation (counterclockwise) kicks from a table of
 * forward (clockwise) kicks. The kick that undoes a "from>to" rotation is the
 * exact inverse translation of the kick that performed it, so "to>from" is
 * just "from>to" with each offset negated. This lets the source tables below
 * only list the four clockwise transitions while still supporting rotate(-1).
 */
function invertKicks(kicks) {
    return kicks.map(([dx, dy]) => [-dx, -dy]);
}

function withReverse(cwTable) {
    const withBoth = {...cwTable};
    for (const [key, offsets] of Object.entries(cwTable)) {
        const [from, to] = key.split(">");
        withBoth[`${to}>${from}`] = invertKicks(offsets);
    }
    return withBoth;
}

export const JLSTZ_KICKS = withReverse({
    "0>1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "1>2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "2>3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "3>0": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
});

export const I_KICKS = withReverse({
    "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
});

export const O_KICKS = withReverse({
    "0>1": [[0, 0]],
    "1>2": [[0, 0]],
    "2>3": [[0, 0]],
    "3>0": [[0, 0]],
});

export function getKickTable(type) {
    if (type === "I") return I_KICKS;
    if (type === "O") return O_KICKS;

    return JLSTZ_KICKS;
}

export const SETTINGS_KEY = "klockis-settings";
export const APP_NAME = "Kl0ck1's";
export const NICKNAME_PATTERN = /^[a-zA-Z\d_-]{3,16}$/u;

export const COUNTDOWN_STEPS = [
    {number: 3, tint: "red"},
    {number: 2, tint: "yellow"},
    {number: 1, tint: "green"},
];

/**
 * Falling-piece motion trail ("echo"). Purely a visual smoothing aid for
 * fast drops, where the interval between rows gets short enough that the
 * piece's whole-cell y-steps become visible as stutter. The trail only ever
 * reflects vertical motion (see Game.updateFallTrail) - horizontal movement
 * never lengthens or offsets it.
 *
 * Deliberately keyed off the *actual* drop interval (ms/row) rather than the
 * level number: level only sets the gravity baseline, but soft-drop (holding
 * "down") can make even level 1 fall just as fast as a high level normally
 * would. Scaling off dropInterval means both cases - a high level, or a low
 * level with soft-drop held - get the same trail once they reach the same
 * real speed.
 *
 * - FALL_TRAIL_SLOW_INTERVAL_MS: dropInterval at/above this is already slow
 *   enough to look smooth - trail is fully off.
 * - FALL_TRAIL_FAST_INTERVAL_MS: dropInterval at/below this gets the full,
 *   max-length trail. Between the two thresholds the length scales linearly.
 * - FALL_TRAIL_MAX_LENGTH: hard cap on how many echo frames are kept/drawn.
 * - FALL_TRAIL_MAX_ALPHA: opacity of the closest (freshest) echo frame; each
 *   older frame fades linearly toward 0.
 */
export const FALL_TRAIL_SLOW_INTERVAL_MS = 500;
export const FALL_TRAIL_FAST_INTERVAL_MS = 40;
export const FALL_TRAIL_MAX_LENGTH = 15;
export const FALL_TRAIL_MAX_ALPHA = 0.15;

/** How many trail snapshots should be kept/drawn for a given current drop interval (ms/row). */
export function fallTrailLengthForInterval(dropIntervalMs) {
    if (!(dropIntervalMs < FALL_TRAIL_SLOW_INTERVAL_MS)) return 0;

    const span = FALL_TRAIL_SLOW_INTERVAL_MS - FALL_TRAIL_FAST_INTERVAL_MS;
    const t = (FALL_TRAIL_SLOW_INTERVAL_MS - dropIntervalMs) / span;
    const clamped = Math.max(0, Math.min(1, t));

    return Math.round(clamped * FALL_TRAIL_MAX_LENGTH);
}
