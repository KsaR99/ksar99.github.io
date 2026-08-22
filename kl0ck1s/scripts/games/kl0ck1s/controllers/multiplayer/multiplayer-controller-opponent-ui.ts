// @ts-nocheck
import {formatNumber} from "../../shared/utils.js";
import {BOARD_CONFIG} from "../../shared/config.js";

import type {MultiplayerController} from "../multiplayer-controller.js";
import type {MultiplayerPayload} from "./multiplayer-controller-types.js";

"use strict";

export function showOpponentUI(controller: MultiplayerController) {

    controller._showOpponentBadge();
    controller._showOpponentBoard();
    if (controller._remoteTheme) controller.game.themeOverlay?.setTargetTheme("opponent", controller._remoteTheme);
}

export function hideOpponentUI(controller: MultiplayerController) {

    controller._hideOpponentBadge();
    controller._hideOpponentBoard();
}

export function showOpponentBadge(controller: MultiplayerController) {

    controller._hideOpponentBadge();
    const statsCard = controller.dom.querySelector('[data-role="stats-card"]');
    const sidebar = controller.dom.querySelector(".app__sidebar.sidebar--stats");
    if (!statsCard && !sidebar) return;

    const panel = controller.dom.createElement("div");
    panel.className = "card stats mp-opponent-stats";
    panel.dataset.role = "mp-opponent-stats-card";
    panel.appendChild(controller._createLeaveButton());

    const name = controller.dom.createElement("p");
    name.className = "stats__status";
    name.dataset.role = "mp-opponent-name";
    name.textContent = controller._remoteDisplayName();
    panel.appendChild(name);

    controller._opponentScoreBadgeEl = controller._appendStatRow(panel, "sidebar.score", "mp-opponent-score-value", formatNumber(0));
    controller._opponentLinesBadgeEl = controller._appendStatRow(panel, "sidebar.lines", "mp-opponent-lines-value", "0");
    controller._opponentTrtBadgeEl = controller._appendStatRow(panel, "sidebar.tetrisRate", "mp-opponent-trt-value", "0.0%");
    controller._opponentPpsBadgeEl = controller._appendStatRow(panel, "sidebar.pps", "mp-opponent-pps-value", "0.00");
    controller._opponentDroughtBadgeEl = controller._appendStatRow(panel, "sidebar.drought", "mp-opponent-drought-value", "0");
    controller._opponentObjectiveTrackEl = controller._appendObjectiveBar(panel);
    controller._opponentDifficultyTrackEl = controller._appendDifficultyBar(panel);

    if (statsCard) statsCard.insertAdjacentElement("beforebegin", panel);
    else sidebar.prepend(panel);

    controller._opponentBadgeEl = panel;
    controller._opponentNameBadgeEl = name;
    controller._opponentBlockTypeEl = null;
    controller._opponentGhostTypeEl = null;
    controller._lastRemoteScore = 0;
    controller._lastRemoteStats = null;
}

export function appendStatRow(controller: MultiplayerController, panel: HTMLElement, titleKey: string, valueRole: string, initialText: string) {

    const row = controller.dom.createElement("div");
    row.className = "stats__row";

    const title = controller.dom.createElement("h3");
    title.className = "card__title";
    title.textContent = controller._t(titleKey);
    row.appendChild(title);

    const infoKeyByTitle = {
        "sidebar.score": "statsInfo.score",
        "sidebar.lines": "statsInfo.lines",
        "sidebar.tetrisRate": "statsInfo.tetrisRate",
        "sidebar.pps": "statsInfo.pps",
        "sidebar.drought": "statsInfo.drought",
    };
    const infoKey = infoKeyByTitle[titleKey];
    if (infoKey) {
        const info = controller.dom.createElement("button");
        info.className = "stat-info";
        info.type = "button";
        info.dataset.statInfo = "";
        info.textContent = "i";
        info.title = controller._t(infoKey);
        info.setAttribute("aria-label", controller._t("statsInfo.infoLabel") || "Info");
        row.appendChild(info);
    }

    const value = controller.dom.createElement("div");
    value.className = "stats__value";
    value.dataset.role = valueRole;
    value.textContent = initialText;
    row.appendChild(value);

    panel.appendChild(row);
    return value;
}

export function appendObjectiveBar(controller: MultiplayerController, panel: HTMLElement) {

    const wrap = controller.dom.createElement("div");
    wrap.dataset.role = "mp-opponent-objective-stat";
    wrap.classList.add("stats__row--hidden");

    const track = controller.dom.createElement("div");
    track.className = "progress-bar progress-bar--objective";
    track.dataset.role = "mp-opponent-objective-track";

    const fill = controller.dom.createElement("div");
    fill.className = "progress-bar__fill";
    fill.dataset.role = "mp-opponent-objective-fill";

    const label = controller.dom.createElement("div");
    label.className = "progress-bar__label";
    label.dataset.role = "mp-opponent-objective-value";
    label.textContent = "—";

    track.appendChild(fill);
    track.appendChild(label);
    const info = controller.dom.createElement("button");
    info.className = "stat-info stat-info--overlay";
    info.type = "button";
    info.dataset.statInfo = "";
    info.textContent = "i";
    info.title = controller._t("statsInfo.objective");
    info.setAttribute("aria-label", controller._t("statsInfo.infoLabel") || "Info");
    track.appendChild(info);
    wrap.appendChild(track);
    panel.appendChild(wrap);

    controller._opponentObjectiveWrapEl = wrap;
    controller._opponentObjectiveFillEl = fill;
    controller._opponentObjectiveLabelEl = label;
    return track;
}

export function appendDifficultyBar(controller: MultiplayerController, panel: HTMLElement) {

    const wrap = controller.dom.createElement("div");
    wrap.className = "difficulty-indicator";
    wrap.dataset.role = "mp-opponent-difficulty-stat";

    const track = controller.dom.createElement("div");
    track.className = "progress-bar progress-bar--difficulty";

    const fill = controller.dom.createElement("div");
    fill.className = "progress-bar__fill";
    fill.dataset.role = "mp-opponent-difficulty-fill";

    const label = controller.dom.createElement("div");
    label.className = "progress-bar__label";
    label.dataset.role = "mp-opponent-difficulty-value";
    label.textContent = "—";

    track.appendChild(fill);
    track.appendChild(label);
    wrap.appendChild(track);
    panel.appendChild(wrap);

    controller._opponentDifficultyFillEl = fill;
    controller._opponentDifficultyLabelEl = label;
    return track;
}

export function createLeaveButton(controller: MultiplayerController) {

    const button = controller.dom.createElement("button");
    button.type = "button";
    button.className = "mp-leave-button";
    button.dataset.role = "mp-leave-inline-button";
    button.setAttribute("aria-label", controller._t("multiplayer.leaveButton"));
    button.textContent = "❌";
    button.addEventListener("click", () => controller._leaveMatch());
    return button;
}

export function hideOpponentBadge(controller: MultiplayerController) {

    controller._opponentBadgeEl?.remove();
    controller._opponentBadgeEl = null;
    controller._opponentNameBadgeEl = null;
    controller._opponentBlockTypeEl = null;
    controller._opponentGhostTypeEl = null;
    controller._opponentObjectiveWrapEl = null;
    controller._opponentObjectiveFillEl = null;
    controller._opponentObjectiveLabelEl = null;
    controller._opponentObjectiveTrackEl = null;
    controller._opponentScoreBadgeEl = null;
    controller._opponentLinesBadgeEl = null;
    controller._opponentTrtBadgeEl = null;
    controller._opponentPpsBadgeEl = null;
    controller._opponentDroughtBadgeEl = null;
    controller._opponentDifficultyTrackEl = null;
    controller._opponentDifficultyFillEl = null;
    controller._opponentDifficultyLabelEl = null;
    controller._clearLiveComparisonColors();
}

export function updateOpponentStats(controller: MultiplayerController, payload: MultiplayerPayload) {

    controller._lastRemoteScore = payload.score ?? 0;
    controller._lastRemoteStats = payload;

    const hasObjective = payload.objective !== null && payload.objective !== undefined;
    if (controller._opponentObjectiveWrapEl) controller._opponentObjectiveWrapEl.classList.toggle("stats__row--hidden", !hasObjective);
    if (hasObjective) {
        if (controller._opponentObjectiveLabelEl) {
            controller._opponentObjectiveLabelEl.textContent = `${controller._t(payload.objectiveLabelKey ?? "sidebar.objective")}: ${payload.objective}`;
        }

        const percent = payload.objectivePercent;
        if (controller._opponentObjectiveFillEl) {
            if (percent !== null && percent !== undefined) {
                controller._opponentObjectiveFillEl.style.width = `${percent}%`;
                controller._opponentObjectiveFillEl.style.backgroundColor = payload.objectiveColorMode === "ramp"
                    ? `color-mix(in oklch, var(--accent-2) ${100 - percent}%, var(--good) ${percent}%)`
                    : "";
            } else {
                controller._opponentObjectiveFillEl.style.width = "0%";
                controller._opponentObjectiveFillEl.style.backgroundColor = "";
            }
        }

        if (controller._opponentObjectiveTrackEl) {
            controller._opponentObjectiveTrackEl.dataset.urgency = payload.objectiveUrgency ?? "";
        }
    }

    if (controller._opponentScoreBadgeEl) controller._opponentScoreBadgeEl.textContent = formatNumber(payload.score ?? 0);
    if (controller._opponentLinesBadgeEl) controller._opponentLinesBadgeEl.textContent = String(payload.lines ?? 0);
    if (controller._opponentTrtBadgeEl) controller._opponentTrtBadgeEl.textContent = `${(payload.tetrisRatePercent ?? 0).toFixed(1)}%`;
    if (controller._opponentPpsBadgeEl) controller._opponentPpsBadgeEl.textContent = (payload.pps ?? 0).toFixed(2);
    if (controller._opponentDroughtBadgeEl) controller._opponentDroughtBadgeEl.textContent = String(payload.drought ?? 0);
    if (controller._opponentBlockTypeEl) controller._opponentBlockTypeEl.textContent = `${controller._t("multiplayer.blockTypeLabel")}: ${payload.blockType ?? "—"}`;
    if (controller._opponentGhostTypeEl) controller._opponentGhostTypeEl.textContent = `${controller._t("multiplayer.ghostTypeLabel")}: ${payload.ghostType ?? "—"}`;

    const hasLevelProgress = payload.hasLevelProgress !== false && payload.difficultyTier !== undefined;
    if (controller._opponentDifficultyTrackEl) {
        controller._opponentDifficultyTrackEl.classList.toggle("progress-bar--no-fill", !hasLevelProgress);
    }
    if (payload.difficultyTier !== undefined) {
        if (controller._opponentDifficultyLabelEl) {
            controller._opponentDifficultyLabelEl.textContent = `${controller._t(`difficulty.${payload.difficultyTier}`)} ${payload.difficultyLevel ?? 1}`;
        }
        if (controller._opponentDifficultyFillEl && payload.difficultyPercent !== undefined) {
            controller._opponentDifficultyFillEl.style.width = `${payload.difficultyPercent}%`;
        }
    }

    controller._updateLiveComparison();
}

export function updateLiveComparison(controller: MultiplayerController, localSnapshot: MultiplayerPayload | null = null) {

    const remote = controller._lastRemoteStats;
    if (!remote || !controller._opponentBadgeEl) return;
    const local = localSnapshot ?? controller._localStatsSnapshot();

    const pair = (localEl, remoteEl, localRaw, remoteRaw, lowerBetter = false) => {
        if (!localEl && !remoteEl) return;
        localEl?.classList.remove("stats__value--better", "stats__value--worse");
        remoteEl?.classList.remove("stats__value--better", "stats__value--worse");
        if (localRaw === remoteRaw) return;
        const localIsBetter = lowerBetter ? localRaw < remoteRaw : localRaw > remoteRaw;
        localEl?.classList.add(localIsBetter ? "stats__value--better" : "stats__value--worse");
        remoteEl?.classList.add(localIsBetter ? "stats__value--worse" : "stats__value--better");
    };

    const dom = controller.dom;
    pair(dom.getElementById("score-value"), controller._opponentScoreBadgeEl, local.score, remote.score ?? 0);
    pair(dom.getElementById("lines-value"), controller._opponentLinesBadgeEl, local.lines, remote.lines ?? 0);
    pair(dom.getElementById("trt-value"), controller._opponentTrtBadgeEl, local.tetrisRatePercent, remote.tetrisRatePercent ?? 0);
    pair(dom.getElementById("pps-value"), controller._opponentPpsBadgeEl, local.pps, remote.pps ?? 0);
    pair(dom.getElementById("drought-value"), controller._opponentDroughtBadgeEl, local.drought, remote.drought ?? 0, true);
}

export function clearLiveComparisonColors(controller: MultiplayerController) {

    const dom = controller.dom;
    ["score-value", "lines-value", "trt-value", "pps-value", "drought-value"].forEach((id) => {
        dom?.getElementById(id)?.classList.remove("stats__value--better", "stats__value--worse");
    });
}

export function raceMetric(controller: MultiplayerController, stats: MultiplayerPayload) {

    if (["sprint", "cheeseRace", "digSurvival"].includes(controller.game.mode)) return stats.lines ?? 0;
    return stats.score ?? 0;
}

export function updateRaceMeter(controller: MultiplayerController, localStats: MultiplayerPayload) {

    if (!controller.opponentBoard.raceMeterFillEl) return;
    const remoteStats = controller._lastRemoteStats;
    if (!remoteStats) {
        controller.opponentBoard.resetRaceMeter();
        return;
    }
    const local = controller._raceMetric(localStats);
    const remote = controller._raceMetric(remoteStats);
    const total = local + remote;
    const percent = total === 0 ? 50 : 50 + 50 * (local - remote) / total;
    controller.opponentBoard.updateRaceMeter(percent);
}

export function showOpponentBoard(controller: MultiplayerController) {

    controller.opponentBoard.show(
        controller._localDisplayName(),
        controller._remoteDisplayName(),
        {
            onLayoutResize: () => controller._notifyLayoutResize(),
            draw: () => controller._drawOpponentBoard(controller._lastRemoteCells, controller._remoteLivePiece),
        }
    );
}

export function hideOpponentBoard(controller: MultiplayerController) {

    controller.opponentBoard.hide(() => controller._notifyLayoutResize());
}

export function notifyLayoutResize(controller: MultiplayerController) {

    const target = globalThis.visualViewport ?? globalThis.window ?? null;
    target?.dispatchEvent(new Event("resize"));
}

export function remoteDisplayName(controller: MultiplayerController) {

    return controller._remoteName || controller._t("multiplayer.opponentFallback");
}

export function localDisplayName(controller: MultiplayerController) {

    return controller.game.playerName || controller._t("leaderboard.defaultName");
}

export function buildOpponentClearFragments(controller: MultiplayerController, cells: Uint8Array, lineIndices: number[]) {

    return controller.opponentBoard.buildClearFragments(cells, lineIndices);
}

export function drawOpponentBoard(controller: MultiplayerController, cells: Uint8Array, livePiece: MultiplayerPayload | null = null, hardDropTrail: JsonValue[] | null = null, hardDropFlash: JsonValue | null = null) {

    controller.opponentBoard.draw(
        cells, controller._remoteBoardVersion, livePiece, hardDropTrail, hardDropFlash,
        controller._lastRemoteStats?.hardcoreMaskRow ?? null, controller.game.activeTheme,
    );
}

export function currentHardDropTrailForDraw(controller: MultiplayerController) {

    const trail = controller._remoteHardDropTrail;
    if (!trail || !controller.game.settings.fallTrail) return null;

    const progress = (performance.now() - trail.startTime) / trail.duration;
    if (progress >= 1) {
        controller._remoteHardDropTrail = null;
        return null;
    }

    return {entries: trail.entries, progress};
}

export function currentHardDropFlashForDraw(controller: MultiplayerController) {

    const flash = controller._remoteHardDropFlash;
    if (!flash || !controller.game.settings.hardDropFlash) return null;

    const progress = (performance.now() - flash.startTime) / flash.duration;
    if (progress >= 1) {
        controller._remoteHardDropFlash = null;
        return null;
    }

    return {entry: flash.entry, progress};
}

export function renderRemoteClearingFrame(controller: MultiplayerController) {

    const rc = controller._remoteClearing;
    const progress = (performance.now() - rc.startTime) / rc.duration;

    if (progress >= 1) {
        controller._setRemoteCells(controller._computeOpponentPostClearCells(rc));
        controller._remoteClearing = null;
        controller._drawOpponentBoard(controller._lastRemoteCells, controller._remoteLivePiece);
        return;
    }

    controller._drawOpponentClearingFrame(rc, progress);
}

export function computeOpponentPostClearCells(controller: MultiplayerController, rc: MultiplayerPayload) {

    const {COLS, ROWS} = BOARD_CONFIG;
    const lineSet = new Set(rc.lines);
    const result = new Uint8Array(COLS * ROWS);

    for (let y = 0; y < ROWS; y++) {
        if (lineSet.has(y)) continue;
        const targetY = y + (rc.dropRows[y] || 0);
        if (targetY < 0 || targetY >= ROWS) continue;
        for (let x = 0; x < COLS; x++) {
            result[targetY * COLS + x] = rc.cells[y * COLS + x];
        }
    }

    return result;
}

export function drawOpponentClearingFrame(controller: MultiplayerController, rc: MultiplayerPayload, progress: number) {

    controller.opponentBoard.drawClearingFrame(rc, progress);
}
