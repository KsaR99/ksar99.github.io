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

export const LEVEL_UP_BANNER_DURATION_MS = 470;
export const LINE_CLEAR_ANIMATION_DURATION_MS = 260;

export const DIFFICULTIES = Object.freeze({
    easy: {startLevel: 1},
    medium: {startLevel: 10, groundedTime: 2500},
    hard: {startLevel: 15, groundedTime: 2000},
    expert: {startLevel: 20, groundedTime: 1500},
    pro: {startLevel: 30, groundedTime: 1000},
});

export const BOARD_BACKGROUNDS = Object.freeze({
    easy: "oklch(0.22 0 0)",
    medium: "oklch(0.20 0 0)",
    hard: "oklch(0.15 0 0)",
    expert: "oklch(0.10 0 0)",
    pro: "oklch(0 0 0)",
});

export const DEFAULT_DIFFICULTY = "hard";

/** Packs a 2D 0/1 grid into a single integer bitmask, bit index = r*width + c. */
function packState(rows) {
    const height = rows.length;
    const width = rows[0].length;
    let mask = 0;
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (rows[r][c]) mask |= 1 << (r * width + c);
        }
    }
    return mask;
}

// Human-readable shape definitions. Only used at module-load time to build
// the packed KLOCKOMINOS export below — nothing at runtime touches this.
const KLOCKOMINOS_SOURCE = {
    I: {
        color: "oklch(0.905 0.154 194.7 / 0.9)",
        states: [
            [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
            [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]],
            [[0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0]],
            [[0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0]],
        ],
    },
    J: {
        color: "oklch(0.563 0.240 260.8 / 0.9)",
        states: [
            [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
            [[0, 1, 1], [0, 1, 0], [0, 1, 0]],
            [[0, 0, 0], [1, 1, 1], [0, 0, 1]],
            [[0, 1, 0], [0, 1, 0], [1, 1, 0]],
        ],
    },
    L: {
        color: "oklch(0.772 0.173 64.55 / 0.9)",
        states: [
            [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
            [[0, 1, 0], [0, 1, 0], [0, 1, 1]],
            [[0, 0, 0], [1, 1, 1], [1, 0, 0]],
            [[1, 1, 0], [0, 1, 0], [0, 1, 0]],
        ],
    },
    O: {
        color: "oklch(0.968 0.211 109.7 / 0.9)",
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
        color: "oklch(0.581 0.298 307 / 0.9)",
        states: [
            [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
            [[0, 1, 0], [0, 1, 1], [0, 1, 0]],
            [[0, 0, 0], [1, 1, 1], [0, 1, 0]],
            [[0, 1, 0], [1, 1, 0], [0, 1, 0]],
        ],
    },
    Z: {
        color: "oklch(0.648 0.237 27 / 0.9)",
        states: [
            [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
            [[0, 0, 1], [0, 1, 1], [0, 1, 0]],
            [[0, 0, 0], [1, 1, 0], [0, 1, 1]],
            [[0, 1, 0], [1, 1, 0], [1, 0, 0]],
        ],
    },
};

/**
 * KLOCKOMINOS[type] = { color, colorIndex, width, height, states: [mask×4] }
 * Each `states[i]` is an int; bit (r*width+c) tells if that cell is filled.
 * width/height are constant across a piece's rotations (fixed bounding box),
 * only the mask changes — this is what keeps board.collides/lockPiece simple.
 */
export const KLOCKOMINOS = Object.freeze(
    Object.fromEntries(
        Object.entries(KLOCKOMINOS_SOURCE).map(([type, def], index) => [
            type,
            Object.freeze({
                color: def.color,
                colorIndex: index + 1, // 0 is reserved for "empty" in Board.colors
                width: def.states[0][0].length,
                height: def.states[0].length,
                states: def.states.map(packState),
            }),
        ])
    )
);

export const KLOCKOMINO_TYPES = Object.keys(KLOCKOMINOS);

/** colorIndex -> CSS color; index 0 = empty cell (null). Used by Renderer to draw the locked board. */
export const COLOR_PALETTE = [
    null,
    ...KLOCKOMINO_TYPES.map((type) => KLOCKOMINOS[type].color),
];

export const NEXT_PREVIEW_CELL_SIZE = 22;

// Each sound is tagged with a "category" (sfx/music) - the SoundManager uses
// it to route the sound through the matching volume bus, and the options
// screen uses it to sort the per-sound volume sliders into their section.
// `src` can also be an array of paths - a pool of interchangeable variants
// that SoundManager.play() picks from at random each time a *plain* play()
// call is made (no explicit variant requested).
export const SOUND_FILES = Object.freeze({
    // Deliberately 4 separate keys rather than one "lineClear" sound with 4
    // random variants - which sound plays should depend on how many lines
    // were cleared (single/double/triple/tetris), not be random. See
    // PieceController.lockCurrentPiece(), which picks the key from the
    // actual cleared-line count.
    lineClear1: Object.freeze({src: "assets/audio/sounds/line-clear-1.ogg", category: "sfx"}),
    lineClear2: Object.freeze({src: "assets/audio/sounds/line-clear-2.ogg", category: "sfx"}),
    lineClear3: Object.freeze({src: "assets/audio/sounds/line-clear-3.ogg", category: "sfx"}),
    lineClear4: Object.freeze({src: "assets/audio/sounds/line-clear-4.ogg", category: "sfx"}),
    drop: Object.freeze({src: "assets/audio/sounds/drop.mp3", category: "sfx"}),
    gameOver: Object.freeze({src: "assets/audio/sounds/game-over.ogg", category: "sfx"}),
    levelUp: Object.freeze({src: "assets/audio/sounds/level-up.ogg", category: "sfx"}),
    rotate: Object.freeze({src: "assets/audio/sounds/rotate.ogg", category: "sfx"}),
    // Plays once, the moment the falling piece first touches down and lock
    // delay starts counting - i.e. the ~1.5s window the player still has to
    // slide/rotate it into place before it locks. Named to match the
    // existing `groundedTime`/`MAX_GROUNDED_TIME` fields in SCORING/DIFFICULTIES.
    grounded: Object.freeze({src: "assets/audio/sounds/grounded.ogg", category: "sfx"}),
    // No music tracks ship yet (assets/audio/music/ is empty) - once one is
    // added here with category: "music", it'll automatically get its own
    // slider under the options screen's "Music" section.
});
