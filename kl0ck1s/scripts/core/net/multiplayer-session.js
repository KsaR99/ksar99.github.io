"use strict";

import {PEER_ROLE, PROTOCOL_MESSAGE_TYPE} from "./net-constants.js";
import {RtcPeerConnection} from "./rtc-peer-connection.js";

export class MultiplayerSession extends EventTarget {
    constructor({role, ...peerOptions} = {}) {
        super();
        this.role = role;
        this.localReady = false;
        this.remoteReady = false;

        this.peer = new RtcPeerConnection({role, ...peerOptions});
        this.peer.addEventListener("channelopen", () => this.dispatchEvent(new Event("connected")));
        this.peer.addEventListener("channelclose", () => this._onDisconnected());
        this.peer.addEventListener("statechange", (event) => {
            if (event.detail === "failed" || event.detail === "disconnected") this._onDisconnected(event.detail);
        });
        this.peer.addEventListener("error", (event) => {
            this.dispatchEvent(new CustomEvent("error", {detail: event.detail}));
        });
        this.peer.addEventListener("message", (event) => this._onMessage(event.detail));
    }

    get isConnected() {
        return this.peer.isOpen;
    }

    get bothReady() {
        return this.localReady && this.remoteReady;
    }

    static createHost(options = {}) {
        return new MultiplayerSession({role: PEER_ROLE.HOST, ...options});
    }

    static createGuest(options = {}) {
        return new MultiplayerSession({role: PEER_ROLE.GUEST, ...options});
    }

    async createRoom() {
        return this.peer.createOffer();
    }

    async joinRoom(hostCode) {
        return this.peer.createAnswer(hostCode);
    }

    async acceptGuest(guestCode) {
        return this.peer.acceptAnswer(guestCode);
    }

    setReady(isReady = true) {
        this.localReady = Boolean(isReady);
        this.peer.send({t: this.localReady ? PROTOCOL_MESSAGE_TYPE.READY : PROTOCOL_MESSAGE_TYPE.UNREADY});
        this._emitReady();
    }

    sendStart(payload = {}) {
        this.peer.send({t: PROTOCOL_MESSAGE_TYPE.START, payload});
    }

    send(payload) {
        this.peer.send({t: PROTOCOL_MESSAGE_TYPE.DATA, payload});
    }

    close() {
        this.peer.close();
    }

    _onMessage(raw) {
        if (!raw || typeof raw !== "object") return;

        switch (raw.t) {
            case PROTOCOL_MESSAGE_TYPE.READY:
                this.remoteReady = true;
                this._emitReady();
                break;
            case PROTOCOL_MESSAGE_TYPE.UNREADY:
                this.remoteReady = false;
                this._emitReady();
                break;
            case PROTOCOL_MESSAGE_TYPE.START:
                this.dispatchEvent(new CustomEvent("start", {detail: raw.payload ?? {}}));
                break;
            case PROTOCOL_MESSAGE_TYPE.DATA:
                this.dispatchEvent(new CustomEvent("message", {detail: raw.payload}));
                break;
            default:
                // Unknown envelope shape — surface it as generic data rather than dropping it silently.
                this.dispatchEvent(new CustomEvent("message", {detail: raw}));
        }
    }

    _emitReady() {
        this.dispatchEvent(new CustomEvent("ready", {detail: {local: this.localReady, remote: this.remoteReady}}));
        if (this.bothReady) this.dispatchEvent(new Event("bothready"));
    }

    _onDisconnected(reason = null) {
        this.localReady = false;
        this.remoteReady = false;
        this.dispatchEvent(new CustomEvent("disconnected", {detail: {reason}}));
    }
}
