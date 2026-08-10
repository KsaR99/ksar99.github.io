"use strict";

export const SIGNAL_CODE_VERSION = 1;

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
    READY: "ready",
    UNREADY: "unready",
    START: "start",
    DATA: "data",
});
