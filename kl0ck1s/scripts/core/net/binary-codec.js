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


    return btoa(binary);
}

export function base64Decode(text) {
    const clean = text.trim();
    if (!clean || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || (clean.length & 3)) {
        throw new Error("Invalid Base64 signal code.");
    }

    let binary;
    try {
        binary = atob(clean);
    } catch {
        throw new Error("Invalid Base64 signal code.");
    }

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
