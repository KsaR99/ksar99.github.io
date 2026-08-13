"use strict";

const METERED_TURN_USERNAME = "c8322df6675949b6fe8d4b3d";
const METERED_TURN_CREDENTIAL = "SWNzHmi5u+GbyQVi";

export const ICE_SERVERS = Object.freeze([
    Object.freeze({urls: "stun:stun.l.google.com:19302"}),
    Object.freeze({urls: "stun:stun1.l.google.com:19302"}),
    Object.freeze({urls: "stun:stun2.l.google.com:19302"}),
    Object.freeze({urls: "stun:stun3.l.google.com:19302"}),
    Object.freeze({urls: "stun:stun4.l.google.com:19302"}),
    Object.freeze({urls: "stun:stun.relay.metered.ca:80"}),
    Object.freeze({
        urls: "turn:global.relay.metered.ca:80",
        username: METERED_TURN_USERNAME,
        credential: METERED_TURN_CREDENTIAL,
    }),
    Object.freeze({
        urls: "turn:global.relay.metered.ca:80?transport=tcp",
        username: METERED_TURN_USERNAME,
        credential: METERED_TURN_CREDENTIAL,
    }),
    Object.freeze({
        urls: "turn:global.relay.metered.ca:443",
        username: METERED_TURN_USERNAME,
        credential: METERED_TURN_CREDENTIAL,
    }),
    Object.freeze({
        urls: "turns:global.relay.metered.ca:443?transport=tcp",
        username: METERED_TURN_USERNAME,
        credential: METERED_TURN_CREDENTIAL,
    }),
]);

export const RTC_CONFIGURATION = Object.freeze({
    iceServers: ICE_SERVERS,
    iceCandidatePoolSize: 4,
});
