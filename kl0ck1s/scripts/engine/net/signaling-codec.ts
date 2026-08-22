// @ts-nocheck
"use strict";

export class SignalCodecError extends Error {

    name: "SignalCodecError";
    code: string;

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
    let sdp = (code ?? "").trim();
    if (!sdp) {
        throw new SignalCodecError("empty", "Signal code is empty.");
    }
    if (!sdp.endsWith("\r\n")) {
        sdp += "\r\n";
    }

    return {type: expectedType, sdp};
}
