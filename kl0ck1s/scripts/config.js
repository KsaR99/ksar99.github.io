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
});

export const LEVEL_UP_BANNER_DURATION = 500; // ms
export const LINE_CLEAR_ANIMATION_DURATION = 280; // ms

export const DIFFICULTIES = Object.freeze({
    easy: {label: "Easy", startLevel: 1},
    medium: {label: "Medium", startLevel: 5},
    hard: {label: "Hard", startLevel: 10},
});

export const BOARD_BACKGROUNDS = Object.freeze({
    easy: "hsl(90 100% 10%)",
    medium: "hsl(50 100% 10%)",
    hard: "hsl(0 100% 10%)",
});

export const DEFAULT_DIFFICULTY = "easy";

export const KLOCKOMINOS = Object.freeze({
    I: {color: "hsl(180 100% 50%)", shape: [[1, 1, 1, 1]]},
    J: {color: "hsl(216 100% 50%)", shape: [[1, 0, 0], [1, 1, 1]]},
    L: {color: "hsl(36 100% 50%)", shape: [[0, 0, 1], [1, 1, 1]]},
    O: {color: "hsl(60 100% 50%)", shape: [[1, 1], [1, 1]]},
    S: {color: "hsl(140 100% 40%)", shape: [[0, 1, 1], [1, 1, 0]]},
    T: {color: "hsl(280 100% 50%)", shape: [[0, 1, 0], [1, 1, 1]]},
    Z: {color: "hsl(0 100% 60%)", shape: [[1, 1, 0], [0, 1, 1]]},
});

export const KLOCKOMINO_TYPES = Object.keys(KLOCKOMINOS);

export const NEXT_PREVIEW_CELL_SIZE = 22;

export const SOUND_FILES = Object.freeze({
    lineClear: "sounds/line-clear.ogg",
    drop: "sounds/drop.mp3",
    gameOver: "sounds/game-over.ogg",
    levelUp: "sounds/level-up.ogg",
});
