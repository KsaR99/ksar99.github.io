"use strict";

// Signaling travels over the Supabase Realtime broadcast channel, which is
// JSON/UTF-8 already. SDP is text, so it goes across as a plain string —
// no byte framing and no base64 layer to pack it into JSON.

export class SignalCodecError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "SignalCodecError";
        this.code = code;
    }
}

export async function encodeSignal(payload) {
    if (!payload || typeof payload !== "object") {
        throw new SignalCodecError("invalid", "Signal payload is invalid.");
    }

    const {type, sdp} = payload;
    if (typeof type !== "string" || typeof sdp !== "string" || !sdp) {
        throw new SignalCodecError("invalid", "Signal payload must contain type and SDP.");
    }

    return sdp;
}

export async function decodeSignal(code, expectedType = null) {
    const sdp = (code ?? "").trim();
    if (!sdp) {
        throw new SignalCodecError("empty", "Signal code is empty.");
    }

    return {type: expectedType, sdp};
}
