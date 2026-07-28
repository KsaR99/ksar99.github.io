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
export const NICKNAME_PATTERN = /^[a-zA-Z0-9_-]{3,16}$/;

export const COUNTDOWN_STEPS = [
    {number: 3, tint: "red"},
    {number: 2, tint: "yellow"},
    {number: 1, tint: "green"},
];
