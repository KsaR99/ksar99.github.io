"use strict";


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


export function hexEncode(bytes) {
    let output = "";
    for (const byte of bytes) {
        output += byte.toString(16).padStart(2, "0");
    }
    return output;
}

export function hexDecode(text) {
    const clean = text.trim();
    if (!/^[0-9a-fA-F]*$/.test(clean) || (clean.length & 1)) {
        throw new Error("Invalid hexadecimal signal code.");
    }

    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}
