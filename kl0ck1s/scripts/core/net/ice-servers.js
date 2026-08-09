"use strict";

export const ICE_SERVERS = Object.freeze([
    Object.freeze({urls: "stun:stun.l.google.com:19302"}),
    Object.freeze({urls: "stun:stun1.l.google.com:19302"}),
    Object.freeze({urls: "stun:stun2.l.google.com:19302"}),
    Object.freeze({urls: "stun:stun3.l.google.com:19302"}),
    Object.freeze({urls: "stun:stun4.l.google.com:19302"}),
]);

export const RTC_CONFIGURATION = Object.freeze({
    iceServers: ICE_SERVERS,
    iceCandidatePoolSize: 4,
});
