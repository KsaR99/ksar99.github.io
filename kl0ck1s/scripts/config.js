"use strict";

export const BOARD_CONFIG = {
    COLS: 10,
    ROWS: 20,
    MIN_CELL_SIZE: 14,
    MAX_CELL_SIZE: Infinity,
};

export const SCORING = Object.freeze({
    LINES_PER_LEVEL: 10,
    POINTS_PER_LINES: [0, 100, 300, 500, 800],
    SOFT_DROP_POINT: 1,
    HARD_DROP_POINT: 2,
    BASE_DROP_INTERVAL: 1000,
    MIN_DROP_INTERVAL: 100,
    DROP_INTERVAL_STEP: 75,
    LOCK_DELAY: 500,
    LOCK_DELAY_MAX_RESETS: 15,
    MAX_GROUNDED_TIME: 3000,
});

export const SPIN_POINTS = Object.freeze({
    T: [400, 800, 1200, 1600],
    T_MINI: [100, 200, 400],
    OTHER: [100, 200, 400, 600],
});

export const LEVEL_UP_BANNER_DURATION_MS = 750;
export const LINE_CLEAR_ANIMATION_DURATION_MS = 260;

export const DIFFICULTIES = Object.freeze({
    easy: {label: "Easy", startLevel: 1},
    medium: {label: "Medium", startLevel: 5},
    hard: {label: "Hard", startLevel: 10},
    expert: {label: "Expert", startLevel: 20},
    pro: {label: "PRO", startLevel: 30},
});

export const BOARD_BACKGROUNDS = Object.freeze({
    easy: "oklch(0.25 0 0)",
    medium: "oklch(0.20 0 0)",
    hard: "oklch(0.15 0 0)",
    expert: "oklch(0.10 0 0)",
    pro: "oklch(0 0 0)",
});

export const DEFAULT_DIFFICULTY = "hard";

export const KLOCKOMINOS = Object.freeze({
    I: {
        color: "oklch(0.905399 0.15455 194.76)",
        states: [
            [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
            [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]],
            [[0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0]],
            [[0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0]],
        ],
    },
    J: {
        color: "oklch(0.5635 0.2408 260.82)",
        states: [
            [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
            [[0, 1, 1], [0, 1, 0], [0, 1, 0]],
            [[0, 0, 0], [1, 1, 1], [0, 0, 1]],
            [[0, 1, 0], [0, 1, 0], [1, 1, 0]],
        ],
    },
    L: {
        color: "oklch(0.772 0.1738 64.55)",
        states: [
            [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
            [[0, 1, 0], [0, 1, 0], [0, 1, 1]],
            [[0, 0, 0], [1, 1, 1], [1, 0, 0]],
            [[1, 1, 0], [0, 1, 0], [0, 1, 0]],
        ],
    },
    O: {
        color: "oklch(0.968 0.211 109.77)",
        states: [
            [[1, 1], [1, 1]],
            [[1, 1], [1, 1]],
            [[1, 1], [1, 1]],
            [[1, 1], [1, 1]],
        ],
    },
    S: {
        color: "oklch(0.73558 0.22389 146.13)",
        states: [
            [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
            [[0, 1, 0], [0, 1, 1], [0, 0, 1]],
            [[0, 0, 0], [0, 1, 1], [1, 1, 0]],
            [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
        ],
    },
    T: {
        color: "oklch(0.5812 0.2986 307.03)",
        states: [
            [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
            [[0, 1, 0], [0, 1, 1], [0, 1, 0]],
            [[0, 0, 0], [1, 1, 1], [0, 1, 0]],
            [[0, 1, 0], [1, 1, 0], [0, 1, 0]],
        ],
    },
    Z: {
        color: "oklch(0.6489 0.237 26.97)",
        states: [
            [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
            [[0, 0, 1], [0, 1, 1], [0, 1, 0]],
            [[0, 0, 0], [1, 1, 0], [0, 1, 1]],
            [[0, 1, 0], [1, 1, 0], [1, 0, 0]],
        ],
    },
});

export const KLOCKOMINO_TYPES = Object.keys(KLOCKOMINOS);

export const NEXT_PREVIEW_CELL_SIZE = 22;

export const SOUND_FILES = Object.freeze({
    lineClear: "sounds/line-clear.mp3",
    drop: "sounds/drop.mp3",
    gameOver: "sounds/game-over.ogg",
    levelUp: "sounds/level-up.ogg",
});
