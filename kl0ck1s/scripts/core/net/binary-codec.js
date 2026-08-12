"use strict";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const BASE64_LOOKUP = (() => {
    const table = new Int8Array(128).fill(-1);
    for (let i = 0; i < BASE64_ALPHABET.length; i++) table[BASE64_ALPHABET.charCodeAt(i)] = i;
    return table;
})();

const canCompress = typeof CompressionStream === "function" && typeof DecompressionStream === "function";

async function runStream(Ctor, bytes) {
    const stream = new Ctor("deflate-raw");
    const writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const buffer = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(buffer);
}

export function isCompressionSupported() {
    return canCompress;
}

export async function deflateRaw(bytes) {
    return runStream(CompressionStream, bytes);
}

export async function inflateRaw(bytes) {
    return runStream(DecompressionStream, bytes);
}

export function base64Encode(bytes) {
    let output = "";
    let i = 0;

    for (; i + 3 <= bytes.length; i += 3) {
        const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        output += BASE64_ALPHABET[(chunk >> 18) & 63];
        output += BASE64_ALPHABET[(chunk >> 12) & 63];
        output += BASE64_ALPHABET[(chunk >> 6) & 63];
        output += BASE64_ALPHABET[chunk & 63];
    }

    const remaining = bytes.length - i;
    if (remaining === 1) {
        const chunk = bytes[i] << 16;
        output += BASE64_ALPHABET[(chunk >> 18) & 63];
        output += BASE64_ALPHABET[(chunk >> 12) & 63];
    } else if (remaining === 2) {
        const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
        output += BASE64_ALPHABET[(chunk >> 18) & 63];
        output += BASE64_ALPHABET[(chunk >> 12) & 63];
        output += BASE64_ALPHABET[(chunk >> 6) & 63];
    }

    return output;
}

export function base64Decode(text) {
    const clean = text.replace(/[^A-Za-z0-9\-_]/g, "");
    const bytes = new Uint8Array(Math.floor((clean.length * 6) / 8));

    let buffer = 0;
    let bitsInBuffer = 0;
    let byteIndex = 0;

    for (let i = 0; i < clean.length; i++) {
        const code = clean.charCodeAt(i);
        const value = code < 128 ? BASE64_LOOKUP[code] : -1;
        if (value === -1) continue;

        buffer = (buffer << 6) | value;
        bitsInBuffer += 6;

        if (bitsInBuffer >= 8) {
            bitsInBuffer -= 8;
            bytes[byteIndex++] = (buffer >> bitsInBuffer) & 0xff;
        }
    }

    return bytes;
}
