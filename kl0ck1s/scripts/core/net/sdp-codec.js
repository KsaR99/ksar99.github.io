"use strict";

export function toCompactSdp(sdpText) {
    if (typeof sdpText !== "string" || !sdpText) {
        throw new Error("Invalid SDP.");
    }
    return sdpText;
}

export function fromCompactSdp(sdpText) {
    if (typeof sdpText !== "string" || !sdpText) {
        throw new Error("Invalid SDP.");
    }
    return sdpText;
}
