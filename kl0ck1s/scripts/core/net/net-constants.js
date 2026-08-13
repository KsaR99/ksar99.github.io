"use strict";

export const ICE_CONNECT_TIMEOUT_MS = 25000;

export const DATA_CHANNEL_LABEL = "kl0ck1s-mp";
export const DATA_CHANNEL_OPTIONS = Object.freeze({ordered: true});

export const PEER_ROLE = Object.freeze({
    HOST: "host",
    GUEST: "guest",
});

export const CONNECTION_STATE = Object.freeze({
    IDLE: "idle",
    GATHERING: "gathering",
    AWAITING_ANSWER: "awaiting-answer",
    CONNECTING: "connecting",
    CONNECTED: "connected",
    DISCONNECTED: "disconnected",
    FAILED: "failed",
    CLOSED: "closed",
});

export const PROTOCOL_MESSAGE_TYPE = Object.freeze({
    READY: 0b0001,
    UNREADY: 0b0010,
    START: 0b0100,
    DATA: 0b1000,
});

export const MESSAGE_KIND = Object.freeze({
    STATS: 0b00000001,
    FINAL: 0b00000010,
    CONFIG: 0b00000100,
    NAME: 0b00001000,
    BOARD: 0b00010000,
    PIECE: 0b00100000,
    HARD_DROP_TRAIL: 0b01000000,
    CLEARING: 0b10000000,
    THEME: 0b100000000,
});

export const WIRE_VERSION = 1;

export const WIRE_FLAGS = Object.freeze({
    COMPRESSED: 0b0001,
});

export const WIRE_COMPRESSION_MIN_BYTES = 256;

// Board cell diffs are packed as a single int: (cellIndex << CELL_INDEX_SHIFT) | colorIndex.
export const CELL_INDEX_SHIFT = 4;
export const CELL_COLOR_MASK = 0b1111;

// Piece position updates are sent as plain {x, y} numbers (y may be fractional,
// carrying the same smooth in-between value the local renderer uses for the
// single-player fall/shift animation) so the peer can interpolate continuously
// instead of snapping once per grid row/column.
