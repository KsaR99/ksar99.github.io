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
            if (event.detail === "failed" || event.detail === "disconnected") this._onDisconnected();
        });
        this.peer.addEventListener("error", (event) => {
            this.dispatchEvent(new CustomEvent("error", {detail: event.detail}));
        });
        this.peer.addEventListener("message", (event) => this._onMessage(event.detail));
    }

    static createHost(options = {}) {
        return new MultiplayerSession({role: PEER_ROLE.HOST, ...options});
    }

    static createGuest(options = {}) {
        return new MultiplayerSession({role: PEER_ROLE.GUEST, ...options});
    }

    get isConnected() {
        return this.peer.isOpen;
    }

    get bothReady() {
        return this.localReady && this.remoteReady;
    }

    /** Host: creates the room and returns the base64 code to send to the guest. */
    async createRoom() {
        return this.peer.createOffer();
    }

    /** Guest: joins a room from the host's code, returns the base64 answer code to send back to the host. */
    async joinRoom(hostCode) {
        return this.peer.createAnswer(hostCode);
    }

    /** Host: finishes the handshake once the guest's answer code arrives. */
    async acceptGuest(guestCode) {
        return this.peer.acceptAnswer(guestCode);
    }

    /** Marks the local side ready/unready and notifies the peer. Fires "ready"/"bothready" locally too. */
    setReady(isReady = true) {
        this.localReady = Boolean(isReady);
        this.peer.send({t: this.localReady ? PROTOCOL_MESSAGE_TYPE.READY : PROTOCOL_MESSAGE_TYPE.UNREADY});
        this._emitReady();
    }

    /** Tells the peer to start the match. Typically called once bothReady is true. */
    sendStart(payload = {}) {
        this.peer.send({t: PROTOCOL_MESSAGE_TYPE.START, payload});
    }

    /** Sends an arbitrary app payload; arrives on the peer as a "message" event. */
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

    _onDisconnected() {
        this.localReady = false;
        this.remoteReady = false;
        this.dispatchEvent(new Event("disconnected"));
    }
}
