"use strict";

import {SIGNAL_CODE_VERSION} from "./net-constants.js";

export class SignalCodecError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "SignalCodecError";
        this.code = code;
    }
}

export function encodeSignal(payload) {
    const json = JSON.stringify({v: SIGNAL_CODE_VERSION, ...payload});
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

/**
 * Decodes a base64 signaling code back into its payload.
 * @param {string} code
 * @param {string|null} [expectedType] - if provided, throws a "type-mismatch" error unless payload.type matches.
 * @returns {{v: number, type: string, sdp: string}}
 */
export function decodeSignal(code, expectedType = null) {
    const trimmed = (code ?? "").trim();
    if (!trimmed) {
        throw new SignalCodecError("empty", "Signal code is empty.");
    }

    let payload;
    try {
        const binary = atob(trimmed);
        const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
        const json = new TextDecoder().decode(bytes);
        payload = JSON.parse(json);
    } catch {
        throw new SignalCodecError("malformed", "Signal code could not be decoded.");
    }

    if (!payload || typeof payload !== "object") {
        throw new SignalCodecError("malformed", "Signal code did not decode to an object.");
    }

    if (payload.v !== SIGNAL_CODE_VERSION) {
        throw new SignalCodecError("version-mismatch", `Unsupported signal code version: ${payload.v}.`);
    }

    if (expectedType && payload.type !== expectedType) {
        throw new SignalCodecError("type-mismatch", `Expected a "${expectedType}" code, got "${payload.type}".`);
    }

    return payload;
}
