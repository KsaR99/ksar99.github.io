"use strict";

import {
    deflateRaw,
    hexDecode,
    hexEncode,
    inflateRaw,
    isCompressionSupported
} from "./binary-codec.js";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

const VERSION = 2;
const FLAG_DEFLATE_RAW = 1;

export async function encodeSignal(description) {
    const sdp = typeof description === "string" ? description : description?.sdp;
    if (typeof sdp !== "string" || !sdp) {
        throw new Error("Invalid SDP.");
    }

    const input = TEXT_ENCODER.encode(sdp);

    if (isCompressionSupported()) {
        const compressed = await deflateRaw(input);
        const frame = new Uint8Array(2 + compressed.length);
        frame[0] = VERSION;
        frame[1] = FLAG_DEFLATE_RAW;
        frame.set(compressed, 2);
        return hexEncode(frame);
    }

    const frame = new Uint8Array(2 + input.length);
    frame[0] = VERSION;
    frame[1] = 0;
    frame.set(input, 2);
    return hexEncode(frame);
}

export async function decodeSignal(code) {
    const frame = hexDecode(code);
    if (frame.length < 2 || frame[0] !== VERSION) {
        throw new Error("Invalid or unsupported signal code.");
    }

    const flags = frame[1];
    const payload = frame.subarray(2);
    const bytes = flags & FLAG_DEFLATE_RAW
        ? await inflateRaw(payload)
        : payload;

    const sdp = TEXT_DECODER.decode(bytes);
    if (!sdp) {
        throw new Error("Signal code contains empty SDP.");
    }

    return sdp;
}

export { encodeSignal as encode, decodeSignal as decode };
