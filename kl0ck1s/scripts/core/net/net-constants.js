"use strict";

export const SIGNAL_CODE_VERSION = 2;

export const ICE_GATHERING_TIMEOUT_MS = 8000;

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
});

export const WIRE_VERSION = 1;

export const WIRE_FLAGS = Object.freeze({
    COMPRESSED: 0b0001,
});

export const WIRE_COMPRESSION_MIN_BYTES = 256;
