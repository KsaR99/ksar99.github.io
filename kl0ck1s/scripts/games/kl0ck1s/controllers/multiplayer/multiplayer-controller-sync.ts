// @ts-nocheck
import {MESSAGE_KIND,} from "../../../../engine/net/net-constants.js";
import {
    buildBoardPacket as encodeBoardPacket,
    decodeBoardPacket as decodeBoardCellsPacket,
    packPiecePosition,
    unpackPiecePosition
} from "./multiplayer-packet-codec.js";


import type {MultiplayerController} from "../multiplayer-controller.js";
import type {MultiplayerPayload} from "./multiplayer-controller-types.js";
import {FINISHED_STATES, RUNNING_STATES, SCORE_POLL_MS} from "./multiplayer-controller-constants.js";

"use strict";

export function startScoreSync(controller: MultiplayerController) {

    controller._stopScoreSync();
    controller._pollTimer = setInterval(() => controller._pollMatchState(), SCORE_POLL_MS);
}

export function stopScoreSync(controller: MultiplayerController) {

    if (controller._pollTimer) clearInterval(controller._pollTimer);
    controller._pollTimer = null;
}

export function buildBoardPacket(controller: MultiplayerController, cells: Uint8Array) {

    const packet = encodeBoardPacket(cells, controller._lastSentBoardCells);
    controller._lastSentBoardCells = Uint8Array.from(cells);
    return packet;
}

export function packPiecePos(controller: MultiplayerController, x: number, y: number) {

    return packPiecePosition(x, y);
}

export function unpackPiecePos(controller: MultiplayerController, pos: number) {

    return unpackPiecePosition(pos);
}

export function decodeBoardPacket(controller: MultiplayerController, payload: MultiplayerPayload) {

    return decodeBoardCellsPacket(payload, controller._lastRemoteCells);
}

export function pollMatchState(controller: MultiplayerController) {

    const game = controller.game;
    const inMatch = RUNNING_STATES.has(game.state);

    if (controller.botOpponent) {
        if (game.state === "paused" || game.state === "options") controller.botOpponent.pause();
        else if (game.state === "running") controller.botOpponent.resume();
    }

    if (inMatch) {
        controller._wasInMatch = true;
        const visualConfig = {
            blockType: game.settings.blockType ?? (game.settings.asciiFallingPieces ? "ascii" : (game.settings.outlineBlocks ? "radioactive" : "colorful")),
            ghostType: game.settings.ghostType ?? "white"
        };
        const visualKey = `${visualConfig.blockType}|${visualConfig.ghostType}`;
        if (controller._lastSentVisualConfig !== visualKey) {
            controller._lastSentVisualConfig = visualKey;
            controller._sendToPeer({kind: MESSAGE_KIND.VISUAL_CONFIG, ...visualConfig});
        }
        const statsSnapshot = controller._localStatsSnapshot();
        controller._lastSentScore = statsSnapshot.score;
        controller._sendToPeer({kind: MESSAGE_KIND.STATS, ...statsSnapshot});
        controller._updateRaceMeter(statsSnapshot);
        controller._updateLiveComparison(statsSnapshot);

        if (game.board && game.state !== "clearing" && game.board.version !== controller._lastSentBoardVersion) {
            controller._lastSentBoardVersion = game.board.version;
            controller._sendToPeer(controller._buildBoardPacket(game.board.colors));
        }

        if (game.state === "running" && game.current) {
            const p = game.current;
            const isNewPiece = game.piecesSpawned !== controller._lastSentPieceIndex;
            const rotationChanged = !isNewPiece && p.rotationState !== controller._lastSentPieceRotation;
            const positionChanged = p.x !== controller._lastSentPieceX || p.y !== controller._lastSentPieceY;

            if (isNewPiece || rotationChanged) {
                controller._sendToPeer({
                    kind: MESSAGE_KIND.PIECE,
                    p: controller._packPiecePos(p.x, p.y), mask: p.mask, width: p.width, height: p.height,
                    colorIndex: p.colorIndex, pieceIndex: game.piecesSpawned, pieceType: p.type,
                    ghostY: p.y + game.board.getDropOffset(p),
                    rotationState: p.rotationState,
                    pivotX: p.pivotX, pivotY: p.pivotY,
                    rotationAngle: rotationChanged
                        ? (Math.abs(p.rotationState - controller._lastSentPieceRotation) === 2 ? 180
                            : ((p.rotationState - controller._lastSentPieceRotation + 4) % 4 === 1 ? 90 : -90))
                        : 0,
                });
                controller._lastSentPieceIndex = game.piecesSpawned;
                controller._lastSentPieceRotation = p.rotationState;
                controller._lastSentPieceX = p.x;
                controller._lastSentPieceY = p.y;
            } else if (positionChanged) {
                controller._sendToPeer({
                    kind: MESSAGE_KIND.PIECE,
                    p: controller._packPiecePos(p.x, p.y),
                    pieceIndex: game.piecesSpawned, pieceType: p.type,
                    ghostY: p.y + game.board.getDropOffset(p),
                    rotationState: p.rotationState,
                });
                controller._lastSentPieceX = p.x;
                controller._lastSentPieceY = p.y;
            }
        }
        return;
    }

    if (controller._wasInMatch && FINISHED_STATES.has(game.state) && controller._localFinalScore === null) {
        const finalSnapshot = controller._localStatsSnapshot();
        controller._localFinalScore = finalSnapshot.score;
        controller._localFinalStats = finalSnapshot;
        controller._sendToPeer({kind: MESSAGE_KIND.FINAL, ...finalSnapshot});
        controller.botOpponent?.finish();
        controller._maybeShowResult();
    }

    if (!controller._wasInMatch) return;
    if (!RUNNING_STATES.has(game.state) && !FINISHED_STATES.has(game.state)) {
        controller._wasInMatch = false;
        controller._resetSession();
    }
}

export function localStatsSnapshot(controller: MultiplayerController) {

    const game = controller.game;
    const totalClears = Object.values(game.clearCounts).reduce((sum, n) => sum + n, 0);
    const tetrisRatePercent = totalClears ? (game.clearCounts[4] / totalClears) * 100 : 0;
    const elapsedSeconds = game.elapsedMs / 1000;
    const pps = elapsedSeconds >= 1 ? game.piecesSpawned / elapsedSeconds : 0;
    const efficiencyValue = game.lines > 0 ? game.score / game.lines : 0;
    const droughtAvgValue = game.droughtCount > 0 ? game.droughtTotal / game.droughtCount : 0;
    const isTimedRaceMode = game.mode === "sprint" || game.mode === "cheeseRace";
    const linesPerLevel = game.scoring.LINES_PER_LEVEL;
    const difficultyPercent = linesPerLevel
        ? Math.floor(((game.lines % linesPerLevel) / linesPerLevel) * 100)
        : 0;

    const def = game.gameModes[game.mode];
    let raceCompleted = null;
    if (game.mode === "sprint") raceCompleted = game.lines >= def.sprintTarget;
    else if (game.mode === "cheeseRace") raceCompleted = game.lines >= def.cheeseRows;
    else if (game.mode === "digSurvival") raceCompleted = (game.modeState?.digCleared ?? 0) >= def.digTarget;

    return {
        score: game.score,
        lines: game.lines,
        elapsedMs: game.elapsedMs,
        raceCompleted,
        drought: game.drought,
        maxDrought: game.maxDrought,
        droughtTotal: game.droughtTotal,
        droughtAvg: droughtAvgValue,
        burn: game.burn,
        maxCombo: game.maxCombo,
        efficiency: efficiencyValue,
        tetrisRatePercent,
        pps,
        isTimedRaceMode,
        objective: game.modeController.objectiveText(),
        objectiveLabelKey: game.mode === "zen" ? "sidebar.height" : "sidebar.objective",
        objectivePercent: game.modeController.objectivePercent(),
        objectiveUrgency: game.modeController.objectiveUrgency(),
        objectiveColorMode: game.modeController.objectiveColorMode(),
        hasLevelProgress: game.gameModes[game.mode].noLevelBar !== true,
        difficultyTier: game.levelTier,
        difficultyLevel: game.level,
        difficultyPercent,
        hardcoreMaskRow: game.hardcoreMaskDisplayRow,
    };
}

export function onPeerMessage(controller: MultiplayerController, payload: MultiplayerPayload) {

    if (!payload || typeof payload !== "object") return;

    if (payload.kind === MESSAGE_KIND.STATS) {
        controller._updateOpponentStats(payload);
        if (!controller._remoteClearing) {
            controller._drawOpponentBoard(
                controller._lastRemoteCells,
                controller._currentRemoteLivePieceForDraw(),
                controller._currentHardDropTrailForDraw(),
                controller._currentHardDropFlashForDraw(),
            );
        }
    } else if (payload.kind === MESSAGE_KIND.FINAL) {
        controller._remoteFinalScore = payload.score;
        controller._remoteFinalStats = payload;
        controller._updateOpponentStats(payload);
        if (controller._localFinalScore === null && RUNNING_STATES.has(controller.game.state)) {
            controller.game.screenFlow.endRound("topOut");
        }
        controller._maybeShowResult();
    } else if (payload.kind === MESSAGE_KIND.CONFIG) {
        controller._applyRemoteConfig(payload.mode, payload.difficulty);
    } else if (payload.kind === MESSAGE_KIND.NAME) {
        controller._remoteName = (payload.name || "").trim() || null;
        controller._updateReadyBadges();
        controller.opponentBoard.setName(controller._remoteDisplayName());
        if (controller._opponentNameBadgeEl) controller._opponentNameBadgeEl.textContent = controller._remoteDisplayName();
        if (controller._lastRemoteStats) controller._updateOpponentStats(controller._lastRemoteStats);
    } else if (payload.kind === MESSAGE_KIND.VISUAL_CONFIG) {
        controller._remoteBlockType = payload.blockType || "colorful";
        controller._remoteGhostType = payload.ghostType || "white";
        if (controller._opponentBlockTypeEl) controller._opponentBlockTypeEl.textContent = `${controller._t("multiplayer.blockTypeLabel")}: ${payload.blockType || "—"}`;
        if (controller._opponentGhostTypeEl) controller._opponentGhostTypeEl.textContent = `${controller._t("multiplayer.ghostTypeLabel")}: ${payload.ghostType || "—"}`;
    } else if (payload.kind === MESSAGE_KIND.THEME) {
        controller._remoteTheme = payload.theme || "none";
        controller.game.themeOverlay?.setTargetTheme("opponent", controller._remoteTheme);
    } else if (payload.kind === MESSAGE_KIND.BOARD) {
        controller._setRemoteCells(controller._decodeBoardPacket(payload));
        controller._remoteLivePiece = null;
        controller._remoteLivePieceAnim = null;
        if (!controller._remoteClearing) {
            controller._drawOpponentBoard(
                controller._lastRemoteCells, null, controller._currentHardDropTrailForDraw(), controller._currentHardDropFlashForDraw(),
            );
        }
    } else if (payload.kind === MESSAGE_KIND.PIECE) {
        if (payload.cleared) {
            controller._remoteLivePiece = null;
            controller._remoteLivePieceAnim = null;
        } else {
            controller._setRemoteLivePiece(payload);
        }
        if (!controller._remoteClearing) {
            controller._drawOpponentBoard(
                controller._lastRemoteCells,
                controller._currentRemoteLivePieceForDraw(),
                controller._currentHardDropTrailForDraw(),
                controller._currentHardDropFlashForDraw(),
            );
        }
    } else if (payload.kind === MESSAGE_KIND.HARD_DROP_TRAIL) {
        if (payload.entries?.length) {
            controller._remoteHardDropTrail = {
                entries: payload.entries,
                duration: payload.duration || 260,
                startTime: performance.now(),
            };
        }
        if (payload.flashEntry) {
            controller._remoteHardDropFlash = {
                entry: payload.flashEntry,
                duration: payload.flashDuration || 220,
                startTime: performance.now(),
            };
        }
    } else if (payload.kind === MESSAGE_KIND.CLEARING) {
        if (controller._remoteClearing) {
            controller._drawOpponentClearingFrame(controller._remoteClearing, 1);
        }
        controller._setRemoteCells(payload.cells);
        controller._remoteLivePiece = null;
        controller._remoteLivePieceAnim = null;
        const lines = payload.lines || [];
        controller._remoteClearing = {
            cells: payload.cells,
            lines,
            dropRows: payload.dropRows || [],
            duration: payload.duration || 260,
            startTime: performance.now(),
            fragments: controller._buildOpponentClearFragments(payload.cells, lines),
            version: ++controller._remoteClearingVersion,
        };
    }
}
