// @ts-nocheck
"use strict";

import {deflateRaw, inflateRaw, isCompressionSupported} from "./binary-codec.js";
import {WIRE_COMPRESSION_MIN_BYTES, WIRE_FLAGS, WIRE_VERSION} from "./net-constants.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function encodeFrame(payload) {
    const json = textEncoder.encode(JSON.stringify(payload));

    let body = json;
    let flags = 0;

    if (isCompressionSupported() && json.byteLength >= WIRE_COMPRESSION_MIN_BYTES) {
        const compressed = await deflateRaw(json);
        if (compressed.byteLength < json.byteLength) {
            body = compressed;
            flags |= WIRE_FLAGS.COMPRESSED;
        }
    }

    const frame = new Uint8Array(2 + body.byteLength);
    frame[0] = WIRE_VERSION;
    frame[1] = flags;
    frame.set(body, 2);
    return frame.buffer;
}

export async function decodeFrame(data) {
    const bytes = data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

    if (bytes.byteLength < 2) {
        throw new Error("Malformed wire frame: too short.");
    }

    const version = bytes[0];
    if (version !== WIRE_VERSION) {
        throw new Error(`Unsupported wire protocol version: ${version}`);
    }

    const flags = bytes[1];
    let body = bytes.subarray(2);

    if (flags & WIRE_FLAGS.COMPRESSED) {
        if (!isCompressionSupported()) {
            throw new Error("Received compressed frame but deflate-raw is unsupported here.");
        }
        body = await inflateRaw(body);
    }

    return JSON.parse(textDecoder.decode(body));
}
