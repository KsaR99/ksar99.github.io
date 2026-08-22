// @ts-nocheck
import {formatNumber} from "../../shared/utils.js";

import type {MultiplayerController} from "../multiplayer-controller.js";
import type {MultiplayerPayload} from "./multiplayer-controller-types.js";
import {
    REMOTE_PIECE_LERP_MAX_MS,
    REMOTE_PIECE_LERP_MIN_MS,
    RESULT_STAT_ROWS
} from "./multiplayer-controller-constants.js";

"use strict";

export function setRemoteLivePiece(controller: MultiplayerController, payload: MultiplayerPayload) {

    const now = performance.now();
    const prevTarget = controller._remoteLivePiece;
    const prevAnim = controller._remoteLivePieceAnim;

    const decoded = payload.p !== undefined
        ? controller._unpackPiecePos(payload.p)
        : (payload.x !== undefined ? {x: payload.x, y: payload.y} : null);
    const x = decoded?.x ?? prevTarget?.x ?? 0;
    const y = decoded?.y ?? prevTarget?.y ?? 0;
    const mask = payload.mask ?? prevTarget?.mask;
    const width = payload.width ?? prevTarget?.width;
    const height = payload.height ?? prevTarget?.height;
    const colorIndex = payload.colorIndex ?? prevTarget?.colorIndex;
    const pieceIndex = payload.pieceIndex ?? prevTarget?.pieceIndex;
    const pivotX = payload.pivotX ?? prevTarget?.pivotX ?? (width === 4 ? 1.5 : width === 2 ? 0.5 : 1);
    const pivotY = payload.pivotY ?? prevTarget?.pivotY ?? (height === 4 ? 1.5 : height === 2 ? 0.5 : 1);
    const rotationAngle = Number(payload.rotationAngle) || 0;
    const samePiece = !!prevTarget && prevTarget.pieceIndex === pieceIndex;

    let fromX = x;
    let fromY = y;
    if (samePiece && prevAnim) {
        const t = prevAnim.duration > 0
            ? Math.min(1, (now - prevAnim.startTime) / prevAnim.duration)
            : 1;
        const eased = t * t * (3 - 2 * t);
        fromX = prevAnim.fromX + (prevAnim.toX - prevAnim.fromX) * eased;
        fromY = prevAnim.fromY + (prevAnim.toY - prevAnim.fromY) * eased;
    }

    const activeRotation = samePiece && prevAnim?.rotationAngle && prevAnim.duration > 0
        && now - prevAnim.startTime < prevAnim.duration;
    const isRotation = samePiece && rotationAngle !== 0 && prevTarget?.mask != null && prevTarget.mask !== mask;
    const duration = isRotation
        ? (Math.abs(rotationAngle) >= 180 ? 140 : 90)
        : activeRotation
            ? Math.max(0, prevAnim.duration - (now - prevAnim.startTime))
            : samePiece
                ? Math.min(Math.max(prevAnim?.duration ?? 16, REMOTE_PIECE_LERP_MIN_MS), REMOTE_PIECE_LERP_MAX_MS)
                : 0;

    controller._remoteLivePiece = {x, y, mask, width, height, colorIndex, pieceIndex, pivotX, pivotY};
    controller._remoteLivePieceAnim = {
        fromX, fromY,
        toX: x, toY: y,
        fromMask: isRotation ? prevTarget.mask : (activeRotation ? prevAnim.fromMask : mask),
        toMask: mask,
        mask, width, height, colorIndex, pivotX, pivotY,
        rotationAngle: isRotation
            ? rotationAngle
            : activeRotation
                ? prevAnim.rotationAngle
                : 0,
        startTime: now,
        duration,
    };
}

export function currentRemoteLivePieceForDraw(controller: MultiplayerController) {

    const anim = controller._remoteLivePieceAnim;
    if (!anim) return controller._remoteLivePiece;

    const t = anim.duration > 0
        ? Math.min(1, (performance.now() - anim.startTime) / anim.duration)
        : 1;
    const eased = t * t * (3 - 2 * t);
    const finished = t >= 1;

    return {
        x: anim.fromX + (anim.toX - anim.fromX) * eased,
        y: anim.fromY + (anim.toY - anim.fromY) * eased,
        mask: anim.toMask,
        renderMask: finished ? null : anim.fromMask,
        width: anim.width,
        height: anim.height,
        colorIndex: anim.colorIndex,
        pivotX: anim.pivotX,
        pivotY: anim.pivotY,
        renderAngle: finished ? 0 : anim.rotationAngle * eased,
    };
}

export function setRemoteCells(controller: MultiplayerController, cells: Uint8Array) {

    controller._lastRemoteCells = cells;
    controller._remoteBoardVersion++;
}

export function maybeShowResult(controller: MultiplayerController) {

    if (controller._localFinalScore === null || controller._remoteFinalScore === null) return;
    if (controller._localFinalStats === null || controller._remoteFinalStats === null) return;

    controller._stopScoreSync();
    controller.session?.setReady(false);
    controller._hideOpponentUI();
    controller._showResultPanel();
}

export function hideResultPanel(controller: MultiplayerController) {

    const panel = controller.dom?.querySelector('[data-role="mp-panel-result"]');
    if (panel) {
        panel.hidden = true;
        panel.style.display = "none";
        const parent = controller._resultPanelOriginalParent;
        const nextSibling = controller._resultPanelOriginalNextSibling;
        if (parent && panel.parentElement !== parent) {
            if (nextSibling && nextSibling.parentNode === parent) parent.insertBefore(panel, nextSibling);
            else parent.appendChild(panel);
        }
    }
    controller._updateSteps(controller._activePanelName);
    controller._resultPanelEl = null;
    controller._resultPanelOriginalParent = null;
    controller._resultPanelOriginalNextSibling = null;
}

export function showResultPanel(controller: MultiplayerController) {

    const panel = controller.dom?.querySelector('[data-role="mp-panel-result"]');
    const local = controller._localFinalStats;
    const remote = controller._remoteFinalStats;
    if (!panel || !local || !remote) return;

    const localScore = local.score ?? 0;
    const remoteScore = remote.score ?? 0;

    const isRaceMode = controller.game.mode === "sprint" || controller.game.mode === "cheeseRace";
    let resultKey;
    if (isRaceMode && (local.raceCompleted || remote.raceCompleted)) {
        if (local.raceCompleted && remote.raceCompleted) {
            resultKey = local.elapsedMs === remote.elapsedMs
                ? "draw"
                : local.elapsedMs < remote.elapsedMs ? "win" : "loss";
        } else {
            resultKey = local.raceCompleted ? "win" : "loss";
        }
    } else {
        resultKey = localScore === remoteScore
            ? "draw"
            : localScore > remoteScore ? "win" : "loss";
    }

    const set = (role, value) => {
        const el = panel.querySelector(`[data-role="${role}"]`);
        if (el) el.textContent = value;
        return el;
    };

    const colorPair = (localEl, remoteEl, localRaw, remoteRaw, lowerBetter) => {
        localEl?.classList.remove("mp-result-stat__value--better", "mp-result-stat__value--worse");
        remoteEl?.classList.remove("mp-result-stat__value--better", "mp-result-stat__value--worse");
        if (localRaw === remoteRaw) return;
        const localIsBetter = lowerBetter ? localRaw < remoteRaw : localRaw > remoteRaw;
        localEl?.classList.add(localIsBetter ? "mp-result-stat__value--better" : "mp-result-stat__value--worse");
        remoteEl?.classList.add(localIsBetter ? "mp-result-stat__value--worse" : "mp-result-stat__value--better");
    };

    const localName = controller.game.playerName || controller._t("leaderboard.defaultName");
    const remoteName = controller._remoteDisplayName();
    const titleKey = resultKey === "draw" ? "multiplayer.draw" : resultKey === "win" ? "multiplayer.won" : "multiplayer.lost";

    const titleEl = set("mp-result-title", controller._t(titleKey));
    titleEl?.classList.remove("mp-result-panel__title--win", "mp-result-panel__title--loss", "mp-result-panel__title--draw");
    titleEl?.classList.add(`mp-result-panel__title--${resultKey}`);

    set("mp-result-local-name", localName);
    set("mp-result-remote-name", remoteName);
    set("mp-result-local-name-mini", localName);
    set("mp-result-remote-name-mini", remoteName);

    const localScoreEl = set("mp-result-local-score", formatNumber(localScore));
    const remoteScoreEl = set("mp-result-remote-score", formatNumber(remoteScore));
    colorPair(localScoreEl, remoteScoreEl, localScore, remoteScore, false);

    for (const {role, raw, display, lowerBetter} of RESULT_STAT_ROWS) {
        const localRaw = raw(local);
        const remoteRaw = raw(remote);
        const localEl = set(`mp-result-local-${role}`, display(localRaw));
        const remoteEl = set(`mp-result-remote-${role}`, display(remoteRaw));
        colorPair(localEl, remoteEl, localRaw, remoteRaw, lowerBetter);
    }

    const steps = controller.dom?.querySelector('[data-role="mp-steps"]');
    const caption = controller.dom?.querySelector('[data-field="mp-step-caption"]');
    if (steps) steps.hidden = true;
    if (caption) caption.hidden = true;

    Object.entries(controller.panels).forEach(([key, el]) => {
        if (el && key !== "result") el.hidden = true;
    });

    const rematchButton = panel.querySelector('[data-role="mp-result-rematch-button"]');
    if (rematchButton) rematchButton.hidden = false;

    const overlay = controller.overlayEl;
    const hudOverlay = controller.game.hud?.overlayEl;
    if (hudOverlay && panel.parentElement !== hudOverlay) {
        controller._resultPanelOriginalParent = panel.parentElement;
        controller._resultPanelOriginalNextSibling = panel.nextSibling;
        hudOverlay.replaceChildren(panel);
    }
    panel.classList.add("screen", "screen--menu", "mp-result-screen");
    panel.style.display = "";
    panel.hidden = false;
    controller._resultPanelEl = panel;
    if (hudOverlay) {
        hudOverlay.classList.add("board__overlay--visible");
        hudOverlay.classList.remove("board__overlay--transparent");
    }
    if (overlay) {
        overlay.classList.remove("mp-overlay--visible", "mp-overlay--screen");
        overlay.hidden = true;
    }
}

export function rematchInternal(controller: MultiplayerController) {

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
    controller._lastRemoteCells = null;
    controller._remoteLivePiece = null;
    controller._remoteLivePieceAnim = null;
    controller._remoteClearing = null;

    if (controller.game.state === "gameOver-entry") {
        controller.game.settings.mode = controller.game.mode;
        controller.game.screenFlow.continueFromGameOverEntry();
    }

    if (controller.role === "bot") {
        const difficulty = controller._botDifficultyKey;
        if (difficulty) controller._beginBot(difficulty);
        return;
    }

    if (!controller.session?.isConnected) return;

    controller._showPanel("ready");
    controller.session.setReady(true);
}

export function closeResult(controller: MultiplayerController) {

    controller._hideResultPanel();
    controller._resetSession();
    controller.close();
}

export function leaveMatchInternal(controller: MultiplayerController) {

    const game = controller.game;
    const wasBot = controller.role === "bot";
    game.pieceController.stopAllGameplaySounds();
    game.musicDirector.stop(0);
    controller._hideResultPanel();
    controller._resetSession();

    if (wasBot) {
        game.screenFlow.showIdleScreen().then(() => controller.open());
        return;
    }

    controller.close();
    game.screenFlow.showIdleScreen().then();
}

export function leaveMatch(controller: MultiplayerController) {

    controller._leaveMatch();
}

export function restartBotMatch(controller: MultiplayerController) {

    if (controller.role !== "bot" || !controller._botDifficultyKey) return;
    controller._beginBot(controller._botDifficultyKey);
}

export function rematch(controller: MultiplayerController) {

    if (!controller.isResultPanelVisible) return;
    controller._rematch();
}
