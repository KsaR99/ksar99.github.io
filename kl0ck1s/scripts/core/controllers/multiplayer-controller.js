"use strict";

import {MultiplayerSession} from "../net/index.js";
import {
    CELL_COLOR_MASK,
    CELL_INDEX_SHIFT,
    MESSAGE_KIND,
    PIECE_POS_AXIS_MAX,
    PIECE_POS_FRAC_BITS,
    PIECE_POS_MASK,
    PIECE_POS_SHIFT,
} from "../net/net-constants.js";
import {browseLobby, hostOpenLobby, requestJoinRoom, SupabaseSignalError} from "../net/supabase-signaling.js";
import {BOT_DIFFICULTIES, BotOpponent} from "../ai/bot-opponent.js";
import {OpponentBoardView} from "./multiplayer/opponent-board-view.js";
import {PieceBag} from "../game/piece-bag.js";
import {mulberry32, randomSeed} from "../shared/seeded-random.js";
import {formatNumber} from "../shared/utils.js";
import {BOARD_CONFIG, KLOCKOMINO_TYPES} from "../shared/config.js";

const SCORE_POLL_MS = 200;
const REMOTE_PIECE_LERP_MIN_MS = 16;
const REMOTE_PIECE_LERP_MAX_MS = 1600;
const RUNNING_STATES = new Set(["countdown", "running", "clearing", "paused", "options"]);
const FINISHED_STATES = new Set(["gameOver-entry"]);

const BOT_DIFFICULTY_ORDER = ["easy", "medium", "hard"];

const MAX_NEGOTIATION_AUTO_RETRIES = 2;
const NEGOTIATION_RETRY_DELAY_MS = 600;

const STEP_BY_PANEL = {
    role: {step: 1, labelKey: "multiplayer.step1Label"},
    host: {step: 2, labelKey: "multiplayer.step2Label"},
    join: {step: 2, labelKey: "multiplayer.step2Label"},
    ready: {step: 3, labelKey: "multiplayer.step3Label"},
};

const PANEL_KEY_CONFIG = {
    bot: {
        groups: [
            {prev: "mp-bot-mode-prev", next: "mp-bot-mode-next", focus: "mp-bot-mode-select"},
            {prev: "mp-bot-level-prev", next: "mp-bot-level-next", focus: "mp-bot-level-select"},
        ],
        primary: ["mp-bot-difficulty-start"],
    },
    ready: {
        groups: [
            {prev: "mp-ready-mode-prev", next: "mp-ready-mode-next", focus: "mp-ready-mode-select"},
            {prev: "mp-ready-difficulty-prev", next: "mp-ready-difficulty-next", focus: "mp-ready-difficulty-select"},
        ],
        primary: ["mp-start-button", "mp-ready-button"],
    },
};

export class MultiplayerController {
    static RESULT_STAT_ROWS = [
        {role: "lines", raw: (s) => s.lines ?? 0, display: (s, raw) => String(raw)},
        {
            role: "trt",
            raw: (s) => s.tetrisRatePercent ?? 0,
            display: (s, raw) => `${raw.toFixed(1)}%`
        },
        {role: "pps", raw: (s) => s.pps ?? 0, display: (s, raw) => raw.toFixed(2)},
        {
            role: "efficiency",
            raw: (s) => s.efficiency ?? 0,
            display: (s, raw) => formatNumber(Math.round(raw))
        },
        {role: "combo", raw: (s) => s.maxCombo ?? 0, display: (s, raw) => String(raw)},
        {role: "burn", raw: (s) => s.burn ?? 0, display: (s, raw) => String(raw), lowerBetter: true},
        {
            role: "drought-max",
            raw: (s) => s.maxDrought ?? 0,
            display: (s, raw) => String(raw),
            lowerBetter: true
        },
        {
            role: "drought-total",
            raw: (s) => s.droughtTotal ?? 0,
            display: (s, raw) => String(raw),
            lowerBetter: true
        },
        {
            role: "drought-avg",
            raw: (s) => s.droughtAvg ?? 0,
            display: (s, raw) => raw.toFixed(1),
            lowerBetter: true
        },
    ];

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
        this._launching = false;

        this._onKeydown = this._onKeydown.bind(this);
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
            result: root?.querySelector('[data-role="mp-panel-result"]') ?? null,
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

        root?.querySelector('[data-role="mp-close-button"]')?.addEventListener("click", () => this.close());
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
        const tick = () => {
            this._frameTick();
            this._frameLoopRaf = requestAnimationFrame(tick);
        };
        this._frameLoopRaf = requestAnimationFrame(tick);
    }

    _frameTick() {
        const game = this.game;
        const isClearing = game.state === "clearing";
        if (isClearing && !this._wasLocalClearing && this.session?.isConnected) {
            this._sendToPeer({
                kind: MESSAGE_KIND.CLEARING,
                cells: Array.from(game.board.colors),
                lines: game.clearingLines,
                dropRows: game.clearingDropRows,
                duration: game.lineClearAnimationDuration,
            });

            this._lastSentBoardVersion = game.board.version;
            this._lastSentBoardCells = Uint8Array.from(game.board.colors);
        }
        this._wasLocalClearing = isClearing;

        if (this._remoteClearing) {
            this._renderRemoteClearingFrame();
        } else if (this._remoteLivePiece
            || (this._remoteHardDropTrail && this.game.settings.fallTrail)
            || (this._remoteHardDropFlash && this.game.settings.hardDropFlash)) {
            this._drawOpponentBoard(
                this._lastRemoteCells,
                this._currentRemoteLivePieceForDraw(),
                this._currentHardDropTrailForDraw(),
                this._currentHardDropFlashForDraw(),
            );
        }
    }

    notifyHardDropTrail() {
        const trail = this.game.hardDropTrail;
        const flash = this.game.hardDropImpactFlash;
        if ((!trail && !flash) || !this.session?.isConnected) return;
        this._sendToPeer({
            kind: MESSAGE_KIND.HARD_DROP_TRAIL,
            entries: trail?.entries || [],
            duration: trail?.duration || 0,
            flashEntry: flash?.entry || null,
            flashDuration: flash?.duration || 0,
        });
    }

    notifyThemeChanged() {
        const theme = this.game.settings.theme ?? "none";
        if (!this.session?.isConnected || theme === this._lastSentTheme) return;
        this._lastSentTheme = theme;
        this._sendToPeer({kind: MESSAGE_KIND.THEME, theme});
    }

    open() {
        if (!this.overlayEl) return;
        this._clearError();
        this._showPanel(this.session?.isConnected ? "ready" : "role");
        this.overlayEl.hidden = false;
        requestAnimationFrame(() => this.overlayEl.classList.add("mp-overlay--visible"));
        this.dom.addEventListener("keydown", this._onKeydown);
    }

    close() {
        if (!this.overlayEl) return;
        this.overlayEl.classList.remove("mp-overlay--visible");
        this.overlayEl.hidden = true;
        this.dom.removeEventListener("keydown", this._onKeydown);
        clearTimeout(this._negotiationRetryTimer);
        this._negotiationRetryTimer = null;
        this._negotiationRetryCount = 0;

        if (this._connectInFlight || this._launching) return;

        if (this.session) this._resetSession();
    }

    _onKeydown(event) {
        if (event.key === "Escape") {
            this.close();
            return;
        }

        const tag = event.target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;

        const config = PANEL_KEY_CONFIG[this._activePanelName];
        if (!config) return;

        const groups = config.groups ?? [];

        if (event.code === "ArrowUp" || event.code === "ArrowDown") {
            if (!groups.length) return;
            event.preventDefault();
            const dir = event.code === "ArrowDown" ? 1 : -1;
            this._panelGroupFocus = Math.max(0, Math.min(groups.length - 1, this._panelGroupFocus + dir));
            this._syncPanelGroupFocus();
            return;
        }

        if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
            const group = groups[this._panelGroupFocus];
            if (!group) return;
            const role = event.code === "ArrowLeft" ? group.prev : group.next;
            const button = role ? this.overlayEl?.querySelector(`[data-role="${role}"]`) : null;
            if (button && !button.disabled) {
                event.preventDefault();
                button.click();
            }
            return;
        }

        if (event.code === "Enter") {
            const root = this.overlayEl;
            const primaryRole = (config.primary ?? []).find((role) => {
                const button = root?.querySelector(`[data-role="${role}"]`);
                return button && !button.hidden && !button.disabled;
            });
            const button = primaryRole ? root?.querySelector(`[data-role="${primaryRole}"]`) : null;
            if (button) {
                event.preventDefault();
                button.click();
            }
        }
    }

    _syncPanelGroupFocus() {
        const config = PANEL_KEY_CONFIG[this._activePanelName];
        const root = this.overlayEl;
        if (!root) return;

        (config?.groups ?? []).forEach((group, index) => {
            const el = root.querySelector(`[data-role="${group.focus}"]`);
            if (el) el.classList.toggle("difficulty--focused", index === this._panelGroupFocus);
        });
    }

    _showPanel(name) {
        const panels = this.panels;
        Object.entries(panels).forEach(([key, el]) => {
            if (el) el.hidden = key !== name;
        });
        this._activePanelName = name;
        this._panelGroupFocus = 0;
        this._updateSteps(name);
        this._renderConfigPanels();
        this._syncPanelGroupFocus();
    }

    _updateSteps(name) {
        const info = STEP_BY_PANEL[name];
        const root = this.overlayEl;
        const steps = root?.querySelector('[data-role="mp-steps"]');
        const caption = root?.querySelector('[data-field="mp-step-caption"]');

        if (!info) {
            if (steps) steps.hidden = true;
            if (caption) caption.hidden = true;
            return;
        }

        if (steps) steps.hidden = false;
        if (caption) caption.hidden = false;

        root?.querySelectorAll('[data-role="mp-step"]').forEach((el) => {
            const step = Number(el.dataset.step);
            el.classList.toggle("mp-step--active", step === info.step);
            el.classList.toggle("mp-step--done", step < info.step);
        });

        if (caption) caption.textContent = this._t(info.labelKey);
    }

    _renderConfigPanels() {
        const game = this.game;
        const root = this.overlayEl;

        const botModeLabel = root?.querySelector('[data-field="mp-bot-mode-label"]');
        if (botModeLabel) botModeLabel.textContent = this._t(`modes.${game.mode}.name`);
        const botModeDescription = root?.querySelector('[data-field="mp-bot-mode-description"]');
        if (botModeDescription) botModeDescription.textContent = `💡 ${this._t(`modes.${game.mode}.description`)}`;

        const diffDefForBot = game.difficulties[game.difficulty];
        const botLevelLabel = root?.querySelector('[data-field="mp-bot-level-label"]');
        if (botLevelLabel) botLevelLabel.textContent = this._t(`difficulty.${game.difficulty}`);
        const botLevelValue = root?.querySelector('[data-field="mp-bot-level-value"]');
        if (botLevelValue && diffDefForBot) {
            botLevelValue.textContent = this._t("difficulty.levelPrefix", {level: diffDefForBot.startLevel});
        }

        this._syncBotDifficultySlider();

        const readyModeLabel = root?.querySelector('[data-field="mp-ready-mode-label"]');
        if (readyModeLabel) readyModeLabel.textContent = this._t(`modes.${game.mode}.name`);

        const diffDef = game.difficulties[game.difficulty];
        const readyDifficultyLabel = root?.querySelector('[data-field="mp-ready-difficulty-label"]');
        if (readyDifficultyLabel) readyDifficultyLabel.textContent = this._t(`difficulty.${game.difficulty}`);
        const readyDifficultyLevel = root?.querySelector('[data-field="mp-ready-difficulty-level"]');
        if (readyDifficultyLevel && diffDef) {
            readyDifficultyLevel.textContent = this._t("difficulty.levelPrefix", {level: diffDef.startLevel});
        }

        const isHost = this.role === "host";
        root?.querySelectorAll(
            '[data-role="mp-ready-mode-prev"], [data-role="mp-ready-mode-next"], ' +
            '[data-role="mp-ready-difficulty-prev"], [data-role="mp-ready-difficulty-next"]'
        ).forEach((button) => {
            button.disabled = !isHost;
        });

        const hint = root?.querySelector('[data-field="mp-config-hint"]');
        if (hint) hint.textContent = this._t(isHost ? "multiplayer.configHostHint" : "multiplayer.configGuestHint");
    }

    _syncBotDifficultySlider() {
        const root = this.overlayEl;
        const slider = root?.querySelector('[data-role="mp-bot-difficulty-slider"]');
        if (!slider) return;
        const key = BOT_DIFFICULTY_ORDER[Number(slider.value)] ?? "easy";
        slider.setAttribute("aria-valuetext", this._t(`difficulty.${key}`));
        root.querySelectorAll('[data-role="mp-bot-difficulty-tick"]').forEach((tick) => {
            tick.classList.toggle("bot-difficulty-slider__tick--active", tick.dataset.difficulty === key);
        });
    }

    _changeMatchMode(dir) {
        if (this.role === "guest") return;
        this.game.modeController.changeMode(dir);
        this._renderConfigPanels();
        this._sendConfigIfHost();
    }

    _changeBotLevel(dir) {
        this.game.difficultyController.changeDifficulty(dir);
        this._renderConfigPanels();
    }

    _changeMatchDifficulty(dir) {
        if (this.role === "guest") return;
        this.game.difficultyController.changeDifficulty(dir);
        this._renderConfigPanels();
        this._sendConfigIfHost();
    }

    _sendConfigIfHost() {
        if (this.role !== "host" || !this.session?.isConnected) return;
        this._sendToPeer({kind: MESSAGE_KIND.CONFIG, mode: this.game.mode, difficulty: this.game.difficulty});
    }

    _applyRemoteConfig(mode, difficulty) {
        const game = this.game;
        if (this.role !== "guest") return;
        if (RUNNING_STATES.has(game.state)) return;

        if (mode && game.gameModes[mode] && mode !== game.mode) {
            if (this._guestOriginalMode === null) this._guestOriginalMode = game.mode;
            game.mode = mode;
            game.modeController.reset();
        }

        if (difficulty && game.difficulties[difficulty] && difficulty !== game.difficulty) {
            if (this._guestOriginalDifficulty === null) this._guestOriginalDifficulty = game.difficulty;
            game.difficulty = difficulty;
            game.levelTier = difficulty;
            game.level = game.difficulties[difficulty].startLevel;
            game.lines = 0;
        }

        game.hud.update(game.stats);
        this._renderConfigPanels();
    }

    async _beginHost() {
        const hostButton = this.overlayEl?.querySelector('[data-role="mp-host-button"]');
        if (hostButton?.disabled) return;

        clearTimeout(this._negotiationRetryTimer);
        this._negotiationRetryTimer = null;
        this._negotiationRetryCount = 0;

        await this._beginHostAttempt();
    }

    async _beginHostAttempt() {
        const hostButton = this.overlayEl?.querySelector('[data-role="mp-host-button"]');

        this._clearError();
        this._resetSession();
        this.role = "host";
        this.session = MultiplayerSession.createHost();
        this._bindSessionEvents();
        this._showPanel("host");

        const root = this.overlayEl;
        const waitText = root?.querySelector('[data-field="mp-host-wait-text"]');
        const list = root?.querySelector('[data-role="mp-host-requests-list"]');
        const empty = root?.querySelector('[data-field="mp-host-requests-empty"]');
        if (list) list.innerHTML = "";
        if (empty) empty.hidden = false;
        if (waitText) {
            waitText.textContent = this._t("multiplayer.waitingForGuest");
            waitText.hidden = false;
        }
        if (hostButton) hostButton.disabled = true;

        this._connectInFlight = true;
        try {
            this._lobbyHost = await hostOpenLobby(this.game.playerName || "", {
                onJoinRequest: (req) => this._onJoinRequestReceived(req),
            });
        } catch (err) {
            this._onNegotiationFailed(this._mapSignalError(err));
        } finally {
            this._connectInFlight = false;
            if (hostButton) hostButton.disabled = false;
        }
    }

    _onJoinRequestReceived(req) {
        const list = this.overlayEl?.querySelector('[data-role="mp-host-requests-list"]');
        if (!list || list.querySelector(`[data-request-id="${req.requestId}"]`)) return;

        const empty = this.overlayEl?.querySelector('[data-field="mp-host-requests-empty"]');
        if (empty) empty.hidden = true;

        const item = this.dom.createElement("li");
        item.className = "mp-request-item";
        item.dataset.requestId = req.requestId;

        const name = this.dom.createElement("span");
        name.className = "mp-request-item__name";
        name.textContent = req.guestName || this._t("multiplayer.guestFallback");
        item.appendChild(name);

        const actions = this.dom.createElement("span");
        actions.className = "mp-request-item__actions";

        const acceptButton = this.dom.createElement("button");
        acceptButton.type = "button";
        acceptButton.className = "button button--accent mp-request-item__accept";
        acceptButton.textContent = this._t("multiplayer.acceptButton");
        acceptButton.addEventListener("click", () => this._onAcceptRequest(req.requestId));

        const declineButton = this.dom.createElement("button");
        declineButton.type = "button";
        declineButton.className = "button button--primary mp-request-item__decline";
        declineButton.textContent = this._t("multiplayer.declineButton");
        declineButton.addEventListener("click", () => this._onDeclineRequest(req.requestId));

        actions.appendChild(acceptButton);
        actions.appendChild(declineButton);
        item.appendChild(actions);
        list.appendChild(item);
    }

    _onDeclineRequest(requestId) {
        this._lobbyHost?.decline(requestId).catch(() => {
        });
        this.overlayEl?.querySelector(`[data-request-id="${requestId}"]`)?.remove();
    }

    async _onAcceptRequest(requestId) {
        if (!this._lobbyHost || this._connectInFlight) return;

        const root = this.overlayEl;
        const waitText = root?.querySelector('[data-field="mp-host-wait-text"]');
        root?.querySelectorAll('[data-role="mp-host-requests-list"] button')
            .forEach((button) => (button.disabled = true));
        if (waitText) waitText.textContent = this._t("multiplayer.statusConnecting");

        const lobbyHost = this._lobbyHost;
        this._connectInFlight = true;
        try {
            await lobbyHost.accept(requestId, this.session);
            this._lobbyHost = null;
        } catch (err) {
            this._lobbyHost = null;
            this._onNegotiationFailed(this._mapSignalError(err));
        } finally {
            this._connectInFlight = false;
        }
    }

    async _beginJoin() {
        clearTimeout(this._negotiationRetryTimer);
        this._negotiationRetryTimer = null;
        this._negotiationRetryCount = 0;

        await this._beginJoinAttempt();
    }

    async _beginJoinAttempt() {
        this._clearError();
        this._resetSession();
        this.role = "guest";
        this.session = MultiplayerSession.createGuest();
        this._bindSessionEvents();
        this._showPanel("join");
        this._joinedRoomId = null;

        const root = this.overlayEl;
        const list = root?.querySelector('[data-role="mp-join-rooms-list"]');
        const empty = root?.querySelector('[data-field="mp-join-rooms-empty"]');
        const listWrap = root?.querySelector('[data-role="mp-join-rooms-wrap"]');
        const waitText = root?.querySelector('[data-field="mp-join-wait-text"]');
        if (list) list.innerHTML = "";
        if (empty) empty.hidden = false;
        if (listWrap) listWrap.hidden = false;
        if (waitText) waitText.hidden = true;

        this._connectInFlight = true;
        try {
            this._lobbyBrowse = await browseLobby({
                onRoomOpened: (room) => this._onRoomOpened(room),
                onRoomClosed: (roomId) => this._onRoomClosed(roomId),
            });
        } catch (err) {
            this._onNegotiationFailed(this._mapSignalError(err));
        } finally {
            this._connectInFlight = false;
        }
    }

    _onRoomOpened(room) {
        if (this._joinedRoomId) return;
        const list = this.overlayEl?.querySelector('[data-role="mp-join-rooms-list"]');
        if (!list || list.querySelector(`[data-room-id="${room.roomId}"]`)) return;

        const empty = this.overlayEl?.querySelector('[data-field="mp-join-rooms-empty"]');
        if (empty) empty.hidden = true;

        const item = this.dom.createElement("li");
        item.className = "mp-room-item";
        item.dataset.roomId = room.roomId;

        const name = this.dom.createElement("span");
        name.className = "mp-room-item__name";
        name.textContent = room.hostName || this._t("multiplayer.hostFallback");
        item.appendChild(name);

        const joinButton = this.dom.createElement("button");
        joinButton.type = "button";
        joinButton.className = "button button--accent mp-room-item__join";
        joinButton.textContent = this._t("multiplayer.requestJoinButton");
        joinButton.addEventListener("click", () => this._onRequestJoin(room.roomId, room.hostName));
        item.appendChild(joinButton);

        list.appendChild(item);
    }

    _onRoomClosed(roomId) {
        this.overlayEl?.querySelector(`[data-room-id="${roomId}"]`)?.remove();
        const list = this.overlayEl?.querySelector('[data-role="mp-join-rooms-list"]');
        const empty = this.overlayEl?.querySelector('[data-field="mp-join-rooms-empty"]');
        if (list && empty) empty.hidden = list.children.length > 0;
    }

    async _onRequestJoin(roomId, hostName) {
        if (this._joinedRoomId || this._connectInFlight) return;
        this._joinedRoomId = roomId;

        const root = this.overlayEl;
        const listWrap = root?.querySelector('[data-role="mp-join-rooms-wrap"]');
        if (listWrap) listWrap.hidden = true;
        const waitText = root?.querySelector('[data-field="mp-join-wait-text"]');
        if (waitText) {
            waitText.textContent = this._t("multiplayer.waitingForHost", {
                name: hostName || this._t("multiplayer.hostFallback"),
            });
            waitText.hidden = false;
        }

        await this._lobbyBrowse?.close().catch(() => {
        });
        this._lobbyBrowse = null;

        this._connectInFlight = true;
        try {
            await requestJoinRoom(roomId, this.game.playerName || "", this.session, {
                onAccepted: () => {
                    if (waitText) waitText.textContent = this._t("multiplayer.statusConnecting");
                },
            });
        } catch (err) {
            this._joinedRoomId = null;
            this._onNegotiationFailed(this._mapSignalError(err));
        } finally {
            this._connectInFlight = false;
        }
    }

    _mapSignalError(err) {
        if (!(err instanceof SupabaseSignalError)) return err;
        if (err.code === "declined") return new Error(this._t("multiplayer.hostDeclined"));
        if (err.code === "timeout" && this.role === "guest") return new Error(this._t("multiplayer.hostNoResponse"));
        return new Error(this._t("multiplayer.genericError"));
    }

    _beginBot(difficultyKey) {
        if (!BOT_DIFFICULTIES[difficultyKey]) return;
        this._clearError();
        this._resetSession();
        this.role = "bot";
        this._botDifficultyKey = difficultyKey;

        this.game.modeController.resolveRandomMode();

        const seed = randomSeed();

        this.game.bag = new PieceBag(KLOCKOMINO_TYPES, mulberry32(seed));
        this.botOpponent = new BotOpponent({
            types: KLOCKOMINO_TYPES,
            cols: BOARD_CONFIG.COLS,
            rows: BOARD_CONFIG.ROWS,
            seed,
            difficultyKey,
            startLevel: this.game.level,
            mode: this.game.mode,
            modeDef: this.game.gameModes[this.game.mode],
        });
        this.botOpponent.addEventListener("message", (event) => this._onPeerMessage(event.detail));
        this._remoteName = this._t("multiplayer.botName", {difficulty: this._t(`difficulty.${difficultyKey}`)});
        this.game.multiplayerConnected = true;
        this.game.multiplayerVsBot = true;

        this._launchMatch();
        this._botStartDeadline = Date.now() + 8000;
        this._startBotWhenRunning();
    }

    _startBotWhenRunning() {
        clearTimeout(this._botStartTimer);
        this._botStartTimer = null;

        const bot = this.botOpponent;
        if (!bot) return;

        const state = this.game.state;
        if (state === "running") {
            bot.start();
            return;
        }

        if (!RUNNING_STATES.has(state) && Date.now() > this._botStartDeadline) return;

        this._botStartTimer = setTimeout(() => this._startBotWhenRunning(), 50);
    }

    _teardownBotMode() {
        if (!this.botOpponent && this.role !== "bot") return;
        clearTimeout(this._botStartTimer);
        this._botStartTimer = null;
        this.botOpponent?.stop();
        this.botOpponent = null;
        this.game.bag = this._defaultBag;
        this.role = null;
    }

    _bindSessionEvents() {
        const session = this.session;
        session.addEventListener("connected", () => {
            this._showPanel("ready");
            this._updateReadyBadges();
            this._setStatus(this._t("multiplayer.statusConnected"));
            this.game.multiplayerConnected = true;
            this.game.multiplayerVsBot = false;
            this._sendToPeer({kind: MESSAGE_KIND.NAME, name: this.game.playerName || ""});
            this._sendToPeer({kind: MESSAGE_KIND.THEME, theme: this.game.settings.theme});
            this._lastSentTheme = this.game.settings.theme;
            this._sendConfigIfHost();
        });
        session.addEventListener("ready", () => this._updateReadyBadges());
        session.addEventListener("bothready", () => {
            this._setStatus(this._t(this.role === "host"
                ? "multiplayer.statusBothReadyHost"
                : "multiplayer.statusBothReadyGuest"));
            const startButton = this.overlayEl?.querySelector('[data-role="mp-start-button"]');
            if (startButton) startButton.hidden = this.role !== "host";
        });
        session.addEventListener("start", (event) => {
            const remoteMode = event.detail?.mode;
            if (this.role === "guest" && remoteMode && this.game.gameModes[remoteMode] && remoteMode !== this.game.mode) {
                this.game.mode = remoteMode;
                this.game.modeController.reset();
            }
            this._launchMatch();
        });
        session.addEventListener("message", (event) => this._onPeerMessage(event.detail));
        session.addEventListener("disconnected", () => {
            this._setStatus(this._t("multiplayer.statusDisconnected"));

            const wasInMatch = RUNNING_STATES.has(this.game.state) || FINISHED_STATES.has(this.game.state);
            this._stopScoreSync();
            this._hideOpponentUI();
            this.game.multiplayerConnected = false;
            if (wasInMatch) this._showDisconnectToast();
            else if (!this.session?.isConnected) this._onNegotiationFailed(new Error(this._t("multiplayer.iceFailed")));
        });
        session.addEventListener("error", (event) => {
            this._setStatus(this._t("multiplayer.statusError"));
            if (!this.session?.isConnected) this._onNegotiationFailed(event.detail);
        });
    }

    _updateReadyBadges() {
        const root = this.overlayEl;
        const local = root?.querySelector('[data-role="mp-local-ready-badge"]');
        const remote = root?.querySelector('[data-role="mp-remote-ready-badge"]');
        if (local) {
            local.textContent = this._t(this.session.localReady ? "multiplayer.youReady" : "multiplayer.youNotReady");
            local.classList.toggle("mp-ready-badge--on", this.session.localReady);
        }
        if (remote) {
            const name = this._remoteDisplayName();
            remote.textContent = this._t(
                this.session.remoteReady ? "multiplayer.opponentReady" : "multiplayer.opponentNotReady",
                {name}
            );
            remote.classList.toggle("mp-ready-badge--on", this.session.remoteReady);
        }
    }

    _toggleReady() {
        if (!this.session) return;
        this.session.setReady(!this.session.localReady);
        const button = this.overlayEl?.querySelector('[data-role="mp-ready-button"]');
        if (button) button.classList.toggle("button--accent", !this.session.localReady);
    }

    _hostStart() {
        if (!this.session || this.role !== "host") return;

        this.game.modeController.resolveRandomMode();
        this._renderConfigPanels();
        this.session.sendStart({mode: this.game.mode});
        this._launchMatch();
    }

    _launchMatch() {
        this._launching = true;
        this.close();
        this._launching = false;
        this._hideResultPanel();
        this._localFinalScore = null;
        this._remoteFinalScore = null;
        this._localFinalStats = null;
        this._remoteFinalStats = null;
        this._lastSentScore = -1;
        this._lastSentBoardVersion = -1;
        this._lastSentBoardCells = null;
        this._lastSentPieceIndex = -1;
        this._lastSentPieceX = null;
        this._lastSentPieceY = null;
        this._lastSentPieceRotation = null;
        this._wasInMatch = false;
        this._showOpponentUI();

        const game = this.game;
        if (game.state === "idle") {
            const startButton = this.dom.querySelector('[data-role="start-button"]');
            startButton?.click();
        } else {
            game.pieceController.stopAllGameplaySounds();
            game.musicDirector.stop(0);
            game.screenFlow.startCountdown();
        }
        this._startScoreSync();
    }

    _startScoreSync() {
        this._stopScoreSync();
        this._pollTimer = setInterval(() => this._pollMatchState(), SCORE_POLL_MS);
    }

    _stopScoreSync() {
        if (this._pollTimer) clearInterval(this._pollTimer);
        this._pollTimer = null;
    }

    _buildBoardPacket(cells) {
        const prev = this._lastSentBoardCells;
        if (prev && prev.length === cells.length) {
            const changes = [];
            for (let i = 0; i < cells.length; i++) {
                if (cells[i] !== prev[i]) changes.push((i << CELL_INDEX_SHIFT) | cells[i]);
            }
            if (changes.length * 2 < cells.length) {
                this._lastSentBoardCells = Uint8Array.from(cells);
                return {kind: MESSAGE_KIND.BOARD, d: changes};
            }
        }
        this._lastSentBoardCells = Uint8Array.from(cells);
        return {kind: MESSAGE_KIND.BOARD, cells: Array.from(cells)};
    }

    _packPiecePos(x, y) {
        const scale = 1 << PIECE_POS_FRAC_BITS;
        const xFixed = Math.round(Math.max(0, Math.min(PIECE_POS_AXIS_MAX, x)) * scale);
        const yFixed = Math.round(Math.max(0, Math.min(PIECE_POS_AXIS_MAX, y)) * scale);
        return (xFixed << PIECE_POS_SHIFT) | yFixed;
    }

    _unpackPiecePos(pos) {
        const scale = 1 << PIECE_POS_FRAC_BITS;
        return {
            x: (pos >> PIECE_POS_SHIFT) / scale,
            y: (pos & PIECE_POS_MASK) / scale,
        };
    }

    _decodeBoardPacket(payload) {
        if (payload.cells) return payload.cells;
        const cells = this._lastRemoteCells
            ? Uint8Array.from(this._lastRemoteCells)
            : new Uint8Array(BOARD_CONFIG.COLS * BOARD_CONFIG.ROWS);
        for (const packed of payload.d || []) {
            cells[packed >> CELL_INDEX_SHIFT] = packed & CELL_COLOR_MASK;
        }
        return cells;
    }

    _pollMatchState() {
        const game = this.game;
        const inMatch = RUNNING_STATES.has(game.state);

        if (this.botOpponent) {
            if (game.state === "paused" || game.state === "options") this.botOpponent.pause();
            else if (game.state === "running") this.botOpponent.resume();
        }

        if (inMatch) {
            this._wasInMatch = true;
            const statsSnapshot = this._localStatsSnapshot();
            this._lastSentScore = statsSnapshot.score;
            this._sendToPeer({kind: MESSAGE_KIND.STATS, ...statsSnapshot});
            this._updateRaceMeter(statsSnapshot);
            this._updateLiveComparison(statsSnapshot);

            if (game.board && game.state !== "clearing" && game.board.version !== this._lastSentBoardVersion) {
                this._lastSentBoardVersion = game.board.version;
                this._sendToPeer(this._buildBoardPacket(game.board.colors));
            }

            if (game.state === "running" && game.current) {
                const p = game.current;
                const isNewPiece = game.piecesSpawned !== this._lastSentPieceIndex;
                const rotationChanged = !isNewPiece && p.rotationState !== this._lastSentPieceRotation;
                const positionChanged = p.x !== this._lastSentPieceX || p.y !== this._lastSentPieceY;

                if (isNewPiece || rotationChanged) {
                    this._sendToPeer({
                        kind: MESSAGE_KIND.PIECE,
                        p: this._packPiecePos(p.x, p.y), mask: p.mask, width: p.width, height: p.height,
                        colorIndex: p.colorIndex, pieceIndex: game.piecesSpawned,
                    });
                    this._lastSentPieceIndex = game.piecesSpawned;
                    this._lastSentPieceRotation = p.rotationState;
                    this._lastSentPieceX = p.x;
                    this._lastSentPieceY = p.y;
                } else if (positionChanged) {
                    this._sendToPeer({kind: MESSAGE_KIND.PIECE, p: this._packPiecePos(p.x, p.y)});
                    this._lastSentPieceX = p.x;
                    this._lastSentPieceY = p.y;
                }
            }
            return;
        }

        if (this._wasInMatch && FINISHED_STATES.has(game.state) && this._localFinalScore === null) {
            const finalSnapshot = this._localStatsSnapshot();
            this._localFinalScore = finalSnapshot.score;
            this._localFinalStats = finalSnapshot;
            this._sendToPeer({kind: MESSAGE_KIND.FINAL, ...finalSnapshot});
            this.botOpponent?.finish();
            this._maybeShowResult();
        }

        if (!this._wasInMatch) return;
        if (!RUNNING_STATES.has(game.state) && !FINISHED_STATES.has(game.state)) {
            this._wasInMatch = false;
            this._resetSession();
        }
    }

    _localStatsSnapshot() {
        const game = this.game;
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
            hasLevelProgress: game.gameModes[game.mode].freezeLevel !== true,
            difficultyTier: game.levelTier,
            difficultyLevel: game.level,
            difficultyPercent,
        };
    }

    _onPeerMessage(payload) {
        if (!payload || typeof payload !== "object") return;

        if (payload.kind === MESSAGE_KIND.STATS) {
            this._updateOpponentStats(payload);
        } else if (payload.kind === MESSAGE_KIND.FINAL) {
            this._remoteFinalScore = payload.score;
            this._remoteFinalStats = payload;
            this._updateOpponentStats(payload);
            if (this._localFinalScore === null && RUNNING_STATES.has(this.game.state)) {
                this.game.screenFlow.endRound("topOut");
            }
            this._maybeShowResult();
        } else if (payload.kind === MESSAGE_KIND.CONFIG) {
            this._applyRemoteConfig(payload.mode, payload.difficulty);
        } else if (payload.kind === MESSAGE_KIND.NAME) {
            this._remoteName = (payload.name || "").trim() || null;
            this._updateReadyBadges();
            this.opponentBoard.setName(this._remoteDisplayName());
            if (this._opponentNameBadgeEl) this._opponentNameBadgeEl.textContent = this._remoteDisplayName();
            if (this._lastRemoteStats) this._updateOpponentStats(this._lastRemoteStats);
        } else if (payload.kind === MESSAGE_KIND.THEME) {
            this._remoteTheme = payload.theme || "none";
            this.game.themeOverlay?.setTargetTheme("opponent", this._remoteTheme);
        } else if (payload.kind === MESSAGE_KIND.BOARD) {
            this._setRemoteCells(this._decodeBoardPacket(payload));
            this._remoteLivePiece = null;
            this._remoteLivePieceAnim = null;
            if (!this._remoteClearing) {
                this._drawOpponentBoard(
                    this._lastRemoteCells, null, this._currentHardDropTrailForDraw(), this._currentHardDropFlashForDraw(),
                );
            }
        } else if (payload.kind === MESSAGE_KIND.PIECE) {
            if (payload.cleared) {
                this._remoteLivePiece = null;
                this._remoteLivePieceAnim = null;
            } else {
                this._setRemoteLivePiece(payload);
            }
            if (!this._remoteClearing) {
                this._drawOpponentBoard(
                    this._lastRemoteCells,
                    this._currentRemoteLivePieceForDraw(),
                    this._currentHardDropTrailForDraw(),
                    this._currentHardDropFlashForDraw(),
                );
            }
        } else if (payload.kind === MESSAGE_KIND.HARD_DROP_TRAIL) {
            if (payload.entries?.length) {
                this._remoteHardDropTrail = {
                    entries: payload.entries,
                    duration: payload.duration || 260,
                    startTime: performance.now(),
                };
            }
            if (payload.flashEntry) {
                this._remoteHardDropFlash = {
                    entry: payload.flashEntry,
                    duration: payload.flashDuration || 220,
                    startTime: performance.now(),
                };
            }
        } else if (payload.kind === MESSAGE_KIND.CLEARING) {
            if (this._remoteClearing) {
                this._drawOpponentClearingFrame(this._remoteClearing, 1);
            }
            this._setRemoteCells(payload.cells);
            this._remoteLivePiece = null;
            this._remoteLivePieceAnim = null;
            const lines = payload.lines || [];
            this._remoteClearing = {
                cells: payload.cells,
                lines,
                dropRows: payload.dropRows || [],
                duration: payload.duration || 260,
                startTime: performance.now(),
                fragments: this._buildOpponentClearFragments(payload.cells, lines),
                version: ++this._remoteClearingVersion,
            };
        }
    }

    _setRemoteLivePiece(payload) {
        const now = performance.now();
        const prevTarget = this._remoteLivePiece;
        const prevAnim = this._remoteLivePieceAnim;

        const decoded = payload.p !== undefined
            ? this._unpackPiecePos(payload.p)
            : (payload.x !== undefined ? {x: payload.x, y: payload.y} : null);
        const x = decoded?.x ?? prevTarget?.x ?? 0;
        const y = decoded?.y ?? prevTarget?.y ?? 0;
        const mask = payload.mask ?? prevTarget?.mask;
        const width = payload.width ?? prevTarget?.width;
        const height = payload.height ?? prevTarget?.height;
        const colorIndex = payload.colorIndex ?? prevTarget?.colorIndex;
        const pieceIndex = payload.pieceIndex ?? prevTarget?.pieceIndex;
        const samePiece = !!prevTarget && prevTarget.pieceIndex === pieceIndex;

        let fromX = x;
        let fromY = y;
        let sinceLastUpdateMs = 0;
        if (samePiece && prevAnim) {
            const t = prevAnim.duration > 0 ? Math.min(1, (now - prevAnim.startTime) / prevAnim.duration) : 1;
            fromX = prevAnim.fromX + (prevAnim.toX - prevAnim.fromX) * t;
            fromY = prevAnim.fromY + (prevAnim.toY - prevAnim.fromY) * t;
            sinceLastUpdateMs = now - prevAnim.startTime;
        }

        const duration = samePiece
            ? Math.min(Math.max(sinceLastUpdateMs, REMOTE_PIECE_LERP_MIN_MS), REMOTE_PIECE_LERP_MAX_MS)
            : 0;

        this._remoteLivePiece = {x, y, mask, width, height, colorIndex, pieceIndex};
        this._remoteLivePieceAnim = {
            fromX, fromY,
            toX: x, toY: y,
            mask, width, height, colorIndex,
            startTime: now,
            duration,
        };
    }

    _currentRemoteLivePieceForDraw() {
        const anim = this._remoteLivePieceAnim;
        if (!anim) return this._remoteLivePiece;

        const t = anim.duration > 0 ? Math.min(1, (performance.now() - anim.startTime) / anim.duration) : 1;
        return {
            x: anim.fromX + (anim.toX - anim.fromX) * t,
            y: anim.fromY + (anim.toY - anim.fromY) * t,
            mask: anim.mask,
            width: anim.width,
            height: anim.height,
            colorIndex: anim.colorIndex,
        };
    }

    _setRemoteCells(cells) {
        this._lastRemoteCells = cells;
        this._remoteBoardVersion++;
    }

    _maybeShowResult() {
        if (this._localFinalScore === null || this._remoteFinalScore === null) return;
        if (this._localFinalStats === null || this._remoteFinalStats === null) return;

        this._stopScoreSync();
        this.session?.setReady(false);
        this._hideOpponentUI();
        this._showResultPanel();
    }

    _hideResultPanel() {
        const panel = this.dom?.querySelector('[data-role="mp-panel-result"]');
        if (panel) panel.hidden = true;
        this._updateSteps(this._activePanelName);
        this._resultPanelEl = null;
    }

    _showResultPanel() {
        const panel = this.dom?.querySelector('[data-role="mp-panel-result"]');
        const local = this._localFinalStats;
        const remote = this._remoteFinalStats;
        if (!panel || !local || !remote) return;

        const localScore = local.score ?? 0;
        const remoteScore = remote.score ?? 0;

        const isRaceMode = this.game.mode === "sprint" || this.game.mode === "cheeseRace";
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
            localEl?.classList.remove("mp-result-value--better", "mp-result-value--worse");
            remoteEl?.classList.remove("mp-result-value--better", "mp-result-value--worse");
            if (localRaw === remoteRaw) return;
            const localIsBetter = lowerBetter ? localRaw < remoteRaw : localRaw > remoteRaw;
            localEl?.classList.add(localIsBetter ? "mp-result-value--better" : "mp-result-value--worse");
            remoteEl?.classList.add(localIsBetter ? "mp-result-value--worse" : "mp-result-value--better");
        };

        const localName = this.game.playerName || this._t("leaderboard.defaultName");
        const remoteName = this._remoteDisplayName();
        const titleKey = resultKey === "draw" ? "multiplayer.draw" : resultKey === "win" ? "multiplayer.won" : "multiplayer.lost";

        const titleEl = set("mp-result-title", this._t(titleKey));
        titleEl?.classList.remove("mp-result-panel__title--win", "mp-result-panel__title--loss", "mp-result-panel__title--draw");
        titleEl?.classList.add(`mp-result-panel__title--${resultKey}`);

        set("mp-result-local-name", localName);
        set("mp-result-remote-name", remoteName);
        set("mp-result-local-name-mini", localName);
        set("mp-result-remote-name-mini", remoteName);

        const localScoreEl = set("mp-result-local-score", formatNumber(localScore));
        const remoteScoreEl = set("mp-result-remote-score", formatNumber(remoteScore));
        colorPair(localScoreEl, remoteScoreEl, localScore, remoteScore, false);

        for (const {role, raw, display, lowerBetter} of MultiplayerController.RESULT_STAT_ROWS) {
            const localRaw = raw(local);
            const remoteRaw = raw(remote);
            const localEl = set(`mp-result-local-${role}`, display(local, localRaw));
            const remoteEl = set(`mp-result-remote-${role}`, display(remote, remoteRaw));
            colorPair(localEl, remoteEl, localRaw, remoteRaw, lowerBetter);
        }

        const steps = this.dom?.querySelector('[data-role="mp-steps"]');
        const caption = this.dom?.querySelector('[data-field="mp-step-caption"]');
        if (steps) steps.hidden = true;
        if (caption) caption.hidden = true;

        Object.entries(this.panels).forEach(([key, el]) => {
            if (el && key !== "result") el.hidden = true;
        });

        const rematchButton = panel.querySelector('[data-role="mp-result-rematch-button"]');
        if (rematchButton) rematchButton.hidden = false;

        panel.hidden = false;
        this._resultPanelEl = panel;

        const overlay = this.overlayEl;
        if (overlay) {
            overlay.hidden = false;
            requestAnimationFrame(() => overlay.classList.add("mp-overlay--visible"));
        }
    }

    _rematch() {
        this._hideResultPanel();
        this._localFinalScore = null;
        this._remoteFinalScore = null;
        this._localFinalStats = null;
        this._remoteFinalStats = null;
        this._lastSentScore = -1;
        this._lastSentBoardVersion = -1;
        this._lastSentBoardCells = null;
        this._lastSentPieceIndex = -1;
        this._lastSentPieceX = null;
        this._lastSentPieceY = null;
        this._lastSentPieceRotation = null;
        this._lastRemoteCells = null;
        this._remoteLivePiece = null;
        this._remoteLivePieceAnim = null;
        this._remoteClearing = null;

        if (this.game.state === "gameOver-entry") {
            this.game.settings.mode = this.game.mode;
            this.game.screenFlow.continueFromGameOverEntry();
        }

        if (this.role === "bot") {
            const difficulty = this._botDifficultyKey;
            if (difficulty) this._beginBot(difficulty);
            return;
        }

        if (!this.session?.isConnected) return;

        this._showPanel("ready");
        this.session.setReady(true);
    }

    _closeResult() {
        this._hideResultPanel();
        this._resetSession();
        this.close();
    }

    _leaveMatch() {
        const game = this.game;
        const wasBot = this.role === "bot";
        game.pieceController.stopAllGameplaySounds();
        game.musicDirector.stop(0);
        this._hideResultPanel();
        this._resetSession();

        if (wasBot) {
            game.screenFlow.showIdleScreen().then(() => this.open());
            return;
        }

        this.close();
        game.screenFlow.showIdleScreen().then();
    }

    leaveMatch() {
        this._leaveMatch();
    }

    restartBotMatch() {
        if (this.role !== "bot" || !this._botDifficultyKey) return;
        this._beginBot(this._botDifficultyKey);
    }

    rematch() {
        if (!this.isResultPanelVisible) return;
        this._rematch();
    }

    _showOpponentUI() {
        this._showOpponentBadge();
        this._showOpponentBoard();
        if (this._remoteTheme) this.game.themeOverlay?.setTargetTheme("opponent", this._remoteTheme);
    }

    _hideOpponentUI() {
        this._hideOpponentBadge();
        this._hideOpponentBoard();
    }

    _showOpponentBadge() {
        this._hideOpponentBadge();
        const statsCard = this.dom.querySelector('[data-role="stats-card"]');
        const sidebar = this.dom.querySelector(".app__sidebar.sidebar--stats");
        if (!statsCard && !sidebar) return;

        const panel = this.dom.createElement("div");
        panel.className = "card stats mp-opponent-stats";
        panel.dataset.role = "mp-opponent-stats-card";
        panel.appendChild(this._createLeaveButton());

        const name = this.dom.createElement("p");
        name.className = "stats__status";
        name.dataset.role = "mp-opponent-name";
        name.textContent = this._remoteDisplayName();
        panel.appendChild(name);

        this._opponentScoreBadgeEl = this._appendStatRow(panel, "sidebar.score", "mp-opponent-score-value", formatNumber(0));
        this._opponentLinesBadgeEl = this._appendStatRow(panel, "sidebar.lines", "mp-opponent-lines-value", "0");
        this._opponentTrtBadgeEl = this._appendStatRow(panel, "sidebar.tetrisRate", "mp-opponent-trt-value", "0.0%");
        this._opponentPpsBadgeEl = this._appendStatRow(panel, "sidebar.pps", "mp-opponent-pps-value", "0.00");
        this._opponentDroughtBadgeEl = this._appendStatRow(panel, "sidebar.drought", "mp-opponent-drought-value", "0");
        this._opponentObjectiveTrackEl = this._appendObjectiveBar(panel);
        this._opponentDifficultyTrackEl = this._appendDifficultyBar(panel);

        if (statsCard) statsCard.insertAdjacentElement("beforebegin", panel);
        else sidebar.prepend(panel);

        this._opponentBadgeEl = panel;
        this._opponentNameBadgeEl = name;
        this._lastRemoteScore = 0;
        this._lastRemoteStats = null;
    }

    _appendStatRow(panel, titleKey, valueRole, initialText) {
        const row = this.dom.createElement("div");
        row.className = "stats__row";

        const title = this.dom.createElement("h3");
        title.className = "card__title";
        title.textContent = this._t(titleKey);
        row.appendChild(title);

        const value = this.dom.createElement("div");
        value.className = "stats__value";
        value.dataset.role = valueRole;
        value.textContent = initialText;
        row.appendChild(value);

        panel.appendChild(row);
        return value;
    }

    _appendObjectiveBar(panel) {
        const wrap = this.dom.createElement("div");
        wrap.dataset.role = "mp-opponent-objective-stat";
        wrap.classList.add("stats__row--hidden");

        const track = this.dom.createElement("div");
        track.className = "progress-bar progress-bar--objective";
        track.dataset.role = "mp-opponent-objective-track";

        const fill = this.dom.createElement("div");
        fill.className = "progress-bar__fill";
        fill.dataset.role = "mp-opponent-objective-fill";

        const label = this.dom.createElement("div");
        label.className = "progress-bar__label";
        label.dataset.role = "mp-opponent-objective-value";
        label.textContent = "—";

        track.appendChild(fill);
        track.appendChild(label);
        wrap.appendChild(track);
        panel.appendChild(wrap);

        this._opponentObjectiveWrapEl = wrap;
        this._opponentObjectiveFillEl = fill;
        this._opponentObjectiveLabelEl = label;
        return track;
    }

    _appendDifficultyBar(panel) {
        const wrap = this.dom.createElement("div");
        wrap.className = "difficulty-indicator";
        wrap.dataset.role = "mp-opponent-difficulty-stat";

        const track = this.dom.createElement("div");
        track.className = "progress-bar progress-bar--difficulty";

        const fill = this.dom.createElement("div");
        fill.className = "progress-bar__fill";
        fill.dataset.role = "mp-opponent-difficulty-fill";

        const label = this.dom.createElement("div");
        label.className = "progress-bar__label";
        label.dataset.role = "mp-opponent-difficulty-value";
        label.textContent = "—";

        track.appendChild(fill);
        track.appendChild(label);
        wrap.appendChild(track);
        panel.appendChild(wrap);

        this._opponentDifficultyFillEl = fill;
        this._opponentDifficultyLabelEl = label;
        return track;
    }

    _createLeaveButton() {
        const button = this.dom.createElement("button");
        button.type = "button";
        button.className = "mp-leave-button";
        button.dataset.role = "mp-leave-inline-button";
        button.setAttribute("aria-label", this._t("multiplayer.leaveButton"));
        button.textContent = "❌";
        button.addEventListener("click", () => this._leaveMatch());
        return button;
    }

    _hideOpponentBadge() {
        this._opponentBadgeEl?.remove();
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
        this._opponentDifficultyTrackEl = null;
        this._opponentDifficultyFillEl = null;
        this._opponentDifficultyLabelEl = null;
        this._clearLiveComparisonColors();
    }

    _updateOpponentStats(payload) {
        this._lastRemoteScore = payload.score ?? 0;
        this._lastRemoteStats = payload;

        const hasObjective = payload.objective !== null && payload.objective !== undefined;
        if (this._opponentObjectiveWrapEl) this._opponentObjectiveWrapEl.classList.toggle("stats__row--hidden", !hasObjective);
        if (hasObjective) {
            if (this._opponentObjectiveLabelEl) {
                this._opponentObjectiveLabelEl.textContent = `${this._t(payload.objectiveLabelKey ?? "sidebar.objective")}: ${payload.objective}`;
            }

            const percent = payload.objectivePercent;
            if (this._opponentObjectiveFillEl) {
                if (percent !== null && percent !== undefined) {
                    this._opponentObjectiveFillEl.style.width = `${percent}%`;
                    this._opponentObjectiveFillEl.style.backgroundColor = payload.objectiveColorMode === "ramp"
                        ? `color-mix(in oklch, var(--accent-2) ${100 - percent}%, var(--good) ${percent}%)`
                        : "";
                } else {
                    this._opponentObjectiveFillEl.style.width = "0%";
                    this._opponentObjectiveFillEl.style.backgroundColor = "";
                }
            }

            if (this._opponentObjectiveTrackEl) {
                this._opponentObjectiveTrackEl.dataset.urgency = payload.objectiveUrgency ?? "";
            }
        }

        if (this._opponentScoreBadgeEl) this._opponentScoreBadgeEl.textContent = formatNumber(payload.score ?? 0);
        if (this._opponentLinesBadgeEl) this._opponentLinesBadgeEl.textContent = String(payload.lines ?? 0);
        if (this._opponentTrtBadgeEl) this._opponentTrtBadgeEl.textContent = `${(payload.tetrisRatePercent ?? 0).toFixed(1)}%`;
        if (this._opponentPpsBadgeEl) this._opponentPpsBadgeEl.textContent = (payload.pps ?? 0).toFixed(2);
        if (this._opponentDroughtBadgeEl) this._opponentDroughtBadgeEl.textContent = String(payload.drought ?? 0);

        const hasLevelProgress = payload.hasLevelProgress !== false && payload.difficultyTier !== undefined;
        if (this._opponentDifficultyTrackEl) {
            this._opponentDifficultyTrackEl.parentElement.classList.toggle("stats__row--hidden", !hasLevelProgress);
        }
        if (hasLevelProgress) {
            if (this._opponentDifficultyLabelEl) {
                this._opponentDifficultyLabelEl.textContent = `${this._t(`difficulty.${payload.difficultyTier}`)} ${payload.difficultyLevel ?? 1}`;
            }
            if (this._opponentDifficultyFillEl && payload.difficultyPercent !== undefined) {
                this._opponentDifficultyFillEl.style.width = `${payload.difficultyPercent}%`;
            }
        }

        this._updateLiveComparison();
    }

    _updateLiveComparison(localSnapshot = null) {
        const remote = this._lastRemoteStats;
        if (!remote || !this._opponentBadgeEl) return;
        const local = localSnapshot ?? this._localStatsSnapshot();

        const pair = (localEl, remoteEl, localRaw, remoteRaw, lowerBetter = false) => {
            if (!localEl && !remoteEl) return;
            localEl?.classList.remove("stats__value--better", "stats__value--worse");
            remoteEl?.classList.remove("stats__value--better", "stats__value--worse");
            if (localRaw === remoteRaw) return;
            const localIsBetter = lowerBetter ? localRaw < remoteRaw : localRaw > remoteRaw;
            localEl?.classList.add(localIsBetter ? "stats__value--better" : "stats__value--worse");
            remoteEl?.classList.add(localIsBetter ? "stats__value--worse" : "stats__value--better");
        };

        const dom = this.dom;
        pair(dom.getElementById("score-value"), this._opponentScoreBadgeEl, local.score, remote.score ?? 0);
        pair(dom.getElementById("lines-value"), this._opponentLinesBadgeEl, local.lines, remote.lines ?? 0);
        pair(dom.getElementById("trt-value"), this._opponentTrtBadgeEl, local.tetrisRatePercent, remote.tetrisRatePercent ?? 0);
        pair(dom.getElementById("pps-value"), this._opponentPpsBadgeEl, local.pps, remote.pps ?? 0);
        pair(dom.getElementById("drought-value"), this._opponentDroughtBadgeEl, local.drought, remote.drought ?? 0, true);
    }

    _clearLiveComparisonColors() {
        const dom = this.dom;
        ["score-value", "lines-value", "trt-value", "pps-value", "drought-value"].forEach((id) => {
            dom?.getElementById(id)?.classList.remove("stats__value--better", "stats__value--worse");
        });
    }

    _raceMetric(stats) {
        if (["sprint", "cheeseRace", "digSurvival"].includes(this.game.mode)) return stats.lines ?? 0;
        return stats.score ?? 0;
    }

    _updateRaceMeter(localStats) {
        if (!this.opponentBoard.raceMeterFillEl) return;
        const remoteStats = this._lastRemoteStats;
        if (!remoteStats) {
            this.opponentBoard.resetRaceMeter();
            return;
        }
        const local = this._raceMetric(localStats);
        const remote = this._raceMetric(remoteStats);
        const total = local + remote;
        const percent = total === 0 ? 50 : 50 + 50 * (local - remote) / total;
        this.opponentBoard.updateRaceMeter(percent);
    }

    _showOpponentBoard() {
        this.opponentBoard.show(
            this._localDisplayName(),
            this._remoteDisplayName(),
            {
                onLayoutResize: () => this._notifyLayoutResize(),
                draw: () => this._drawOpponentBoard(this._lastRemoteCells, this._remoteLivePiece),
            }
        );
    }

    _hideOpponentBoard() {
        this.opponentBoard.hide(() => this._notifyLayoutResize());
    }

    _notifyLayoutResize() {
        const target = globalThis.visualViewport ?? globalThis.window ?? null;
        target?.dispatchEvent(new Event("resize"));
    }

    _remoteDisplayName() {
        return this._remoteName || this._t("multiplayer.opponentFallback");
    }

    _localDisplayName() {
        return this.game.playerName || this._t("leaderboard.defaultName");
    }

    _buildOpponentClearFragments(cells, lineIndices) {
        return this.opponentBoard.buildClearFragments(cells, lineIndices);
    }

    _drawOpponentBoard(cells, livePiece = null, hardDropTrail = null, hardDropFlash = null) {
        this.opponentBoard.draw(cells, this._remoteBoardVersion, livePiece, hardDropTrail, hardDropFlash);
    }

    _currentHardDropTrailForDraw() {
        const trail = this._remoteHardDropTrail;
        if (!trail || !this.game.settings.fallTrail) return null;

        const progress = (performance.now() - trail.startTime) / trail.duration;
        if (progress >= 1) {
            this._remoteHardDropTrail = null;
            return null;
        }

        return {entries: trail.entries, progress};
    }

    _currentHardDropFlashForDraw() {
        const flash = this._remoteHardDropFlash;
        if (!flash || !this.game.settings.hardDropFlash) return null;

        const progress = (performance.now() - flash.startTime) / flash.duration;
        if (progress >= 1) {
            this._remoteHardDropFlash = null;
            return null;
        }

        return {entry: flash.entry, progress};
    }

    _renderRemoteClearingFrame() {
        const rc = this._remoteClearing;
        const progress = (performance.now() - rc.startTime) / rc.duration;

        if (progress >= 1) {
            this._setRemoteCells(this._computeOpponentPostClearCells(rc));
            this._remoteClearing = null;
            this._drawOpponentBoard(this._lastRemoteCells, this._remoteLivePiece);
            return;
        }

        this._drawOpponentClearingFrame(rc, progress);
    }

    _computeOpponentPostClearCells(rc) {
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

    _drawOpponentClearingFrame(rc, progress) {
        this.opponentBoard.drawClearingFrame(rc, progress);
    }

    _sendToPeer(payload) {
        if (!this.session?.isConnected) return;
        try {
            this.session.send(payload);
        } catch {
            // peer likely dropped between the isConnected check and send(); the
            // "disconnected" event (already bound) will handle cleanup.
        }
    }

    _t(key, vars = {}) {
        return this.i18n ? this.i18n.t(key, vars) : key;
    }

    _setStatus(text) {
        const el = this.overlayEl?.querySelector('[data-field="mp-status-text"]');
        if (el) el.textContent = text;
    }

    _showDisconnectToast() {
        if (!this.dom) return;

        let toast = this.dom.querySelector('[data-role="mp-disconnect-toast"]');
        if (!toast) {
            toast = this.dom.createElement("div");
            toast.className = "mp-pause-blocked-toast";
            toast.dataset.role = "mp-disconnect-toast";
            (this.dom.body ?? this.dom.documentElement)?.appendChild(toast);
        }

        toast.textContent = this._t("multiplayer.opponentDisconnected");
        toast.classList.add("mp-pause-blocked-toast--visible");

        const rematchButton = this.dom.querySelector('[data-role="mp-result-rematch-button"]');
        if (rematchButton) rematchButton.hidden = true;

        clearTimeout(this._disconnectToastTimer);
        this._disconnectToastTimer = setTimeout(() => {
            toast.classList.remove("mp-pause-blocked-toast--visible");
        }, 3000);
    }

    _showError(err) {
        const el = this.overlayEl?.querySelector('[data-field="mp-error-text"]');
        if (!el) return;
        el.textContent = err?.message || this._t("multiplayer.genericError");
        el.hidden = false;
    }

    _clearError() {
        const el = this.overlayEl?.querySelector('[data-field="mp-error-text"]');
        if (el) el.hidden = true;
    }

    _onNegotiationFailed(err) {
        if (this._activePanelName === "ready" || this._activePanelName === "result") return;

        const role = this.role;
        const panel = role === "guest" ? "join" : role === "host" ? "host" : "role";

        if ((role === "host" || role === "guest") && this._negotiationRetryCount < MAX_NEGOTIATION_AUTO_RETRIES) {
            this._negotiationRetryCount += 1;
            this._resetSession();
            this._showPanel(panel);
            this._showError(new Error(this._t("multiplayer.statusRetrying", {
                attempt: this._negotiationRetryCount,
                max: MAX_NEGOTIATION_AUTO_RETRIES,
            })));
            clearTimeout(this._negotiationRetryTimer);
            this._negotiationRetryTimer = setTimeout(() => {
                if (this._activePanelName !== panel) return;
                if (role === "guest") this._beginJoinAttempt();
                else this._beginHostAttempt();
            }, NEGOTIATION_RETRY_DELAY_MS);
            return;
        }

        this._negotiationRetryCount = 0;
        this._resetSession();
        this._showPanel(panel);
        this._showError(err instanceof Error ? err : new Error(this._t("multiplayer.negotiationFailed")));
    }

    _resetSession() {
        this._stopScoreSync();
        this._hideOpponentUI();
        this._teardownBotMode();
        this.session?.close();
        this.session = null;

        if (this._lobbyHost) {
            const lobbyHost = this._lobbyHost;
            this._lobbyHost = null;
            lobbyHost.cancel().catch(() => {
            });
        }
        if (this._lobbyBrowse) {
            const lobbyBrowse = this._lobbyBrowse;
            this._lobbyBrowse = null;
            lobbyBrowse.close().catch(() => {
            });
        }
        this._joinedRoomId = null;

        if (this.role === "guest" && (this._guestOriginalMode !== null || this._guestOriginalDifficulty !== null)) {
            const game = this.game;
            if (this._guestOriginalMode !== null) {
                game.mode = this._guestOriginalMode;
                game.modeController.reset();
            }
            if (this._guestOriginalDifficulty !== null) {
                game.difficulty = this._guestOriginalDifficulty;
                game.levelTier = this._guestOriginalDifficulty;
                game.level = game.difficulties[this._guestOriginalDifficulty].startLevel;
            }
            game.hud.update(game.stats);
        }
        this._guestOriginalMode = null;
        this._guestOriginalDifficulty = null;
        this.role = null;
        this.game.multiplayerConnected = false;
        this.game.multiplayerVsBot = false;
        this.game._stopBackgroundTicker?.();
        this._remoteName = null;
        this._remoteTheme = null;
        this._lastSentTheme = null;
        this.game.themeOverlay?.clearTargetTheme("opponent");
        this._lastRemoteScore = 0;
        this._lastRemoteCells = null;
        this._remoteLivePiece = null;
        this._remoteLivePieceAnim = null;
        this._remoteClearing = null;
        this._remoteHardDropTrail = null;
        this._remoteHardDropFlash = null;
        this._wasLocalClearing = false;
        this._lastSentBoardVersion = -1;
        this._lastSentBoardCells = null;
        this._lastSentPieceIndex = -1;
        this._lastSentPieceX = null;
        this._lastSentPieceY = null;
        this._lastSentPieceRotation = null;
    }
}
