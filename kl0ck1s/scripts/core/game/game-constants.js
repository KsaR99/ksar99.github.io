"use strict";

export const T_FRONT_CORNERS = [
    ["topLeft", "topRight"],
    ["topRight", "bottomRight"],
    ["bottomLeft", "bottomRight"],
    ["topLeft", "bottomLeft"],
];

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
    "1>2": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    "2>3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "3>0": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
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
export const SETTINGS_EXPORT_FILENAME = "klockis-settings.json";
export const APP_NAME = "Kl0ck1's";
export const NICKNAME_PATTERN = /^[a-zA-Z\d_-]{3,16}$/u;

export const COUNTDOWN_STEPS = [
    {number: 3, tint: "red"},
    {number: 2, tint: "yellow"},
    {number: 1, tint: "green"},
];

export const PIECE_CONTROLLABLE_STATES = new Set(["running"]);

export const HUD_UPDATE_INTERVAL_MS = 100;

export const SENSITIVITY_MIN = 0.5;
export const SENSITIVITY_MAX = 2;
export const SENSITIVITY_STEP = 0.05;

export const DAS_MIN = 50;
export const DAS_MAX = 300;
export const DAS_STEP = 5;
export const ARR_MIN = 0;
export const ARR_MAX = 80;
export const ARR_STEP = 2;

export const FALL_TRAIL_SLOW_INTERVAL_MS = 500;
export const FALL_TRAIL_FAST_INTERVAL_MS = 16;
export const FALL_TRAIL_MAX_LENGTH = 10;
export const FALL_TRAIL_MAX_ALPHA = 0.20;
export const HARD_DROP_TRAIL_DURATION_MS = 150;
export const HARD_DROP_TRAIL_ALPHAS = [0.9, 0.75, 0.6, 0.5, 0.25];

export const HARD_DROP_IMPACT_FLASH_DURATION_MS = 220;

export const ZEN_SHIFT_ANIMATION_DURATION_MS = 220;

export const ROTATION_ANIM_ANGLE_180_DEG = 180;
export const ROTATION_ANIM_ANGLE_DEG = 90;
export const ROTATION_ANIM_DURATION_MS = 90;
export const ROTATION_ANIM_180_DURATION_MS = 140;

export function fallTrailLengthForInterval(dropIntervalMs) {
    if (!(dropIntervalMs < FALL_TRAIL_SLOW_INTERVAL_MS)) return 0;

    const span = FALL_TRAIL_SLOW_INTERVAL_MS - FALL_TRAIL_FAST_INTERVAL_MS;
    const t = (FALL_TRAIL_SLOW_INTERVAL_MS - dropIntervalMs) / span;
    const clamped = Math.max(0, Math.min(1, t));

    return Math.round(clamped * FALL_TRAIL_MAX_LENGTH);
}

function buildFallTrailAlphaCache() {
    const cache = [];
    for (let count = 0; count <= FALL_TRAIL_MAX_LENGTH; count++) {
        const alphas = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            alphas[i] = FALL_TRAIL_MAX_ALPHA * (1 - i / count);
        }
        cache.push(alphas);
    }
    return cache;
}

export const FALL_TRAIL_ALPHA_CACHE = buildFallTrailAlphaCache();
export const FALL_TRAIL_FRAME_MS = 1000 / 60;
