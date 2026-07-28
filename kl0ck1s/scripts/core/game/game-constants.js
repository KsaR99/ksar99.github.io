"use strict";

/** Which board corners count as the "front" of a T piece for each rotation state, used for T-spin detection. */
export const T_FRONT_CORNERS = [
    ["topLeft", "topRight"],
    ["topRight", "bottomRight"],
    ["bottomLeft", "bottomRight"],
    ["topLeft", "bottomLeft"],
];

export const JLSTZ_KICKS = {
    "0>1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "1>2": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    "2>3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "3>0": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
};

export const I_KICKS = {
    "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
};

export const O_KICKS = {
    "0>1": [[0, 0]],
    "1>2": [[0, 0]],
    "2>3": [[0, 0]],
    "3>0": [[0, 0]],
};

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
