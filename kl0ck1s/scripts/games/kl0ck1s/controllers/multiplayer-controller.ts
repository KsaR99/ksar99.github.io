// @ts-nocheck
import type {Game} from "../game/game.js";
import type {I18n} from "../services/i18n.js";
import {MultiplayerSession} from "../../../engine/net/index.js";
import {SupabaseSignalError} from "../net/supabase-signaling.js";
import {BotOpponent} from "../ai/bot-opponent.js";
import {OpponentBoardView} from "./multiplayer/opponent-board-view.js";
import {PieceBag} from "../game/piece-bag.js";

import {BOT_DIFFICULTY_ORDER} from "./multiplayer/multiplayer-controller-constants.js";
import {
    applyRemoteConfig,
    changeBotLevel,
    changeMatchDifficulty,
    changeMatchMode,
    close,
    frameTick,
    notifyHardDropTrail,
    notifyLockImpactFlash,
    notifyThemeChanged,
    onKeydown,
    open,
    renderConfigPanels,
    sendConfigIfHost,
    showPanel,
    startFrameLoop,
    syncBotDifficultySlider,
    syncPanelGroupFocus,
    updateSteps
} from "./multiplayer/multiplayer-controller-ui.js";
import {
    beginHost,
    beginHostAttempt,
    beginJoin,
    beginJoinAttempt,
    mapSignalError,
    onAcceptRequest,
    onDeclineRequest,
    onJoinRequestReceived,
    onRequestJoin,
    onRoomClosed,
    onRoomOpened
} from "./multiplayer/multiplayer-controller-connection.js";
import {beginBot, startBotWhenRunning, teardownBotMode} from "./multiplayer/multiplayer-controller-bot.js";
import {
    bindSessionEvents,
    hostStart,
    launchMatch,
    toggleReady,
    updateReadyBadges
} from "./multiplayer/multiplayer-controller-session.js";
import {
    buildBoardPacket,
    decodeBoardPacket,
    localStatsSnapshot,
    onPeerMessage,
    packPiecePos,
    pollMatchState,
    startScoreSync,
    stopScoreSync,
    unpackPiecePos
} from "./multiplayer/multiplayer-controller-sync.js";
import {
    closeResult,
    currentRemoteLivePieceForDraw,
    hideResultPanel,
    leaveMatch,
    leaveMatchInternal,
    maybeShowResult,
    rematch,
    rematchInternal,
    restartBotMatch,
    setRemoteCells,
    setRemoteLivePiece,
    showResultPanel
} from "./multiplayer/multiplayer-controller-remote.js";
import {
    appendDifficultyBar,
    appendObjectiveBar,
    appendStatRow,
    buildOpponentClearFragments,
    clearLiveComparisonColors,
    computeOpponentPostClearCells,
    createLeaveButton,
    currentHardDropFlashForDraw,
    currentHardDropTrailForDraw,
    drawOpponentBoard,
    drawOpponentClearingFrame,
    hideOpponentBadge,
    hideOpponentBoard,
    hideOpponentUI,
    localDisplayName,
    notifyLayoutResize,
    raceMetric,
    remoteDisplayName,
    renderRemoteClearingFrame,
    showOpponentBadge,
    showOpponentBoard,
    showOpponentUI,
    updateLiveComparison,
    updateOpponentStats,
    updateRaceMeter
} from "./multiplayer/multiplayer-controller-opponent-ui.js";
import {
    clearError,
    onNegotiationFailed,
    resetSession,
    sendToPeer,
    setStatus,
    showDisconnectToast,
    showError,
    t
} from "./multiplayer/multiplayer-controller-status.js";
import type {
    JsonValue,
    MultiplayerJoinRequest,
    MultiplayerPayload
} from "./multiplayer/multiplayer-controller-types.js";

"use strict";

export class MultiplayerController {

    game: Game;
    dom: Document;
    i18n: I18n;
    session: null | MultiplayerSession;
    role: null | "host" | "guest" | "bot";
    _lobbyHost: null;
    _lobbyBrowse: null;
    _joinedRoomId: null;
    _defaultBag: PieceBag;
    botOpponent: null | BotOpponent;
    _pollTimer: null | number;
    _disconnectToastTimer: null | number;
    _lastSentScore: -1;
    _lastSentBoardVersion: -1;
    _lastSentBoardCells: null | Uint8Array<ArrayBuffer>;
    _lastSentPieceIndex: -1;
    _lastSentPieceX: null;
    _lastSentPieceY: null;
    _lastSentPieceRotation: null;
    _localFinalScore: null;
    _remoteFinalScore: null;
    _localFinalStats: null;
    _remoteFinalStats: null;
    _wasInMatch: false | true;
    _remoteName: null;
    _remoteTheme: null;
    _lastSentTheme: null;
    _lastSentVisualConfig: null;
    _lastRemoteScore: 0;
    _lastRemoteStats: null;
    _lastRemoteCells: null;
    _remoteBoardVersion: 0;
    _remoteClearingVersion: 0;
    _remoteLivePiece: null;
    _remoteLivePieceAnim: null;
    _remoteClearing: null;
    _remoteHardDropTrail: null;
    _remoteHardDropFlash: null;
    _wasLocalClearing: false | boolean;
    _frameLoopRaf: null | number;
    _opponentBadgeEl: null;
    _opponentNameBadgeEl: null;
    _opponentBlockTypeEl: null;
    _opponentGhostTypeEl: null;
    _opponentObjectiveWrapEl: null;
    _opponentObjectiveFillEl: null;
    _opponentObjectiveLabelEl: null;
    _opponentObjectiveTrackEl: null;
    _opponentScoreBadgeEl: null;
    _opponentLinesBadgeEl: null;
    _opponentTrtBadgeEl: null;
    _opponentPpsBadgeEl: null;
    _opponentDroughtBadgeEl: null;
    _resultPanelEl: null;
    _resultPanelOriginalParent: null;
    _resultPanelOriginalNextSibling: null;
    opponentBoard: OpponentBoardView;
    _botStartTimer: null | number;
    _botStartDeadline: 0 | number;
    _botDifficultyKey: null;
    _guestOriginalMode: null;
    _guestOriginalDifficulty: null;
    _activePanelName: null;
    _panelGroupFocus: 0 | number;
    _negotiationRetryCount: 0;
    _negotiationRetryTimer: null | number;
    _connectInFlight: false | true;
    _launching: false | true;
    _opponentDifficultyTrackEl: null;
    _opponentDifficultyFillEl: null;
    _opponentDifficultyLabelEl: null;
    _persistentOverlayParent: null;
    _persistentOverlayNextSibling: null;


    constructor(game, dom = globalThis.document ?? null, i18n = null) {
        this.game = game;
        this.dom = dom;
        this.i18n = i18n;
        this.session = null;
        this.role = null;

        this._lobbyHost = null;
        this._lobbyBrowse = null;
        this._joinedRoomId = null;

        this._defaultBag = game.bag;
        this.botOpponent = null;

        this._pollTimer = null;
        this._disconnectToastTimer = null;
        this._lastSentScore = -1;
        this._lastSentBoardVersion = -1;
        this._lastSentBoardCells = null;
        this._lastSentPieceIndex = -1;
        this._lastSentPieceX = null;
        this._lastSentPieceY = null;
        this._lastSentPieceRotation = null;
        this._localFinalScore = null;
        this._remoteFinalScore = null;
        this._localFinalStats = null;
        this._remoteFinalStats = null;
        this._wasInMatch = false;
        this._remoteName = null;
        this._remoteTheme = null;
        this._lastSentTheme = null;
        this._lastRemoteScore = 0;
        this._lastRemoteStats = null;
        this._lastRemoteCells = null;
        this._remoteBoardVersion = 0;
        this._remoteClearingVersion = 0;
        this._remoteLivePiece = null;
        this._remoteLivePieceAnim = null;
        this._remoteClearing = null;
        this._remoteHardDropTrail = null;
        this._remoteHardDropFlash = null;
        this._wasLocalClearing = false;
        this._frameLoopRaf = null;
        this._opponentBadgeEl = null;
        this._opponentNameBadgeEl = null;
        this._opponentObjectiveWrapEl = null;
        this._opponentObjectiveFillEl = null;
        this._opponentObjectiveLabelEl = null;
        this._opponentObjectiveTrackEl = null;
        this._opponentScoreBadgeEl = null;
        this._opponentLinesBadgeEl = null;
        this._opponentTrtBadgeEl = null;
        this._opponentPpsBadgeEl = null;
        this._opponentDroughtBadgeEl = null;
        this._resultPanelEl = null;
        this._resultPanelOriginalParent = null;
        this._resultPanelOriginalNextSibling = null;
        this.opponentBoard = new OpponentBoardView(this.game, this.dom);
        this._botStartTimer = null;
        this._botStartDeadline = 0;
        this._botDifficultyKey = null;
        this._guestOriginalMode = null;
        this._guestOriginalDifficulty = null;
        this._activePanelName = null;
        this._panelGroupFocus = 0;
        this._negotiationRetryCount = 0;
        this._negotiationRetryTimer = null;
        this._connectInFlight = false;
        this._persistentOverlayParent = null;
        this._persistentOverlayNextSibling = null;
        this._launching = false;

        this._onKeydown = this._onKeydown.bind(this);
        this.dom?.addEventListener("keydown", this._onKeydown, {capture: true});
    }

    get overlayEl() {
        return this.dom?.querySelector('[data-role="mp-overlay"]') ?? null;
    }

    get isOpen() {
        return !!this.overlayEl && !this.overlayEl.hidden;
    }

    get panels() {
        const root = this.overlayEl;
        return {
            role: root?.querySelector('[data-role="mp-panel-role"]') ?? null,
            host: root?.querySelector('[data-role="mp-panel-host"]') ?? null,
            join: root?.querySelector('[data-role="mp-panel-join"]') ?? null,
            bot: root?.querySelector('[data-role="mp-panel-bot"]') ?? null,
            ready: root?.querySelector('[data-role="mp-panel-ready"]') ?? null,
            result: this.dom?.querySelector('[data-role="mp-panel-result"]') ?? null,
        };
    }

    get isResultPanelVisible() {
        return !!this._resultPanelEl;
    }

    init() {
        if (!this.dom) return;

        this.dom.addEventListener("click", (event) => {
            if (event.target.closest('[data-role="multiplayer-button"]')) this.open();
        });

        const root = this.overlayEl;

        root?.querySelector('[data-role="mp-return-button"]')?.addEventListener("click", () => this.close());
        this.overlayEl?.addEventListener("click", (event) => {
            if (event.target === this.overlayEl) this.close();
        });

        root?.querySelector('[data-role="mp-host-button"]')?.addEventListener("click", () => this._beginHost());
        root?.querySelector('[data-role="mp-join-button"]')?.addEventListener("click", () => this._beginJoin());
        root?.querySelector('[data-role="mp-bot-button"]')?.addEventListener("click", () => this._showPanel("bot"));

        const botDifficultySlider = root?.querySelector('[data-role="mp-bot-difficulty-slider"]');
        botDifficultySlider?.addEventListener("input", () => this._syncBotDifficultySlider());
        root?.querySelector('[data-role="mp-bot-difficulty-start"]')?.addEventListener("click", () => {
            const key = BOT_DIFFICULTY_ORDER[Number(botDifficultySlider?.value ?? 0)] ?? "easy";
            this._beginBot(key);
        });
        this._syncBotDifficultySlider();

        root?.querySelector('[data-role="mp-bot-mode-prev"]')?.addEventListener("click", () => this._changeMatchMode(-1));
        root?.querySelector('[data-role="mp-bot-mode-next"]')?.addEventListener("click", () => this._changeMatchMode(1));
        root?.querySelector('[data-role="mp-bot-level-prev"]')?.addEventListener("click", () => this._changeBotLevel(-1));
        root?.querySelector('[data-role="mp-bot-level-next"]')?.addEventListener("click", () => this._changeBotLevel(1));
        root?.querySelector('[data-role="mp-ready-mode-prev"]')?.addEventListener("click", () => this._changeMatchMode(-1));
        root?.querySelector('[data-role="mp-ready-mode-next"]')?.addEventListener("click", () => this._changeMatchMode(1));
        root?.querySelector('[data-role="mp-ready-difficulty-prev"]')?.addEventListener("click", () => this._changeMatchDifficulty(-1));
        root?.querySelector('[data-role="mp-ready-difficulty-next"]')?.addEventListener("click", () => this._changeMatchDifficulty(1));

        root?.querySelector('[data-role="mp-ready-button"]')?.addEventListener("click", () => this._toggleReady());
        root?.querySelector('[data-role="mp-start-button"]')?.addEventListener("click", () => this._hostStart());
        root?.querySelector('[data-role="mp-leave-button"]')?.addEventListener("click", () => this._leaveMatch());
        root?.querySelector('[data-role="mp-result-rematch-button"]')?.addEventListener("click", () => this._rematch());
        root?.querySelector('[data-role="mp-result-close-button"]')?.addEventListener("click", () => this._closeResult());

        this._startFrameLoop();
    }

    _startFrameLoop() {
        return startFrameLoop(this);
    }

    _frameTick() {
        return frameTick(this);
    }

    notifyHardDropTrail() {
        return notifyHardDropTrail(this);
    }

    notifyLockImpactFlash() {
        return notifyLockImpactFlash(this);
    }

    notifyThemeChanged() {
        return notifyThemeChanged(this);
    }

    open() {
        return open(this);
    }

    close() {
        return close(this);
    }

    _onKeydown(event: KeyboardEvent) {
        return onKeydown(this, event);
    }

    _syncPanelGroupFocus() {
        return syncPanelGroupFocus(this);
    }

    _showPanel(name: string) {
        return showPanel(this, name);
    }

    _updateSteps(name: string) {
        return updateSteps(this, name);
    }

    _renderConfigPanels() {
        return renderConfigPanels(this);
    }

    _syncBotDifficultySlider() {
        return syncBotDifficultySlider(this);
    }

    _changeMatchMode(dir: number) {
        return changeMatchMode(this, dir);
    }

    _changeBotLevel(dir: number) {
        return changeBotLevel(this, dir);
    }

    _changeMatchDifficulty(dir: number) {
        return changeMatchDifficulty(this, dir);
    }

    _sendConfigIfHost() {
        return sendConfigIfHost(this);
    }

    _applyRemoteConfig(mode: string, difficulty: string) {
        return applyRemoteConfig(this, mode, difficulty);
    }

    async _beginHost() {
        return beginHost(this);
    }

    async _beginHostAttempt() {
        return beginHostAttempt(this);
    }

    _onJoinRequestReceived(req: MultiplayerJoinRequest) {
        return onJoinRequestReceived(this, req);
    }

    _onDeclineRequest(requestId: string) {
        return onDeclineRequest(this, requestId);
    }

    async _onAcceptRequest(requestId: string) {
        return onAcceptRequest(this, requestId);
    }

    async _beginJoin() {
        return beginJoin(this);
    }

    async _beginJoinAttempt() {
        return beginJoinAttempt(this);
    }

    _onRoomOpened(room: string) {
        return onRoomOpened(this, room);
    }

    _onRoomClosed(roomId: string) {
        return onRoomClosed(this, roomId);
    }

    async _onRequestJoin(roomId: string, hostName: string) {
        return onRequestJoin(this, roomId, hostName);
    }

    _mapSignalError(err: Error | SupabaseSignalError) {
        return mapSignalError(this, err);
    }

    _beginBot(difficultyKey: string) {
        return beginBot(this, difficultyKey);
    }

    _startBotWhenRunning() {
        return startBotWhenRunning(this);
    }

    _teardownBotMode() {
        return teardownBotMode(this);
    }

    _bindSessionEvents() {
        return bindSessionEvents(this);
    }

    _updateReadyBadges() {
        return updateReadyBadges(this);
    }

    _toggleReady() {
        return toggleReady(this);
    }

    _hostStart() {
        return hostStart(this);
    }

    _launchMatch() {
        return launchMatch(this);
    }

    _startScoreSync() {
        return startScoreSync(this);
    }

    _stopScoreSync() {
        return stopScoreSync(this);
    }

    _buildBoardPacket(cells: Uint8Array) {
        return buildBoardPacket(this, cells);
    }

    _packPiecePos(x: number, y: number) {
        return packPiecePos(this, x, y);
    }

    _unpackPiecePos(pos: number) {
        return unpackPiecePos(this, pos);
    }

    _decodeBoardPacket(payload: MultiplayerPayload) {
        return decodeBoardPacket(this, payload);
    }

    _pollMatchState() {
        return pollMatchState(this);
    }

    _localStatsSnapshot() {
        return localStatsSnapshot(this);
    }

    _onPeerMessage(payload: MultiplayerPayload) {
        return onPeerMessage(this, payload);
    }

    _setRemoteLivePiece(payload: MultiplayerPayload) {
        return setRemoteLivePiece(this, payload);
    }

    _currentRemoteLivePieceForDraw() {
        return currentRemoteLivePieceForDraw(this);
    }

    _setRemoteCells(cells: Uint8Array) {
        return setRemoteCells(this, cells);
    }

    _maybeShowResult() {
        return maybeShowResult(this);
    }

    _hideResultPanel() {
        return hideResultPanel(this);
    }

    _showResultPanel() {
        return showResultPanel(this);
    }

    _rematch() {
        return rematchInternal(this);
    }

    _closeResult() {
        return closeResult(this);
    }

    _leaveMatch() {
        return leaveMatchInternal(this);
    }

    leaveMatch() {
        return leaveMatch(this);
    }

    restartBotMatch() {
        return restartBotMatch(this);
    }

    rematch() {
        return rematch(this);
    }

    _showOpponentUI() {
        return showOpponentUI(this);
    }

    _hideOpponentUI() {
        return hideOpponentUI(this);
    }

    _showOpponentBadge() {
        return showOpponentBadge(this);
    }

    _appendStatRow(panel: HTMLElement, titleKey: string, valueRole: string, initialText: string) {
        return appendStatRow(this, panel, titleKey, valueRole, initialText);
    }

    _appendObjectiveBar(panel: HTMLElement) {
        return appendObjectiveBar(this, panel);
    }

    _appendDifficultyBar(panel: HTMLElement) {
        return appendDifficultyBar(this, panel);
    }

    _createLeaveButton() {
        return createLeaveButton(this);
    }

    _hideOpponentBadge() {
        return hideOpponentBadge(this);
    }

    _updateOpponentStats(payload: MultiplayerPayload) {
        return updateOpponentStats(this, payload);
    }

    _updateLiveComparison(localSnapshot: MultiplayerPayload | null = null) {
        return updateLiveComparison(this, localSnapshot);
    }

    _clearLiveComparisonColors() {
        return clearLiveComparisonColors(this);
    }

    _raceMetric(stats: MultiplayerPayload) {
        return raceMetric(this, stats);
    }

    _updateRaceMeter(localStats: MultiplayerPayload) {
        return updateRaceMeter(this, localStats);
    }

    _showOpponentBoard() {
        return showOpponentBoard(this);
    }

    _hideOpponentBoard() {
        return hideOpponentBoard(this);
    }

    setOpponentPausedVisual(paused) {
        this.opponentBoard?.setPausedVisual(Boolean(paused));
    }

    _notifyLayoutResize() {
        return notifyLayoutResize(this);
    }

    _remoteDisplayName() {
        return remoteDisplayName(this);
    }

    _localDisplayName() {
        return localDisplayName(this);
    }

    _buildOpponentClearFragments(cells: Uint8Array, lineIndices: number[]) {
        return buildOpponentClearFragments(this, cells, lineIndices);
    }

    _drawOpponentBoard(cells: Uint8Array, livePiece: MultiplayerPayload | null = null, hardDropTrail: JsonValue[] | null = null, hardDropFlash: JsonValue | null = null) {
        return drawOpponentBoard(this, cells, livePiece, hardDropTrail, hardDropFlash);
    }

    _currentHardDropTrailForDraw() {
        return currentHardDropTrailForDraw(this);
    }

    _currentHardDropFlashForDraw() {
        return currentHardDropFlashForDraw(this);
    }

    _renderRemoteClearingFrame() {
        return renderRemoteClearingFrame(this);
    }

    _computeOpponentPostClearCells(rc: MultiplayerPayload) {
        return computeOpponentPostClearCells(this, rc);
    }

    _drawOpponentClearingFrame(rc: MultiplayerPayload, progress: number) {
        return drawOpponentClearingFrame(this, rc, progress);
    }

    _sendToPeer(payload: MultiplayerPayload) {
        return sendToPeer(this, payload);
    }

    _t(key: string, vars: Record<string, string | number> = {}) {
        return t(this, key, vars);
    }

    _setStatus(text: string) {
        return setStatus(this, text);
    }

    _showDisconnectToast() {
        return showDisconnectToast(this);
    }

    _showError(err: Error | SupabaseSignalError) {
        return showError(this, err);
    }

    _clearError() {
        return clearError(this);
    }

    _onNegotiationFailed(err: Error | SupabaseSignalError) {
        return onNegotiationFailed(this, err);
    }

    _resetSession() {
        return resetSession(this);
    }
}
