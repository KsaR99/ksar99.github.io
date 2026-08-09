"use strict";

// Bumped whenever the signaling payload shape changes, so an old code pasted
// into a newer build fails fast with a clear "version-mismatch" error
// instead of a confusing low-level WebRTC failure.
export const SIGNAL_CODE_VERSION = 1;

// How long to wait for ICE gathering to reach "complete" before falling back
// to whatever candidates were found so far. Manual (non-trickle) signaling
// needs a finished SDP before it can be turned into a shareable code.
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

// App-level message envelope types sent over the data channel, layered on
// top of raw WebRTC so the game code never has to touch SDP/ICE directly.
export const PROTOCOL_MESSAGE_TYPE = Object.freeze({
    READY: "ready",
    UNREADY: "unready",
    START: "start",
    DATA: "data",
});
