export const SCORE_POLL_MS = 200;
export const REMOTE_PIECE_LERP_MIN_MS = 16;
export const REMOTE_PIECE_LERP_MAX_MS = 1600;
export const RUNNING_STATES = new Set(["countdown", "running", "clearing", "paused", "options"]);
export const FINISHED_STATES = new Set(["gameOver-entry"]);
export const BOT_DIFFICULTY_ORDER = ["easy", "medium", "hard"] as const;
export const MAX_NEGOTIATION_AUTO_RETRIES = 2;
export const NEGOTIATION_RETRY_DELAY_MS = 600;
export const STEP_BY_PANEL = {
    role: {step: 1, labelKey: "multiplayer.step1Label"},
    host: {step: 2, labelKey: "multiplayer.step2Label"},
    join: {step: 2, labelKey: "multiplayer.step2Label"},
    ready: {step: 3, labelKey: "multiplayer.step3Label"},
} as const;
export const PANEL_KEY_CONFIG = {
    role: {
        groups: [
            {prev: null, next: null, focus: "mp-host-button"},
            {prev: null, next: null, focus: "mp-join-button"},
            {prev: null, next: null, focus: "mp-bot-button"},
        ],
        primary: ["mp-host-button", "mp-join-button", "mp-bot-button"],
    },
    bot: {
        groups: [
            {prev: "mp-bot-mode-prev", next: "mp-bot-mode-next", focus: "mp-bot-mode-select"},
            {prev: "mp-bot-level-prev", next: "mp-bot-level-next", focus: "mp-bot-level-select"},
        ],
        primary: ["mp-bot-difficulty-start"],
    },
    ready: {
        groups: [
            {prev: "mp-ready-mode-prev", next: "mp-ready-mode-next", focus: "mp-ready-mode-select"},
            {prev: "mp-ready-difficulty-prev", next: "mp-ready-difficulty-next", focus: "mp-ready-difficulty-select"},
        ],
        primary: ["mp-start-button", "mp-ready-button"],
    },
} as const;

import {formatNumber} from "../../shared/utils.js";

export const RESULT_STAT_ROWS = [
    {role: "lines", raw: (s: { lines?: number }) => s.lines ?? 0, display: (raw: number) => String(raw)},
    {
        role: "trt",
        raw: (s: { tetrisRatePercent?: number }) => s.tetrisRatePercent ?? 0,
        display: (raw: number) => `${raw.toFixed(1)}%`
    },
    {role: "pps", raw: (s: { pps?: number }) => s.pps ?? 0, display: (raw: number) => raw.toFixed(2)},
    {
        role: "efficiency",
        raw: (s: { efficiency?: number }) => s.efficiency ?? 0,
        display: (raw: number) => formatNumber(Math.round(raw))
    },
    {role: "combo", raw: (s: { maxCombo?: number }) => s.maxCombo ?? 0, display: (raw: number) => String(raw)},
    {
        role: "burn",
        raw: (s: { burn?: number }) => s.burn ?? 0,
        display: (raw: number) => String(raw),
        lowerBetter: true
    },
    {
        role: "drought-max",
        raw: (s: { maxDrought?: number }) => s.maxDrought ?? 0,
        display: (raw: number) => String(raw),
        lowerBetter: true
    },
    {
        role: "drought-total",
        raw: (s: { droughtTotal?: number }) => s.droughtTotal ?? 0,
        display: (raw: number) => String(raw),
        lowerBetter: true
    },
    {
        role: "drought-avg",
        raw: (s: { droughtAvg?: number }) => s.droughtAvg ?? 0,
        display: (raw: number) => raw.toFixed(1),
        lowerBetter: true
    },
] as const;
