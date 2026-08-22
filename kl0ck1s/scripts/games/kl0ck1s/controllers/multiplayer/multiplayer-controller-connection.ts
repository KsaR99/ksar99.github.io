// @ts-nocheck
import {MultiplayerSession} from "../../../../engine/net/index.js";
import {browseLobby, hostOpenLobby, requestJoinRoom, SupabaseSignalError} from "../../net/supabase-signaling.js";

import type {MultiplayerController} from "../multiplayer-controller.js";
import type {MultiplayerJoinRequest} from "./multiplayer-controller-types.js";

"use strict";

export async function beginHost(controller: MultiplayerController) {

    const hostButton = controller.overlayEl?.querySelector('[data-role="mp-host-button"]');
    if (hostButton?.disabled) return;

    clearTimeout(controller._negotiationRetryTimer);
    controller._negotiationRetryTimer = null;
    controller._negotiationRetryCount = 0;

    await controller._beginHostAttempt();
}

export async function beginHostAttempt(controller: MultiplayerController) {

    const hostButton = controller.overlayEl?.querySelector('[data-role="mp-host-button"]');

    controller._clearError();
    controller._resetSession();
    controller.role = "host";
    controller.session = MultiplayerSession.createHost();
    controller._bindSessionEvents();
    controller._showPanel("host");

    const root = controller.overlayEl;
    const waitText = root?.querySelector('[data-field="mp-host-wait-text"]');
    const list = root?.querySelector('[data-role="mp-host-requests-list"]');
    const empty = root?.querySelector('[data-field="mp-host-requests-empty"]');
    if (list) list.innerHTML = "";
    if (empty) empty.hidden = false;
    if (waitText) {
        waitText.textContent = controller._t("multiplayer.waitingForGuest");
        waitText.hidden = false;
    }
    if (hostButton) hostButton.disabled = true;

    controller._connectInFlight = true;
    try {
        controller._lobbyHost = await hostOpenLobby(controller.game.playerName || "", {
            onJoinRequest: (req) => controller._onJoinRequestReceived(req),
        });
    } catch (err) {
        controller._onNegotiationFailed(controller._mapSignalError(err));
    } finally {
        controller._connectInFlight = false;
        if (hostButton) hostButton.disabled = false;
    }
}

export function onJoinRequestReceived(controller: MultiplayerController, req: MultiplayerJoinRequest) {

    const list = controller.overlayEl?.querySelector('[data-role="mp-host-requests-list"]');
    if (!list || list.querySelector(`[data-request-id="${req.requestId}"]`)) return;

    const empty = controller.overlayEl?.querySelector('[data-field="mp-host-requests-empty"]');
    if (empty) empty.hidden = true;

    const item = controller.dom.createElement("li");
    item.className = "mp-request-item";
    item.dataset.requestId = req.requestId;

    const name = controller.dom.createElement("span");
    name.className = "mp-request-item__name";
    name.textContent = req.guestName || controller._t("multiplayer.guestFallback");
    item.appendChild(name);

    const actions = controller.dom.createElement("span");
    actions.className = "mp-request-item__actions";

    const acceptButton = controller.dom.createElement("button");
    acceptButton.type = "button";
    acceptButton.className = "button button--accent mp-request-item__accept";
    acceptButton.textContent = controller._t("multiplayer.acceptButton");
    acceptButton.addEventListener("click", () => controller._onAcceptRequest(req.requestId));

    const declineButton = controller.dom.createElement("button");
    declineButton.type = "button";
    declineButton.className = "button button--primary mp-request-item__decline";
    declineButton.textContent = controller._t("multiplayer.declineButton");
    declineButton.addEventListener("click", () => controller._onDeclineRequest(req.requestId));

    actions.appendChild(acceptButton);
    actions.appendChild(declineButton);
    item.appendChild(actions);
    list.appendChild(item);
}

export function onDeclineRequest(controller: MultiplayerController, requestId: string) {

    controller._lobbyHost?.decline(requestId).catch(() => {
    });
    controller.overlayEl?.querySelector(`[data-request-id="${requestId}"]`)?.remove();
}

export async function onAcceptRequest(controller: MultiplayerController, requestId: string) {

    if (!controller._lobbyHost || controller._connectInFlight) return;

    const root = controller.overlayEl;
    const waitText = root?.querySelector('[data-field="mp-host-wait-text"]');
    root?.querySelectorAll('[data-role="mp-host-requests-list"] button')
        .forEach((button) => (button.disabled = true));
    if (waitText) waitText.textContent = controller._t("multiplayer.statusConnecting");

    const lobbyHost = controller._lobbyHost;
    controller._connectInFlight = true;
    try {
        await lobbyHost.accept(requestId, controller.session);
        controller._lobbyHost = null;
    } catch (err) {
        controller._lobbyHost = null;
        controller._onNegotiationFailed(controller._mapSignalError(err));
    } finally {
        controller._connectInFlight = false;
    }
}

export async function beginJoin(controller: MultiplayerController) {

    clearTimeout(controller._negotiationRetryTimer);
    controller._negotiationRetryTimer = null;
    controller._negotiationRetryCount = 0;

    await controller._beginJoinAttempt();
}

export async function beginJoinAttempt(controller: MultiplayerController) {

    controller._clearError();
    controller._resetSession();
    controller.role = "guest";
    controller.session = MultiplayerSession.createGuest();
    controller._bindSessionEvents();
    controller._showPanel("join");
    controller._joinedRoomId = null;

    const root = controller.overlayEl;
    const list = root?.querySelector('[data-role="mp-join-rooms-list"]');
    const empty = root?.querySelector('[data-field="mp-join-rooms-empty"]');
    const listWrap = root?.querySelector('[data-role="mp-join-rooms-wrap"]');
    const waitText = root?.querySelector('[data-field="mp-join-wait-text"]');
    if (list) list.innerHTML = "";
    if (empty) empty.hidden = false;
    if (listWrap) listWrap.hidden = false;
    if (waitText) waitText.hidden = true;

    controller._connectInFlight = true;
    try {
        controller._lobbyBrowse = await browseLobby({
            onRoomOpened: (room) => controller._onRoomOpened(room),
            onRoomClosed: (roomId) => controller._onRoomClosed(roomId),
        });
    } catch (err) {
        controller._onNegotiationFailed(controller._mapSignalError(err));
    } finally {
        controller._connectInFlight = false;
    }
}

export function onRoomOpened(controller: MultiplayerController, room: string) {

    if (controller._joinedRoomId) return;
    const list = controller.overlayEl?.querySelector('[data-role="mp-join-rooms-list"]');
    if (!list || list.querySelector(`[data-room-id="${room.roomId}"]`)) return;

    const empty = controller.overlayEl?.querySelector('[data-field="mp-join-rooms-empty"]');
    if (empty) empty.hidden = true;

    const item = controller.dom.createElement("li");
    item.className = "mp-room-item";
    item.dataset.roomId = room.roomId;

    const name = controller.dom.createElement("span");
    name.className = "mp-room-item__name";
    name.textContent = room.hostName || controller._t("multiplayer.hostFallback");
    item.appendChild(name);

    const joinButton = controller.dom.createElement("button");
    joinButton.type = "button";
    joinButton.className = "button button--accent mp-room-item__join";
    joinButton.textContent = controller._t("multiplayer.requestJoinButton");
    joinButton.addEventListener("click", () => controller._onRequestJoin(room.roomId, room.hostName));
    item.appendChild(joinButton);

    list.appendChild(item);
}

export function onRoomClosed(controller: MultiplayerController, roomId: string) {

    controller.overlayEl?.querySelector(`[data-room-id="${roomId}"]`)?.remove();
    const list = controller.overlayEl?.querySelector('[data-role="mp-join-rooms-list"]');
    const empty = controller.overlayEl?.querySelector('[data-field="mp-join-rooms-empty"]');
    if (list && empty) empty.hidden = list.children.length > 0;
}

export async function onRequestJoin(controller: MultiplayerController, roomId: string, hostName: string) {

    if (controller._joinedRoomId || controller._connectInFlight) return;
    controller._joinedRoomId = roomId;

    const root = controller.overlayEl;
    const listWrap = root?.querySelector('[data-role="mp-join-rooms-wrap"]');
    if (listWrap) listWrap.hidden = true;
    const waitText = root?.querySelector('[data-field="mp-join-wait-text"]');
    if (waitText) {
        waitText.textContent = controller._t("multiplayer.waitingForHost", {
            name: hostName || controller._t("multiplayer.hostFallback"),
        });
        waitText.hidden = false;
    }

    await controller._lobbyBrowse?.close().catch(() => {
    });
    controller._lobbyBrowse = null;

    controller._connectInFlight = true;
    try {
        await requestJoinRoom(roomId, controller.game.playerName || "", controller.session, {
            onAccepted: () => {
                if (waitText) waitText.textContent = controller._t("multiplayer.statusConnecting");
            },
        });
    } catch (err) {
        controller._joinedRoomId = null;
        controller._onNegotiationFailed(controller._mapSignalError(err));
    } finally {
        controller._connectInFlight = false;
    }
}

export function mapSignalError(controller: MultiplayerController, err: Error | SupabaseSignalError) {

    if (!(err instanceof SupabaseSignalError)) return err;
    if (err.code === "declined") return new Error(controller._t("multiplayer.hostDeclined"));
    if (err.code === "timeout" && controller.role === "guest") return new Error(controller._t("multiplayer.hostNoResponse"));
    return new Error(controller._t("multiplayer.genericError"));
}
