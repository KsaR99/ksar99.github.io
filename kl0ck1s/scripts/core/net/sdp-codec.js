"use strict";

const CANDIDATE_TYPE_RANK = Object.freeze({
    relay: 0,
    srflx: 1,
    prflx: 2,
    host: 3,
});

function extractField(regex, text) {
    const match = regex.exec(text);
    return match ? match[1] : null;
}

function isMdnsHost(candidate) {
    return candidate.type === "host" && candidate.ip.endsWith(".local");
}

function isIPv6(ip) {
    return ip.includes(":");
}

function parseCandidateLine(line) {
    const match = /^a=candidate:(\S+) (\d+) (\S+) (\d+) (\S+) (\d+) typ (\S+)/.exec(line.trim());
    if (!match) return null;

    const [, , , protocol, priority, ip, port, type] = match;
    if (protocol.toLowerCase() !== "udp") return null;

    return {protocol: "udp", priority: Number(priority), ip, port: Number(port), type};
}

function parseSdp(sdpText) {
    const ufrag = extractField(/^a=ice-ufrag:(.+)$/m, sdpText);
    const pwd = extractField(/^a=ice-pwd:(.+)$/m, sdpText);
    const fingerprintLine = extractField(/^a=fingerprint:(.+)$/m, sdpText);
    const setup = extractField(/^a=setup:(.+)$/m, sdpText) ?? "actpass";
    const sctpPort = extractField(/^a=sctp-port:(\d+)$/m, sdpText);
    const maxMessageSize = extractField(/^a=max-message-size:(\d+)$/m, sdpText);

    if (!ufrag || !pwd || !fingerprintLine) {
        throw new Error("SDP is missing required ICE/DTLS attributes.");
    }

    const [fingerprintAlgorithm, fingerprintHash] = fingerprintLine.trim().split(" ");
    const candidates = sdpText
        .split(/\r\n|\n/)
        .filter((line) => line.startsWith("a=candidate:"))
        .map(parseCandidateLine)
        .filter(Boolean);

    return {
        ufrag,
        pwd,
        fingerprintAlgorithm,
        fingerprintHash,
        setup,
        sctpPort: sctpPort ? Number(sctpPort) : 5000,
        maxMessageSize: maxMessageSize ? Number(maxMessageSize) : 262144,
        candidates,
    };
}

function filterCandidates(candidates, {maxPerType = 3} = {}) {
    const hasRoutableRemote = candidates.some((c) => c.type === "srflx" || c.type === "relay");
    let pool = hasRoutableRemote ? candidates.filter((c) => !isMdnsHost(c)) : candidates;

    const byType = new Map();
    for (const candidate of pool) {
        const list = byType.get(candidate.type) ?? [];
        list.push(candidate);
        byType.set(candidate.type, list);
    }

    pool = [];
    for (const list of byType.values()) {
        const hasIPv4 = list.some((c) => !isIPv6(c.ip));
        const scoped = hasIPv4 ? list.filter((c) => !isIPv6(c.ip)) : list;
        scoped.sort((a, b) => b.priority - a.priority);
        pool.push(...scoped.slice(0, maxPerType));
    }

    return pool.sort((a, b) => (CANDIDATE_TYPE_RANK[a.type] ?? 9) - (CANDIDATE_TYPE_RANK[b.type] ?? 9));
}

function encodeCandidate(candidate) {
    return `${candidate.ip}:${candidate.port}:${candidate.priority}:${candidate.type}`;
}

function decodeCandidate(compact, index) {
    const parts = compact.split(":");
    const type = parts.pop();
    const priority = Number(parts.pop());
    const port = Number(parts.pop());
    const ip = parts.join(":");
    return {foundation: String(index + 1), ip, port, priority, type};
}

function buildCandidateLine(candidate) {
    const base = `a=candidate:${candidate.foundation} 1 udp ${candidate.priority} ${candidate.ip} ${candidate.port} typ ${candidate.type}`;
    if (candidate.type === "srflx" || candidate.type === "relay") {
        return `${base} raddr 0.0.0.0 rport 0`;
    }
    return base;
}

export function toCompactSdp(sdpText, filterOptions) {
    const parsed = parseSdp(sdpText);
    const candidates = filterCandidates(parsed.candidates, filterOptions);

    return {
        uf: parsed.ufrag,
        pw: parsed.pwd,
        fa: parsed.fingerprintAlgorithm,
        fh: parsed.fingerprintHash,
        st: parsed.setup,
        sp: parsed.sctpPort,
        mm: parsed.maxMessageSize,
        c: candidates.map(encodeCandidate),
    };
}

export function fromCompactSdp(compact) {
    if (!compact || !compact.uf || !compact.pw || !compact.fa || !compact.fh) {
        throw new Error("Compact SDP payload is missing required fields.");
    }

    const candidateLines = (compact.c ?? []).map(decodeCandidate).map(buildCandidateLine);

    return [
        "v=0",
        "o=- 0 2 IN IP4 127.0.0.1",
        "s=-",
        "t=0 0",
        "a=group:BUNDLE 0",
        "a=msid-semantic: WMS",
        "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
        "c=IN IP4 0.0.0.0",
        `a=ice-ufrag:${compact.uf}`,
        `a=ice-pwd:${compact.pw}`,
        "a=ice-options:trickle",
        `a=fingerprint:${compact.fa} ${compact.fh}`,
        `a=setup:${compact.st ?? "actpass"}`,
        "a=mid:0",
        `a=sctp-port:${compact.sp ?? 5000}`,
        `a=max-message-size:${compact.mm ?? 262144}`,
        ...candidateLines,
        "a=end-of-candidates",
        "",
    ].join("\r\n");
}
