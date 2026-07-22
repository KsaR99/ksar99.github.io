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

export const LEVEL_UP_BANNER_DURATION = 500; // ms
export const LINE_CLEAR_ANIMATION_DURATION = 280; // ms

export const DIFFICULTIES = Object.freeze({
    easy: {label: "Easy", startLevel: 1},
    medium: {label: "Medium", startLevel: 5},
    hard: {label: "Hard", startLevel: 10},
});

export const BOARD_BACKGROUNDS = Object.freeze({
    easy: "hsl(0 0 5%)",
    medium: "hsl(0 0 10%)",
    hard: "hsl(0 0 15%)",
});

export const DEFAULT_DIFFICULTY = "easy";

export const KLOCKOMINOS = Object.freeze({
    I: {
        color: "hsl(180 100% 50%)",
        states: [
            [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
            [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]],
            [[0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0]],
            [[0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0]],
        ],
    },
    J: {
        color: "hsl(216 100% 50%)",
        states: [
            [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
            [[0, 1, 1], [0, 1, 0], [0, 1, 0]],
            [[0, 0, 0], [1, 1, 1], [0, 0, 1]],
            [[0, 1, 0], [0, 1, 0], [1, 1, 0]],
        ],
    },
    L: {
        color: "hsl(36 100% 50%)",
        states: [
            [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
            [[0, 1, 0], [0, 1, 0], [0, 1, 1]],
            [[0, 0, 0], [1, 1, 1], [1, 0, 0]],
            [[1, 1, 0], [0, 1, 0], [0, 1, 0]],
        ],
    },
    O: {
        color: "hsl(60 100% 50%)",
        states: [
            [[1, 1], [1, 1]],
            [[1, 1], [1, 1]],
            [[1, 1], [1, 1]],
            [[1, 1], [1, 1]],
        ],
    },
    S: {
        color: "hsl(140 100% 40%)",
        states: [
            [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
            [[0, 1, 0], [0, 1, 1], [0, 0, 1]],
            [[0, 0, 0], [0, 1, 1], [1, 1, 0]],
            [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
        ],
    },
    T: {
        color: "hsl(280 100% 50%)",
        states: [
            [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
            [[0, 1, 0], [0, 1, 1], [0, 1, 0]],
            [[0, 0, 0], [1, 1, 1], [0, 1, 0]],
            [[0, 1, 0], [1, 1, 0], [0, 1, 0]],
        ],
    },
    Z: {
        color: "hsl(0 100% 60%)",
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
