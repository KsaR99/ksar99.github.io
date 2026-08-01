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
    // Fallback for Game.getFallingSoundRate() if a tier is ever missing its
    // own fallingSoundRate override below - shouldn't happen since every
    // DIFFICULTIES entry defines one, but keeps that lookup safe regardless.
    DEFAULT_FALLING_SOUND_RATE: 0.5,
});

export const SPIN_POINTS = Object.freeze({
    T: [400, 800, 1200, 1600],
    T_MINI: [100, 200, 400],
    OTHER: [100, 200, 400, 600],
});

export const LEVEL_UP_BANNER_DURATION_MS = 420;
export const LINE_CLEAR_ANIMATION_DURATION_MS = 220;

export const DIFFICULTIES = Object.freeze({
    easy: {startLevel: 1, fallingSoundRate: 0.10},
    medium: {startLevel: 10, groundedTime: 2500, fallingSoundRate: 0.20},
    hard: {startLevel: 15, groundedTime: 2000, fallingSoundRate: 0.30},
    expert: {startLevel: 20, groundedTime: 1500, fallingSoundRate: 0.40},
    pro: {startLevel: 30, groundedTime: 1000, fallingSoundRate: 0.50},
});

// Board theme (background + accent border) now lives in main.css, under
// .board[data-theme="..."] - keyed by the same effect names as
// EffectOverlay/options.effect (none/matrix/rain/snow/vhs). Renderer.setTheme()
// just flips the data-theme attribute; see effect-overlay.js for where that's
// called from.

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
        color: "oklch(0.905 0.154 194.7)",
        states: [
            [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
            [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]],
            [[0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0]],
            [[0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0]],
        ],
    },
    J: {
        color: "oklch(0.563 0.240 260.8)",
        states: [
            [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
            [[0, 1, 1], [0, 1, 0], [0, 1, 0]],
            [[0, 0, 0], [1, 1, 1], [0, 0, 1]],
            [[0, 1, 0], [0, 1, 0], [1, 1, 0]],
        ],
    },
    L: {
        color: "oklch(0.772 0.173 64.55)",
        states: [
            [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
            [[0, 1, 0], [0, 1, 0], [0, 1, 1]],
            [[0, 0, 0], [1, 1, 1], [1, 0, 0]],
            [[1, 1, 0], [0, 1, 0], [0, 1, 0]],
        ],
    },
    O: {
        color: "oklch(0.968 0.211 109.7)",
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
        color: "oklch(0.581 0.298 307)",
        states: [
            [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
            [[0, 1, 0], [0, 1, 1], [0, 1, 0]],
            [[0, 0, 0], [1, 1, 1], [0, 1, 0]],
            [[0, 1, 0], [1, 1, 0], [0, 1, 0]],
        ],
    },
    Z: {
        color: "oklch(0.648 0.237 27)",
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

export const CREDITS = Object.freeze([
    Object.freeze({name: "Sa_ymon", link: "https://www.twitch.tv/sa_ymon", roles: ["programmer", "sfx"]}),
    Object.freeze({name: "Danio Dragon", link: "https://www.twitch.tv/danio_dragon", roles: ["tester"]}),
    Object.freeze({name: "Aleksander Żak", link: "https://www.twitch.tv/grubyolson", roles: ["music", "sfx"]}),
]);

export const CREDITS_TIMING = Object.freeze({
    IDLE_DELAY_MS: 20000,
    SCROLL_DURATION_MS: 14000,
    HOLD_DURATION_MS: 10000,
});

export const NEXT_PREVIEW_CELL_SIZE = 22;

// Drives MusicDirector's tension-based track switching (see
// services/music-director.js). tensionFor(board) returns 0..1 based on how
// high the stack is; _tierForTension walks TRACK_KEYS' index up/down as
// tension crosses THRESHOLDS, with HYSTERESIS as a buffer so it doesn't
// flip-flop right at a boundary. TRACK_KEYS[tier] must be a key that exists
// in SOUND_FILES (category "music") below.
export const MUSIC_TENSION = Object.freeze({
    TRACK_KEYS: ["tetrisowyShvt", "tetrisowyShvt2", "tetrisowyShvt3"],
    THRESHOLDS: [0, 0.33, 0.66],
    HYSTERESIS: 0.05,
    FADE_DURATION_MS: 10000,
    STOP_FADE_DURATION_MS: 800,
});

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
    lineClear1: Object.freeze({src: "assets/audio/sounds/line-clear-1.opus", category: "sfx"}),
    lineClear2: Object.freeze({src: "assets/audio/sounds/line-clear-2.opus", category: "sfx"}),
    lineClear3: Object.freeze({src: "assets/audio/sounds/line-clear-3.opus", category: "sfx"}),
    lineClear4: Object.freeze({src: "assets/audio/sounds/line-clear-4.opus", category: "sfx"}),
    // Hard drop's instant slam - see PieceController.hardDrop()/
    // lockCurrentPiece(). A piece that locks naturally instead (grounded/
    // lock-delay timing out) plays "pieceLock" below, never both together.
    drop: Object.freeze({src: "assets/audio/sounds/drop.opus", category: "sfx"}),
    gameOver: Object.freeze({src: "assets/audio/sounds/game-over.opus", category: "sfx"}),
    levelUp: Object.freeze({src: "assets/audio/sounds/level-up.opus", category: "sfx"}),
    rotate: Object.freeze({src: "assets/audio/sounds/rotate.opus", category: "sfx"}),
    // Plays once, the moment the falling piece first touches down and lock
    // delay starts counting - i.e. the ~1.5s window the player still has to
    // slide/rotate it into place before it locks. Named to match the
    // existing `groundedTime`/`MAX_GROUNDED_TIME` fields in SCORING/DIFFICULTIES.
    grounded: Object.freeze({src: "assets/audio/sounds/grounded.opus", category: "sfx"}),
    falling: Object.freeze({src: "assets/audio/sounds/falling.opus", category: "sfx"}),
    // Plays instead of "drop" whenever a piece locks naturally - i.e. the
    // "grounded" cue's window ran out rather than the player hard-dropping
    // it. See PieceController.lockCurrentPiece().
    pieceLock: Object.freeze({src: "assets/audio/sounds/piece-lock.opus", category: "sfx"}),
    // music
    // `label` is what shows up in the options screen's music list (Screens.options ->
    // fillSoundRows in ui/screens.js). Music tracks are proper names, not meant to be
    // translated per-language, so the label is set once right here - unlike the SFX
    // above, which get their (actually-translated) name from sounds.<key> in each
    // assets/i18n/<lang>.json instead. Add a new track by just adding an entry with a
    // label below; no i18n or index.html changes needed.
    tetrisowyShvt: Object.freeze({
        src: "assets/audio/music/tetrisowy-shvt-1.opus",
        category: "music",
        label: "Tetrisowy Shvt I"
    }),
    tetrisowyShvt2: Object.freeze({
        src: "assets/audio/music/tetrisowy-shvt-2.opus",
        category: "music",
        label: "Tetrisowy Shvt II"
    }),
    tetrisowyShvt3: Object.freeze({
        src: "assets/audio/music/tetrisowy-shvt-3.opus",
        category: "music",
        label: "Tetrisowy Shvt III"
    }),
});
