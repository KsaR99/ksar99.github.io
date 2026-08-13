"use strict";

import {RTC_CONFIGURATION} from "./ice-servers.js";
import {
    CONNECTION_STATE,
    DATA_CHANNEL_LABEL,
    DATA_CHANNEL_OPTIONS,
    PEER_ROLE,
} from "./net-constants.js";
import {decodeSignal, encodeSignal} from "./signaling-codec.js";
import {decodeFrame, encodeFrame} from "./wire-codec.js";

function candidateTypeOf(candidateString) {
    const match = /typ (\w+)/.exec(candidateString ?? "");
    return match ? match[1] : "unknown";
}

async function logIceDiagnostics(pc, role, reason) {
    console.warn("[rtc] diagnostics", {
        role,
        reason,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        iceGatheringState: pc.iceGatheringState,
        signalingState: pc.signalingState,
    });

    try {
        const stats = await pc.getStats();
        const pairs = [];
        const candidates = new Map();
        stats.forEach((entry) => {
            if (entry.type === "local-candidate" || entry.type === "remote-candidate") {
                candidates.set(entry.id, entry);
            }
        });
        stats.forEach((entry) => {
            if (entry.type !== "candidate-pair") return;
            const local = candidates.get(entry.localCandidateId);
            const remote = candidates.get(entry.remoteCandidateId);
            pairs.push({
                state: entry.state,
                nominated: entry.nominated,
                localType: local?.candidateType,
                localProtocol: local?.protocol,
                remoteType: remote?.candidateType,
                remoteProtocol: remote?.protocol,
                bytesSent: entry.bytesSent,
                bytesReceived: entry.bytesReceived,
            });
        });
        console.warn("[rtc] candidate pairs", {role, pairs});
    } catch (error) {
        console.warn("[rtc] getStats failed", {role, error: error?.message});
    }
}

export class RtcPeerConnection extends EventTarget {
    constructor({role, rtcConfiguration = RTC_CONFIGURATION} = {}) {
        super();
        if (role !== PEER_ROLE.HOST && role !== PEER_ROLE.GUEST) {
            throw new Error(`Invalid peer role: ${role}`);
        }

        this.role = role;
        this.state = CONNECTION_STATE.IDLE;
        this.channel = null;

        this._sendQueue = Promise.resolve();
        this._pendingCandidates = [];
        this._pc = new RTCPeerConnection({...rtcConfiguration, iceServers: [...rtcConfiguration.iceServers]});

        this._pc.addEventListener("connectionstatechange", () => this._onConnectionStateChange());
        this._pc.addEventListener("datachannel", (event) => this._bindChannel(event.channel));
        this._pc.addEventListener("iceconnectionstatechange", () => {
            if (this._pc.iceConnectionState === "failed" || this._pc.iceConnectionState === "disconnected") {
                logIceDiagnostics(this._pc, this.role, `iceConnectionState:${this._pc.iceConnectionState}`);
            }
        });
        this._pc.addEventListener("icegatheringstatechange", () => {
        });
        this._pc.addEventListener("icecandidate", (event) => {
            if (!event.candidate) {
                return;
            }
            this.dispatchEvent(new CustomEvent("localcandidate", {detail: event.candidate.toJSON()}));
        });
        this._pc.addEventListener("icecandidateerror", (event) => {
            console.warn("[rtc] icecandidateerror", {
                role: this.role,
                errorCode: event.errorCode,
                errorText: event.errorText,
                url: event.url,
                address: event.address,
                port: event.port,
            });
        });
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
        this._setState(CONNECTION_STATE.AWAITING_ANSWER);
        return await encodeSignal({type: "offer", sdp: this._pc.localDescription.sdp});
    }

    async createAnswer(offerCode) {
        this._assertRole(PEER_ROLE.GUEST);

        if (this._pc.signalingState !== "stable") return this._lastAnswerCode ?? "";

        const {sdp} = await decodeSignal(offerCode, "offer");
        this._setState(CONNECTION_STATE.GATHERING);
        await this._pc.setRemoteDescription({type: "offer", sdp});
        this._flushPendingCandidates();

        const answer = await this._pc.createAnswer();
        await this._pc.setLocalDescription(answer);
        this._setState(CONNECTION_STATE.CONNECTING);
        this._lastAnswerCode = await encodeSignal({type: "answer", sdp: this._pc.localDescription.sdp});
        return this._lastAnswerCode;
    }

    async acceptAnswer(answerCode) {
        this._assertRole(PEER_ROLE.HOST);

        if (this._pc.signalingState !== "have-local-offer") {
            throw new Error();
        }

        const {sdp} = await decodeSignal(answerCode, "answer");
        this._setState(CONNECTION_STATE.CONNECTING);
        await this._pc.setRemoteDescription({type: "answer", sdp});
        this._flushPendingCandidates();
    }

    async addRemoteCandidate(candidateInit) {
        if (!candidateInit) return;

        if (!this._pc.remoteDescription) {
            this._pendingCandidates.push(candidateInit);
            return;
        }

        try {
            await this._pc.addIceCandidate(candidateInit);
        } catch (error) {
            console.warn("[rtc] addIceCandidate failed", {role: this.role, error: error?.message});
        }
    }

    send(payload) {
        if (!this.isOpen) {
            throw new Error("Data channel is not open.");
        }

        const channel = this.channel;
        this._sendQueue = this._sendQueue
            .then(() => encodeFrame(payload))
            .then((frame) => {
                if (channel.readyState === "open") {
                    channel.send(frame);
                } else {
                    console.warn("[rtc] frame dropped, channel not open", {role: this.role, readyState: channel.readyState});
                }
            })
            .catch((error) => {
                console.error("[rtc] frame send failed", {role: this.role, error: error?.message});
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

    _flushPendingCandidates() {
        const pending = this._pendingCandidates;
        this._pendingCandidates = [];
        if (!pending.length) return;

        for (const candidateInit of pending) {
            this._pc.addIceCandidate(candidateInit).catch((error) => {
                console.warn("[rtc] addIceCandidate (queued) failed", {role: this.role, error: error?.message});
            });
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
                    console.error("[rtc] frame decode failed", {role: this.role, byteLength: event.data?.byteLength, error: error?.message});
                    this.dispatchEvent(new CustomEvent("error", {detail: error}));
                });
        });
    }

    _onConnectionStateChange() {
        const pcState = this._pc.connectionState;
        if (pcState === "failed") {
            logIceDiagnostics(this._pc, this.role, "connectionState:failed");
            this._setState(CONNECTION_STATE.FAILED);
        } else if (pcState === "disconnected") {
            this._setState(CONNECTION_STATE.DISCONNECTED);
        } else if (pcState === "closed") {
            this._setState(CONNECTION_STATE.CLOSED);
        }
    }

    _setState(state) {
        if (this.state === state) return;
        this.state = state;
        this.dispatchEvent(new CustomEvent("statechange", {detail: state}));
    }
}
