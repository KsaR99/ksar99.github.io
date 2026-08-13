"use strict";

import {deflateRaw, hexDecode, hexEncode, inflateRaw, isCompressionSupported} from "./binary-codec.js";
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
    const json = textEncoder.encode(JSON.stringify({v: SIGNAL_CODE_VERSION, ...payload}));

    let body = json;
    let flag = 0;

    if (isCompressionSupported()) {
        const compressed = await deflateRaw(json);
        if (compressed.byteLength < json.byteLength) {
            body = compressed;
            flag = SIGNAL_FLAG_COMPRESSED;
        }
    }

    const frame = new Uint8Array(1 + body.byteLength);
    frame[0] = flag;
    frame.set(body, 1);
    return hexEncode(frame);
}

export async function decodeSignal(code, expectedType = null) {
    const trimmed = (code ?? "").trim();
    if (!trimmed) {
        throw new SignalCodecError("empty", "Signal code is empty.");
    }

    let payload;
    try {
        const frame = hexDecode(trimmed);
        if (frame.byteLength < 1) {
            throw new Error("empty frame");
        }

        const flag = frame[0];
        let body = frame.subarray(1);
        if (flag & SIGNAL_FLAG_COMPRESSED) {
            if (!isCompressionSupported()) {
                throw new Error("compressed code but deflate-raw unsupported");
            }
            body = await inflateRaw(body);
        }

        payload = JSON.parse(textDecoder.decode(body));
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
