// @ts-nocheck
import {MESSAGE_KIND,} from "../../../../engine/net/net-constants.js";


import type {MultiplayerController} from "../multiplayer-controller.js";
import {FINISHED_STATES, RUNNING_STATES} from "./multiplayer-controller-constants.js";

"use strict";

export function bindSessionEvents(controller: MultiplayerController) {

    const session = controller.session;
    session.addEventListener("connected", () => {
        controller._showPanel("ready");
        controller._updateReadyBadges();
        controller._setStatus(controller._t("multiplayer.statusConnected"));
        controller.game.multiplayerConnected = true;
        controller.game.multiplayerVsBot = false;
        controller._sendToPeer({kind: MESSAGE_KIND.NAME, name: controller.game.playerName || ""});
        controller._sendToPeer({kind: MESSAGE_KIND.THEME, theme: controller.game.settings.theme});
        controller._lastSentTheme = controller.game.settings.theme;
        controller._sendConfigIfHost();
    });
    session.addEventListener("ready", () => controller._updateReadyBadges());
    session.addEventListener("bothready", () => {
        controller._setStatus(controller._t(controller.role === "host"
            ? "multiplayer.statusBothReadyHost"
            : "multiplayer.statusBothReadyGuest"));
        const startButton = controller.overlayEl?.querySelector('[data-role="mp-start-button"]');
        if (startButton) startButton.hidden = controller.role !== "host";
    });
    session.addEventListener("start", (event) => {
        const remoteMode = event.detail?.mode;
        if (controller.role === "guest" && remoteMode && controller.game.gameModes[remoteMode] && remoteMode !== controller.game.mode) {
            controller.game.mode = remoteMode;
            controller.game.modeController.reset();
        }
        controller._launchMatch();
    });
    session.addEventListener("message", (event) => controller._onPeerMessage(event.detail));
    session.addEventListener("disconnected", () => {
        controller._setStatus(controller._t("multiplayer.statusDisconnected"));

        const wasInMatch = RUNNING_STATES.has(controller.game.state) || FINISHED_STATES.has(controller.game.state);
        controller._stopScoreSync();
        controller._hideOpponentUI();
        controller.game.multiplayerConnected = false;
        if (wasInMatch) controller._showDisconnectToast();
        else if (!controller.session?.isConnected) controller._onNegotiationFailed(new Error(controller._t("multiplayer.iceFailed")));
    });
    session.addEventListener("error", (event) => {
        controller._setStatus(controller._t("multiplayer.statusError"));
        if (!controller.session?.isConnected) controller._onNegotiationFailed(event.detail);
    });
}

export function updateReadyBadges(controller: MultiplayerController) {

    const root = controller.overlayEl;
    const local = root?.querySelector('[data-role="mp-local-ready-badge"]');
    const remote = root?.querySelector('[data-role="mp-remote-ready-badge"]');
    if (local) {
        local.textContent = controller._t(controller.session.localReady ? "multiplayer.youReady" : "multiplayer.youNotReady");
        local.classList.toggle("mp-ready-badge--on", controller.session.localReady);
    }
    if (remote) {
        const name = controller._remoteDisplayName();
        remote.textContent = controller._t(
            controller.session.remoteReady ? "multiplayer.opponentReady" : "multiplayer.opponentNotReady",
            {name}
        );
        remote.classList.toggle("mp-ready-badge--on", controller.session.remoteReady);
    }
}

export function toggleReady(controller: MultiplayerController) {

    if (!controller.session) return;
    controller.session.setReady(!controller.session.localReady);
    const button = controller.overlayEl?.querySelector('[data-role="mp-ready-button"]');
    if (button) button.classList.toggle("button--accent", !controller.session.localReady);
}

export function hostStart(controller: MultiplayerController) {

    if (!controller.session || controller.role !== "host") return;

    controller.game.modeController.resolveRandomMode();
    controller._renderConfigPanels();
    controller.session.sendStart({mode: controller.game.mode});
    controller._launchMatch();
}

export function launchMatch(controller: MultiplayerController) {

    controller._launching = true;
    controller.close();
    controller._launching = false;
    controller._hideResultPanel();
    controller._localFinalScore = null;
    controller._remoteFinalScore = null;
    controller._localFinalStats = null;
    controller._remoteFinalStats = null;
    controller._lastSentScore = -1;
    controller._lastSentBoardVersion = -1;
    controller._lastSentBoardCells = null;
    controller._lastSentPieceIndex = -1;
    controller._lastSentPieceX = null;
    controller._lastSentPieceY = null;
    controller._lastSentPieceRotation = null;
    controller._wasInMatch = false;
    controller._showOpponentUI();

    const game = controller.game;
    if (game.state === "idle") {
        game.screenFlow.startCountdown();
    } else {
        game.pieceController.stopAllGameplaySounds();
        game.musicDirector.stop(0);
        game.screenFlow.startCountdown();
    }
    controller._startScoreSync();
}
