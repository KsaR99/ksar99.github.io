"use strict";

import {deflateRaw, inflateRaw, isCompressionSupported} from "./binary-codec.js";
import {SIGNAL_CODE_VERSION} from "./net-constants.js";

const SIGNAL_FLAG_COMPRESSED = 1;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

    const sdpBytes = textEncoder.encode(sdp);
    let body = sdpBytes;
    let flag = 0;

    if (isCompressionSupported()) {
        const compressed = await deflateRaw(sdpBytes);
        if (compressed.byteLength < sdpBytes.byteLength) {
            body = compressed;
            flag = SIGNAL_FLAG_COMPRESSED;
        }
    }

    const typeBytes = textEncoder.encode(type);
    if (typeBytes.length > 255) {
        throw new SignalCodecError("invalid", "Signal type is too long.");
    }

    // [version][flags][type length][type UTF-8][compressed/raw SDP]
    const frame = new Uint8Array(3 + typeBytes.length + body.byteLength);
    frame[0] = SIGNAL_CODE_VERSION;
    frame[1] = flag;
    frame[2] = typeBytes.length;
    frame.set(typeBytes, 3);
    frame.set(body, 3 + typeBytes.length);

    return frame;
}

export async function decodeSignal(code, expectedType = null) {
    const trimmed = (code ?? "").trim();
    if (!trimmed) {
        throw new SignalCodecError("empty", "Signal code is empty.");
    }

    try {
        const frame = trimmed;
        if (frame.byteLength < 3) {
            throw new Error("short frame");
        }

        const version = frame[0];
        const flag = frame[1];
        const typeLength = frame[2];

        if (version !== SIGNAL_CODE_VERSION) {
            throw new SignalCodecError(
                "version-mismatch",
                `Unsupported signal code version: ${version}.`
            );
        }

        const typeEnd = 3 + typeLength;
        if (typeEnd > frame.byteLength) {
            throw new Error("invalid type length");
        }

        const type = textDecoder.decode(frame.subarray(3, typeEnd));
        if (expectedType && type !== expectedType) {
            throw new SignalCodecError(
                "type-mismatch",
                `Expected a "${expectedType}" code, got "${type}".`
            );
        }

        let sdpBytes = frame.subarray(typeEnd);
        if (flag & SIGNAL_FLAG_COMPRESSED) {
            if (!isCompressionSupported()) {
                throw new Error("compressed code but deflate-raw unsupported");
            }
            sdpBytes = await inflateRaw(sdpBytes);
        }

        const sdp = textDecoder.decode(sdpBytes);
        if (!sdp) {
            throw new Error("empty SDP");
        }

        return {v: version, type, sdp};
    } catch (error) {
        if (error instanceof SignalCodecError) throw error;
        throw new SignalCodecError("malformed", "Signal code could not be decoded.");
    }
}
