// @ts-nocheck
import {SupabaseSignalError} from "../../net/supabase-signaling.js";


import type {MultiplayerController} from "../multiplayer-controller.js";
import type {MultiplayerPayload} from "./multiplayer-controller-types.js";
import {MAX_NEGOTIATION_AUTO_RETRIES, NEGOTIATION_RETRY_DELAY_MS} from "./multiplayer-controller-constants.js";

"use strict";

export function sendToPeer(controller: MultiplayerController, payload: MultiplayerPayload) {

    if (!controller.session?.isConnected) return;
    try {
        controller.session.send(payload);
    } catch {
        // peer likely dropped between the isConnected check and send(); the
        // "disconnected" event (already bound) will handle cleanup.
    }
}

export function t(controller: MultiplayerController, key: string, vars: Record<string, string | number> = {}) {

    return controller.i18n ? controller.i18n.t(key, vars) : key;
}

export function setStatus(controller: MultiplayerController, text: string) {

    const el = controller.overlayEl?.querySelector('[data-field="mp-status-text"]');
    if (el) el.textContent = text;
}

export function showDisconnectToast(controller: MultiplayerController) {

    if (!controller.dom) return;

    let toast = controller.dom.querySelector('[data-role="mp-disconnect-toast"]');
    if (!toast) {
        toast = controller.dom.createElement("div");
        toast.className = "mp-pause-blocked-toast";
        toast.dataset.role = "mp-disconnect-toast";
        (controller.dom.body ?? controller.dom.documentElement)?.appendChild(toast);
    }

    toast.textContent = controller._t("multiplayer.opponentDisconnected");
    toast.classList.add("mp-pause-blocked-toast--visible");

    const rematchButton = controller.dom.querySelector('[data-role="mp-result-rematch-button"]');
    if (rematchButton) rematchButton.hidden = true;

    clearTimeout(controller._disconnectToastTimer);
    controller._disconnectToastTimer = setTimeout(() => {
        toast.classList.remove("mp-pause-blocked-toast--visible");
    }, 3000);
}

export function showError(controller: MultiplayerController, err: Error | SupabaseSignalError) {

    const el = controller.overlayEl?.querySelector('[data-field="mp-error-text"]');
    if (!el) return;
    el.textContent = err?.message || controller._t("multiplayer.genericError");
    el.hidden = false;
}

export function clearError(controller: MultiplayerController) {

    const el = controller.overlayEl?.querySelector('[data-field="mp-error-text"]');
    if (el) el.hidden = true;
}

export function onNegotiationFailed(controller: MultiplayerController, err: Error | SupabaseSignalError) {

    if (controller._activePanelName === "ready" || controller._activePanelName === "result") return;

    const role = controller.role;
    const panel = role === "guest" ? "join" : role === "host" ? "host" : "role";

    if ((role === "host" || role === "guest") && controller._negotiationRetryCount < MAX_NEGOTIATION_AUTO_RETRIES) {
        controller._negotiationRetryCount += 1;
        controller._resetSession();
        controller._showPanel(panel);
        controller._showError(new Error(controller._t("multiplayer.statusRetrying", {
            attempt: controller._negotiationRetryCount,
            max: MAX_NEGOTIATION_AUTO_RETRIES,
        })));
        clearTimeout(controller._negotiationRetryTimer);
        controller._negotiationRetryTimer = setTimeout(() => {
            if (controller._activePanelName !== panel) return;
            if (role === "guest") controller._beginJoinAttempt();
            else controller._beginHostAttempt();
        }, NEGOTIATION_RETRY_DELAY_MS);
        return;
    }

    controller._negotiationRetryCount = 0;
    controller._resetSession();
    controller._showPanel(panel);
    controller._showError(err instanceof Error ? err : new Error(controller._t("multiplayer.negotiationFailed")));
}

export function resetSession(controller: MultiplayerController) {

    controller._stopScoreSync();
    controller._hideOpponentUI();
    controller._teardownBotMode();
    controller.session?.close();
    controller.session = null;

    if (controller._lobbyHost) {
        const lobbyHost = controller._lobbyHost;
        controller._lobbyHost = null;
        lobbyHost.cancel().catch(() => {
        });
    }
    if (controller._lobbyBrowse) {
        const lobbyBrowse = controller._lobbyBrowse;
        controller._lobbyBrowse = null;
        lobbyBrowse.close().catch(() => {
        });
    }
    controller._joinedRoomId = null;

    if (controller.role === "guest" && (controller._guestOriginalMode !== null || controller._guestOriginalDifficulty !== null)) {
        const game = controller.game;
        if (controller._guestOriginalMode !== null) {
            game.mode = controller._guestOriginalMode;
            game.modeController.reset();
        }
        if (controller._guestOriginalDifficulty !== null) {
            game.difficulty = controller._guestOriginalDifficulty;
            game.levelTier = controller._guestOriginalDifficulty;
            game.level = game.difficulties[controller._guestOriginalDifficulty].startLevel;
        }
        game.hud.update(game.stats);
    }
    controller._guestOriginalMode = null;
    controller._guestOriginalDifficulty = null;
    controller.role = null;
    controller.game.multiplayerConnected = false;
    controller.game.multiplayerVsBot = false;
    controller.game.runtime.stopBackgroundTicker();
    controller._remoteName = null;
    controller._remoteTheme = null;
    controller._lastSentTheme = null;
    controller._lastSentVisualConfig = null;
    controller.game.themeOverlay?.clearTargetTheme("opponent");
    controller._lastRemoteScore = 0;
    controller._lastRemoteCells = null;
    controller._remoteLivePiece = null;
    controller._remoteLivePieceAnim = null;
    controller._remoteClearing = null;
    controller._remoteHardDropTrail = null;
    controller._remoteHardDropFlash = null;
    controller._wasLocalClearing = false;
    controller._lastSentBoardVersion = -1;
    controller._lastSentBoardCells = null;
    controller._lastSentPieceIndex = -1;
    controller._lastSentPieceX = null;
    controller._lastSentPieceY = null;
    controller._lastSentPieceRotation = null;
}
