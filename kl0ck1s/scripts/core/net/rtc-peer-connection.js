"use strict";

import {RTC_CONFIGURATION} from "./ice-servers.js";
import {
    CONNECTION_STATE,
    DATA_CHANNEL_LABEL,
    DATA_CHANNEL_OPTIONS,
    ICE_GATHERING_TIMEOUT_MS,
    PEER_ROLE,
} from "./net-constants.js";
import {decodeSignal, encodeSignal} from "./signaling-codec.js";

function waitForIceGatheringComplete(pc, timeoutMs) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();

    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            pc.removeEventListener("icegatheringstatechange", onChange);
            clearTimeout(timer);
            resolve();
        };
        const onChange = () => {
            if (pc.iceGatheringState === "complete") finish();
        };

        pc.addEventListener("icegatheringstatechange", onChange);

        const timer = setTimeout(finish, timeoutMs);
    });
}

/**
 * Thin, UI-agnostic wrapper around RTCPeerConnection + a single RTCDataChannel,
 * using manual (non-trickle) ICE: the whole local description — candidates
 * already embedded in the SDP once gathering completes — is exchanged as one
 * base64 "code" the two peers swap out-of-band (chat, QR, etc).
 *
 * Events (via EventTarget): "statechange" ({detail: CONNECTION_STATE}),
 * "channelopen", "channelclose", "message" ({detail: parsed payload}), "error".
 */
export class RtcPeerConnection extends EventTarget {
    constructor({role, iceGatheringTimeoutMs = ICE_GATHERING_TIMEOUT_MS, rtcConfiguration = RTC_CONFIGURATION} = {}) {
        super();
        if (role !== PEER_ROLE.HOST && role !== PEER_ROLE.GUEST) {
            throw new Error(`Invalid peer role: ${role}`);
        }

        this.role = role;
        this.state = CONNECTION_STATE.IDLE;
        this.channel = null;

        this._iceGatheringTimeoutMs = iceGatheringTimeoutMs;
        this._pc = new RTCPeerConnection(rtcConfiguration);
        this._pc.addEventListener("connectionstatechange", () => this._onConnectionStateChange());
        this._pc.addEventListener("datachannel", (event) => this._bindChannel(event.channel));
    }

    get connectionState() {
        return this._pc.connectionState;
    }

    get isOpen() {
        return this.channel?.readyState === "open";
    }

    /** Host only: creates the offer, waits out ICE gathering, returns a base64 code to share with the guest. */
    async createOffer() {
        this._assertRole(PEER_ROLE.HOST);
        this._setState(CONNECTION_STATE.GATHERING);

        this._bindChannel(this._pc.createDataChannel(DATA_CHANNEL_LABEL, DATA_CHANNEL_OPTIONS));

        const offer = await this._pc.createOffer();
        await this._pc.setLocalDescription(offer);
        await waitForIceGatheringComplete(this._pc, this._iceGatheringTimeoutMs);

        this._setState(CONNECTION_STATE.AWAITING_ANSWER);
        return encodeSignal({type: "offer", sdp: this._pc.localDescription.sdp});
    }

    /** Guest only: consumes the host's offer code, waits out ICE gathering, returns a base64 answer code. */
    async createAnswer(offerCode) {
        this._assertRole(PEER_ROLE.GUEST);
        const {sdp} = decodeSignal(offerCode, "offer");

        this._setState(CONNECTION_STATE.GATHERING);
        await this._pc.setRemoteDescription({type: "offer", sdp});

        const answer = await this._pc.createAnswer();
        await this._pc.setLocalDescription(answer);
        await waitForIceGatheringComplete(this._pc, this._iceGatheringTimeoutMs);

        this._setState(CONNECTION_STATE.CONNECTING);
        return encodeSignal({type: "answer", sdp: this._pc.localDescription.sdp});
    }

    /** Host only: consumes the guest's answer code to complete the handshake. */
    async acceptAnswer(answerCode) {
        this._assertRole(PEER_ROLE.HOST);
        const {sdp} = decodeSignal(answerCode, "answer");

        this._setState(CONNECTION_STATE.CONNECTING);
        await this._pc.setRemoteDescription({type: "answer", sdp});
    }

    /** Sends a JSON-serializable payload to the peer over the data channel. */
    send(payload) {
        if (!this.isOpen) {
            throw new Error("Data channel is not open.");
        }
        this.channel.send(JSON.stringify(payload));
    }

    close() {
        try {
            this.channel?.close();
        } catch {
            // already closed/never opened — nothing to clean up
        }
        try {
            this._pc.close();
        } catch {
            // already closed
        }
        this._setState(CONNECTION_STATE.CLOSED);
    }

    _assertRole(expected) {
        if (this.role !== expected) {
            throw new Error(`This operation requires role "${expected}", peer is "${this.role}".`);
        }
    }

    _bindChannel(channel) {
        this.channel = channel;

        channel.addEventListener("open", () => {
            this._setState(CONNECTION_STATE.CONNECTED);
            this.dispatchEvent(new Event("channelopen"));
        });
        channel.addEventListener("close", () => {
            this._setState(CONNECTION_STATE.DISCONNECTED);
            this.dispatchEvent(new Event("channelclose"));
        });
        channel.addEventListener("error", (event) => {
            this.dispatchEvent(new CustomEvent("error", {detail: event}));
        });
        channel.addEventListener("message", (event) => {
            let payload = event.data;
            try {
                payload = JSON.parse(event.data);
            } catch {
                // not JSON — pass the raw string through as-is
            }
            this.dispatchEvent(new CustomEvent("message", {detail: payload}));
        });
    }

    _onConnectionStateChange() {
        const pcState = this._pc.connectionState;
        if (pcState === "failed") this._setState(CONNECTION_STATE.FAILED);
        else if (pcState === "disconnected") this._setState(CONNECTION_STATE.DISCONNECTED);
        else if (pcState === "closed") this._setState(CONNECTION_STATE.CLOSED);
    }

    _setState(state) {
        if (this.state === state) return;
        this.state = state;
        this.dispatchEvent(new CustomEvent("statechange", {detail: state}));
    }
}
