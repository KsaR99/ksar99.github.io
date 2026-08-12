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
import {fromCompactSdp, toCompactSdp} from "./sdp-codec.js";
import {decodeFrame, encodeFrame} from "./wire-codec.js";

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
        this._sendQueue = Promise.resolve();
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

    async createOffer() {
        this._assertRole(PEER_ROLE.HOST);
        this._setState(CONNECTION_STATE.GATHERING);

        this._bindChannel(this._pc.createDataChannel(DATA_CHANNEL_LABEL, DATA_CHANNEL_OPTIONS));

        const offer = await this._pc.createOffer();
        await this._pc.setLocalDescription(offer);
        await waitForIceGatheringComplete(this._pc, this._iceGatheringTimeoutMs);

        this._setState(CONNECTION_STATE.AWAITING_ANSWER);
        return await encodeSignal({type: "offer", sdp: toCompactSdp(this._pc.localDescription.sdp)});
    }

    async createAnswer(offerCode) {
        this._assertRole(PEER_ROLE.GUEST);

        if (this._pc.signalingState !== "stable") return this._lastAnswerCode ?? "";

        const {sdp} = await decodeSignal(offerCode, "offer");

        this._setState(CONNECTION_STATE.GATHERING);
        await this._pc.setRemoteDescription({type: "offer", sdp: fromCompactSdp(sdp)});

        const answer = await this._pc.createAnswer();
        await this._pc.setLocalDescription(answer);
        await waitForIceGatheringComplete(this._pc, this._iceGatheringTimeoutMs);

        this._setState(CONNECTION_STATE.CONNECTING);
        this._lastAnswerCode = await encodeSignal({type: "answer", sdp: toCompactSdp(this._pc.localDescription.sdp)});
        return this._lastAnswerCode;
    }

    async acceptAnswer(answerCode) {
        this._assertRole(PEER_ROLE.HOST);

        if (this._pc.signalingState !== "have-local-offer") return;

        const {sdp} = await decodeSignal(answerCode, "answer");

        this._setState(CONNECTION_STATE.CONNECTING);
        await this._pc.setRemoteDescription({type: "answer", sdp: fromCompactSdp(sdp)});
    }

    send(payload) {
        if (!this.isOpen) {
            throw new Error("Data channel is not open.");
        }

        const channel = this.channel;
        this._sendQueue = this._sendQueue
            .then(() => encodeFrame(payload))
            .then((frame) => {
                if (channel.readyState === "open") channel.send(frame);
            })
            .catch((error) => {
                this.dispatchEvent(new CustomEvent("error", {detail: error}));
            });

        return this._sendQueue;
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
        this.channel.binaryType = "arraybuffer";
        this._sendQueue = Promise.resolve();

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
            decodeFrame(event.data)
                .then((payload) => {
                    this.dispatchEvent(new CustomEvent("message", {detail: payload}));
                })
                .catch((error) => {
                    this.dispatchEvent(new CustomEvent("error", {detail: error}));
                });
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
