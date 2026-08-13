"use strict";

import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {CONNECTION_STATE, ICE_CONNECT_TIMEOUT_MS} from "./net-constants.js";

const SUPABASE_URL = "https://ouchbmglcngapxizcrph.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_kepSL5FbNXwSRtkSUc1qpQ_Y7vJjCue";

const ROOM_TOPIC_PREFIX = "room:";
const LOBBY_TOPIC = "lobby";
const LOBBY_ROOM_TOPIC_PREFIX = "lobby-room:";

const HELLO_TIMEOUT_MS = 15000;
const OFFER_TIMEOUT_MS = 15000;
const ANSWER_TIMEOUT_MS = 20000;
const JOIN_DECISION_TIMEOUT_MS = 60000;

/** @type {any} */
let _client = null;

function client() {
    if (!_client) {
        _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            realtime: {params: {eventsPerSecond: 5}},
        });
    }
    return _client;
}

export class SupabaseSignalError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "SupabaseSignalError";
        this.code = code;
    }
}

function randomId() {
    return globalThis.crypto?.randomUUID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function subscribe(channel) {
    return new Promise((resolve, reject) => {
        channel.subscribe((status, err) => {
            if (status === "SUBSCRIBED") resolve();
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                reject(new SupabaseSignalError("channel", err?.message ?? `Channel status: ${status}`));
            }
        });
    });
}

function waitForEvent(channel, event, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            console.warn("[signaling] timed out waiting for event", {event, timeoutMs});
            reject(new SupabaseSignalError("timeout", `Timed out waiting for "${event}".`));
        }, timeoutMs);

        channel.on("broadcast", {event}, ({payload}) => {
            console.log("[signaling] received event", {event});
            clearTimeout(timer);
            resolve(payload);
        });
    });
}

function waitForPeerSettled(peer, timeoutMs) {
    const settledStates = new Set([CONNECTION_STATE.CONNECTED, CONNECTION_STATE.FAILED, CONNECTION_STATE.CLOSED]);
    if (settledStates.has(peer.state)) return Promise.resolve(peer.state);

    return new Promise((resolve) => {
        const finish = (reason) => {
            peer.removeEventListener("statechange", onChange);
            clearTimeout(timer);
            resolve(reason);
        };
        const onChange = (event) => {
            if (settledStates.has(event.detail)) finish(event.detail);
        };
        peer.addEventListener("statechange", onChange);
        const timer = setTimeout(() => finish("timeout"), timeoutMs);
    });
}

function relayLocalCandidates(peer, channel, event) {
    const onLocalCandidate = (candidateEvent) => {
        channel.send({type: "broadcast", event, payload: {candidate: candidateEvent.detail}}).catch((error) => {
            console.warn("[signaling] failed to send local candidate", {event, error: error?.message});
        });
    };
    peer.addEventListener("localcandidate", onLocalCandidate);
    return () => peer.removeEventListener("localcandidate", onLocalCandidate);
}

function relayRemoteCandidates(channel, event, peer) {
    channel.on("broadcast", {event}, ({payload}) => {
        if (!payload?.candidate) return;
        console.log("[signaling] remote candidate received", {event});
        peer.addRemoteCandidate(payload.candidate).catch((error) => {
            console.warn("[signaling] failed to add remote candidate", {event, error: error?.message});
        });
    });
}

function privateChannel(sb, topic) {
    return sb.channel(topic, {config: {private: true, broadcast: {self: false, ack: true}}});
}

async function hostSdpExchange(code, session, callbacks) {
    const sb = client();
    const channel = privateChannel(sb, ROOM_TOPIC_PREFIX + code);
    const peer = session.peer;
    let stopRelayingLocalCandidates = () => {
    };
    try {
        const helloPromise = waitForEvent(channel, "guest-hello", HELLO_TIMEOUT_MS);
        relayRemoteCandidates(channel, "guest-candidate", peer);
        await subscribe(channel);
        console.log("[signaling] host channel subscribed", {code});
        await callbacks.onChannelReady?.();

        stopRelayingLocalCandidates = relayLocalCandidates(peer, channel, "host-candidate");
        const offerCode = await session.createRoom();
        console.log("[signaling] host offer ready, waiting for guest-hello", {code, sdpLength: offerCode.length});
        await helloPromise;
        console.log("[signaling] guest-hello received", {code});
        callbacks.onGuestJoined?.();

        const answerPromise = waitForEvent(channel, "guest-answer", ANSWER_TIMEOUT_MS);
        await channel.send({type: "broadcast", event: "host-offer", payload: {sdp: offerCode}});
        console.log("[signaling] host-offer sent", {code});

        const {sdp: answerCode} = await answerPromise;
        console.log("[signaling] guest-answer received", {code, sdpLength: answerCode?.length});
        await session.acceptGuest(answerCode);
        await channel.send({type: "broadcast", event: "host-ack", payload: {}});

        const settled = await waitForPeerSettled(peer, ICE_CONNECT_TIMEOUT_MS);
        console.log("[signaling] host connection settled", {code, settled});
    } catch (error) {
        console.warn("[signaling] host exchange failed", {code, error: error?.message});
        throw error;
    } finally {
        stopRelayingLocalCandidates();
        await sb.removeChannel(channel).catch(() => {
        });
    }
}

async function guestSdpExchange(code, session, callbacks) {
    const sb = client();
    const channel = privateChannel(sb, ROOM_TOPIC_PREFIX + code);
    const peer = session.peer;
    let stopRelayingLocalCandidates = () => {
    };
    try {
        const offerPromise = waitForEvent(channel, "host-offer", OFFER_TIMEOUT_MS);
        const ackPromise = waitForEvent(channel, "host-ack", ANSWER_TIMEOUT_MS).catch(() => {
        });
        relayRemoteCandidates(channel, "host-candidate", peer);
        await subscribe(channel);
        console.log("[signaling] guest channel subscribed", {code});

        await channel.send({type: "broadcast", event: "guest-hello", payload: {}});
        console.log("[signaling] guest-hello sent", {code});

        const {sdp: offerCode} = await offerPromise;
        console.log("[signaling] host-offer received", {code, sdpLength: offerCode?.length});
        callbacks.onOfferReceived?.();

        stopRelayingLocalCandidates = relayLocalCandidates(peer, channel, "guest-candidate");
        const answerCode = await session.joinRoom(offerCode);

        await channel.send({type: "broadcast", event: "guest-answer", payload: {sdp: answerCode}});
        console.log("[signaling] guest-answer sent", {code});
        await ackPromise;
        console.log("[signaling] host-ack received or timed out", {code});

        const settled = await waitForPeerSettled(peer, ICE_CONNECT_TIMEOUT_MS);
        console.log("[signaling] guest connection settled", {code, settled});
    } catch (error) {
        console.warn("[signaling] guest exchange failed", {code, error: error?.message});
        throw error;
    } finally {
        stopRelayingLocalCandidates();
        await sb.removeChannel(channel).catch(() => {
        });
    }
}

export async function hostOpenLobby(hostName, callbacks = {}) {
    const sb = client();

    const {data, error} = await sb.rpc("mp_create_room", {p_host_name: hostName ?? ""});
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row?.code) {
        throw new SupabaseSignalError("create-room", error?.message ?? "Nie udało się utworzyć pokoju.");
    }
    const {room_id: roomId, code} = row;

    const roomChannel = privateChannel(sb, LOBBY_ROOM_TOPIC_PREFIX + roomId);
    const seenRequests = new Set();
    roomChannel.on("broadcast", {event: "join-request"}, ({payload}) => {
        if (!payload?.requestId || seenRequests.has(payload.requestId)) return;
        seenRequests.add(payload.requestId);
        callbacks.onJoinRequest?.({requestId: payload.requestId, guestName: payload.guestName || ""});
    });
    await subscribe(roomChannel);

    const lobbyChannel = privateChannel(sb, LOBBY_TOPIC);
    await subscribe(lobbyChannel);
    await lobbyChannel.send({
        type: "broadcast",
        event: "room-opened",
        payload: {roomId, hostName: hostName ?? ""},
    });

    let closed = false;

    async function leaveLobby() {
        if (closed) return;
        closed = true;
        await lobbyChannel.send({type: "broadcast", event: "room-closed", payload: {roomId}}).catch(() => {
        });
        await sb.removeChannel(lobbyChannel).catch(() => {
        });
        await sb.removeChannel(roomChannel).catch(() => {
        });
    }

    return {
        roomId,

        async accept(requestId, session, hooks = {}) {
            const {data: matched, error: matchErr} = await sb.rpc("mp_match_room", {
                p_code: code,
                p_room_id: roomId,
            });
            if (matchErr || !matched) {
                throw new SupabaseSignalError("match-failed", matchErr?.message ?? "Nie udało się dopasować gracza.");
            }

            try {
                await hostSdpExchange(code, session, {
                    ...hooks,
                    onChannelReady: async () => {
                        await roomChannel.send({type: "broadcast", event: "join-accepted", payload: {requestId, code}});
                        await leaveLobby();
                    },
                });
            } finally {
                await sb.rpc("mp_close_room", {p_code: code}).catch(() => {
                });
            }
        },

        async decline(requestId) {
            await roomChannel.send({type: "broadcast", event: "join-declined", payload: {requestId}}).catch(() => {
            });
        },

        async cancel() {
            await leaveLobby();
            await sb.rpc("mp_close_room", {p_code: code}).catch(() => {
            });
        },
    };
}

export async function browseLobby(callbacks = {}) {
    const sb = client();
    const lobbyChannel = privateChannel(sb, LOBBY_TOPIC);

    lobbyChannel.on("broadcast", {event: "room-opened"}, ({payload}) => {
        if (payload?.roomId) callbacks.onRoomOpened?.({roomId: payload.roomId, hostName: payload.hostName || ""});
    });
    lobbyChannel.on("broadcast", {event: "room-closed"}, ({payload}) => {
        if (payload?.roomId) callbacks.onRoomClosed?.(payload.roomId);
    });

    await subscribe(lobbyChannel);

    const {data, error} = await sb.rpc("mp_list_open_rooms");
    if (!error && Array.isArray(data)) {
        for (const room of data) {
            callbacks.onRoomOpened?.({roomId: room.room_id, hostName: room.host_name || ""});
        }
    }

    return {
        close: () => sb.removeChannel(lobbyChannel).catch(() => {
        }),
    };
}

/**
 * @param {string} roomId
 * @param {string} guestName
 * @param {import("./multiplayer-session.js").MultiplayerSession} session
 * @param {{
 *   onRequestSent?: () => void,
 *   onAccepted?: () => void,
 *   onOfferReceived?: () => void,
 * }} [callbacks]
 */
export async function requestJoinRoom(roomId, guestName, session, callbacks = {}) {
    const sb = client();
    const requestId = randomId();
    const channel = privateChannel(sb, LOBBY_ROOM_TOPIC_PREFIX + roomId);

    try {
        const decisionPromise = new Promise((resolve, reject) => {
            channel.on("broadcast", {event: "join-accepted"}, ({payload}) => {
                if (payload?.requestId === requestId) resolve(payload);
            });
            channel.on("broadcast", {event: "join-declined"}, ({payload}) => {
                if (payload?.requestId === requestId) {
                    reject(new SupabaseSignalError("declined", "Host odrzucił prośbę o dołączenie."));
                }
            });
        });

        await subscribe(channel);

        await channel.send({
            type: "broadcast",
            event: "join-request",
            payload: {requestId, guestName: guestName || ""}
        });
        callbacks.onRequestSent?.();

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new SupabaseSignalError("timeout", "Host nie odpowiedział na czas.")), JOIN_DECISION_TIMEOUT_MS);
        });

        const {code} = await Promise.race([decisionPromise, timeoutPromise]);
        callbacks.onAccepted?.();

        await guestSdpExchange(code, session, callbacks);
    } finally {
        await sb.removeChannel(channel).catch(() => {
        });
    }
}
