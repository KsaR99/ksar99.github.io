"use strict";

export const DEV_MODE = false;

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
    GUIDELINE_DROP_BASE: 0.8,
    GUIDELINE_DROP_STEP: 0.007,
    MIN_DROP_INTERVAL: 16.67,
    LOCK_DELAY: 500,
    LOCK_DELAY_MAX_RESETS: 15,
    MAX_GROUNDED_TIME: 3000,
    DEFAULT_FALLING_SOUND_RATE: 0.5,
    CASCADE_CHAIN_BONUS: 50,
});

export const SPIN_POINTS = Object.freeze({
    T: [400, 800, 1200, 1600],
    T_MINI: [100, 200, 400],
    OTHER: [100, 200, 400, 600],
});

export const LEVEL_UP_BANNER_DURATION_MS = 350;
export const COMBO_BANNER_DURATION_MS = 400;
export const LINE_CLEAR_ANIMATION_DURATION_MS = 260;
export const LINE_CLEAR_SOUND_PLAYBACK_RATE = 0.6;
export const LINE_CLEAR_FLASH_PHASE_FRACTION = 0.75;

export const DIFFICULTIES = Object.freeze({
    easy: {startLevel: 1, fallingSoundRate: 0.40}, // ~1000ms/row
    medium: {startLevel: 5, groundedTime: 2500, fallingSoundRate: 0.50}, // ~355ms/row
    hard: {startLevel: 9, groundedTime: 2000, fallingSoundRate: 0.60}, // ~94ms/row
    expert: {startLevel: 13, groundedTime: 1500, fallingSoundRate: 0.70}, // ~18ms/row, just above the floor
    pro: {startLevel: 19, groundedTime: 1000, fallingSoundRate: 0.8}, // floored: instant drop (20G) from the start
});

export const DEFAULT_DIFFICULTY = "medium";

export const GAME_MODES = Object.freeze({
    zen: Object.freeze({
        sprintTarget: null,
        timeLimitMs: null,
        garbage: false,
        freezeLevel: true,
        noLevelBar: true,
        noLeaderboard: true,
        zenOverflow: true,
        zenOverflowThresholdRow: 4,
        zenOverflowShiftRows: 2,
        zenOverflowMaxRows: Infinity,
        zenGiveBackMaxRows: 10000,
    }),
    marathon: Object.freeze({sprintTarget: null, timeLimitMs: null, garbage: false}),
    sprint: Object.freeze({sprintTarget: 40, timeLimitMs: null, garbage: false}),
    ultra: Object.freeze({sprintTarget: null, timeLimitMs: 180000, garbage: false}),
    survival: Object.freeze({
        sprintTarget: null, timeLimitMs: null, garbage: true,
        garbageIntervalMs: 20000, garbageLinesMin: 1, garbageLinesMax: 2,
    }),
    cheeseRace: Object.freeze({
        sprintTarget: null, timeLimitMs: null, garbage: false, cheeseRows: 10, noLevelBar: true,
    }),
    digSurvival: Object.freeze({
        sprintTarget: null, timeLimitMs: null, garbage: false, cheeseRows: 4, digTarget: 100,
    }),
    countdown: Object.freeze({
        sprintTarget: null, timeLimitMs: null, garbage: false,
        countdownStartMs: 60000, countdownBonusMs: [3000, 3000, 5000, 8000],
    }),
    cascade: Object.freeze({
        sprintTarget: null, timeLimitMs: null, garbage: false, cascadeGravity: true,
    }),
    random: Object.freeze({sprintTarget: null, timeLimitMs: null, garbage: false, isRandom: true}),
});

export const DEFAULT_MODE = "zen";

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

export const KLOCKOMINOS = Object.freeze(
    Object.fromEntries(
        Object.entries(KLOCKOMINOS_SOURCE).map(([type, def], index) => [
            type,
            Object.freeze({
                color: def.color,
                colorIndex: index + 1,
                width: def.states[0][0].length,
                height: def.states[0].length,
                states: def.states.map(packState),
            }),
        ])
    )
);

export const KLOCKOMINO_TYPES = Object.keys(KLOCKOMINOS);

export const COLOR_PALETTE = [
    null,
    ...KLOCKOMINO_TYPES.map((type) => KLOCKOMINOS[type].color),
];

export const GARBAGE_COLOR_INDEX = COLOR_PALETTE.length;
COLOR_PALETTE.push("oklch(0.818 0.167 93.98)");

export const CREDITS = Object.freeze([
    Object.freeze({name: "Sa_ymon", link: "https://www.twitch.tv/sa_ymon", roles: ["developer", "tester", "sfx"]}),
    Object.freeze({name: "Danio_Dragon", link: "https://www.twitch.tv/danio_dragon", roles: ["tester"]}),
    Object.freeze({name: "Aleksander Żak", link: "https://www.twitch.tv/grubyolson", roles: ["music", "sfx"]}),
]);

export const CREDITS_TIMING = Object.freeze({
    ENTER_DURATION_MS: 900,
    EXIT_DURATION_MS: 500,
});

export const NEXT_PREVIEW_QUEUE_SIZE = 3;
export const NEXT_PREVIEW_CELL_SIZE = 27;
export const NEXT_PREVIEW_CANVAS_WIDTH = NEXT_PREVIEW_CELL_SIZE * 4; // widest piece
export const NEXT_PREVIEW_CANVAS_HEIGHT = NEXT_PREVIEW_CELL_SIZE * 2; // tallest piece

export const MUSIC_TENSION = Object.freeze({
    TRACK_KEYS: ["tetrisowyShvt", "tetrisowyShvt2", "tetrisowyShvt3"],
    THRESHOLDS: [0, 0.33, 0.66],
    HYSTERESIS: 0.05,
    FADE_DURATION_MS: 10000,
    STOP_FADE_DURATION_MS: 800,
    PITCH_STEP_SEMITONES: 0.1,
    PITCH_MAX_SEMITONES: 1.5,
    PITCH_STEP_INTERVAL_MS: 300,
    PITCH_RETURN_MS: 7000,
});

export const VOICE_COUNTING_NUMBERS = Object.freeze([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    20, 30, 40, 50, 60, 70, 80, 90, 100,
]);

export function voiceCountingKey(number) {
    return `voiceCount${number}`;
}

export function voiceOrdinalKey(number) {
    return `voiceOrdinal${number}`;
}

const VOICE_COUNTING_PL_OVERRIDES = Object.freeze({
    1: "assets/audio/voices/pl/counting/1.opus",
    2: "assets/audio/voices/pl/counting/2.opus",
    3: "assets/audio/voices/pl/counting/3.opus",
    100: "assets/audio/voices/pl/counting/100.opus",
});

const VOICE_COUNTING_SOUND_FILES = Object.fromEntries(
    VOICE_COUNTING_NUMBERS.map((number) => {
        const en = `assets/audio/voices/counting/${number}.opus`;
        const pl = VOICE_COUNTING_PL_OVERRIDES[number];
        return [
            voiceCountingKey(number),
            Object.freeze({src: pl ? Object.freeze({en, pl}) : en, category: "voices", label: String(number)}),
        ];
    })
);

const VOICE_ORDINAL_SOUND_FILES = Object.fromEntries(
    VOICE_COUNTING_NUMBERS.map((number) => [
        voiceOrdinalKey(number),
        Object.freeze({
            src: `assets/audio/voices/pl/ordinal/${number}.opus`,
            category: "voices",
            label: `${number}.`,
        }),
    ])
);

export const VOICE_COUNTING_KEYS_ALL = Object.freeze(VOICE_COUNTING_NUMBERS.map(voiceCountingKey));
export const VOICE_ORDINAL_KEYS_ALL = Object.freeze(VOICE_COUNTING_NUMBERS.map(voiceOrdinalKey));

const VOICE_NUMBER_KEYS_PL = Object.freeze([
    voiceCountingKey(1), voiceCountingKey(2), voiceCountingKey(3), voiceCountingKey(100),
    ...VOICE_ORDINAL_KEYS_ALL,
]);

export function voiceNumberKeysForLang(lang) {
    return lang === "pl" ? VOICE_NUMBER_KEYS_PL : VOICE_COUNTING_KEYS_ALL;
}

export const SOUND_FILES = Object.freeze({
    // sounds / sfx
    lineClear1: Object.freeze({src: "assets/audio/sounds/line-clear-1.opus", category: "sfx"}),
    lineClear2: Object.freeze({src: "assets/audio/sounds/line-clear-2.opus", category: "sfx"}),
    lineClear3: Object.freeze({src: "assets/audio/sounds/line-clear-3.opus", category: "sfx"}),
    lineClear4: Object.freeze({src: "assets/audio/sounds/line-clear-4.opus", category: "sfx"}),
    drop: Object.freeze({src: "assets/audio/sounds/drop.opus", category: "sfx"}),
    gameOver: Object.freeze({src: "assets/audio/sounds/game-over.opus", category: "sfx"}),
    levelUp: Object.freeze({src: "assets/audio/sounds/level-up.opus", category: "sfx"}),
    rotate: Object.freeze({src: "assets/audio/sounds/rotate.opus", category: "sfx"}),
    grounded: Object.freeze({src: "assets/audio/sounds/grounded.opus", category: "sfx"}),
    falling: Object.freeze({src: "assets/audio/sounds/falling.opus", category: "sfx"}),
    pieceLock: Object.freeze({src: "assets/audio/sounds/piece-lock.opus", category: "sfx"}),
    // voices
    voiceGameOver: Object.freeze({
        src: Object.freeze({en: "assets/audio/voices/game-over.opus", pl: "assets/audio/voices/pl/game-over.opus"}),
        category: "voices",
        label: "Game over",
    }),
    voiceLetsGo: Object.freeze({
        src: Object.freeze({en: "assets/audio/voices/lets-go.opus", pl: "assets/audio/voices/pl/lets-go.opus"}),
        category: "voices",
        label: "Let's go",
    }),
    voiceLevel: Object.freeze({
        src: Object.freeze({en: "assets/audio/voices/level.opus", pl: "assets/audio/voices/pl/level.opus"}),
        category: "voices",
        label: "Level",
    }),
    ...VOICE_COUNTING_SOUND_FILES,
    ...VOICE_ORDINAL_SOUND_FILES,
    // music
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
