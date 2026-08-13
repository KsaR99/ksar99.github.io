"use strict";


const canCompress = typeof CompressionStream === "function" && typeof DecompressionStream === "function";

async function runStream(Ctor, bytes) {
    const stream = new Ctor("deflate-raw");
    const writer = stream.writable.getWriter();
    const writeDone = writer.write(bytes).then(() => writer.close());
    const [buffer] = await Promise.all([
        new Response(stream.readable).arrayBuffer(),
        writeDone,
    ]);
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
