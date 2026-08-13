"use strict";

import {MultiplayerSession} from "../net/multiplayer-session.js";
import {MESSAGE_KIND} from "../net/net-constants.js";
import {browseLobby, hostOpenLobby, requestJoinRoom, SupabaseSignalError} from "../net/supabase-signaling.js";
import {BOT_DIFFICULTIES, BotOpponent} from "../ai/bot-opponent.js";
import {PieceBag} from "../game/piece-bag.js";
import {mulberry32, randomSeed} from "../shared/seeded-random.js";
import {formatNumber} from "../shared/utils.js";
import {BOARD_CONFIG, KLOCKOMINO_TYPES} from "../shared/config.js";

const SCORE_POLL_MS = 200;
const RUNNING_STATES = new Set(["countdown", "running", "clearing", "paused", "options"]);
const FINISHED_STATES = new Set(["gameOver-entry", "gameOver-saved"]);

const OPPONENT_BOARD_FALLBACK_CELL_PX = 24;

const BOT_DIFFICULTY_ORDER = ["easy", "medium", "hard"];

const MAX_NEGOTIATION_AUTO_RETRIES = 2;
const NEGOTIATION_RETRY_DELAY_MS = 600;

const STEP_BY_PANEL = {
    role: {step: 1, labelKey: "multiplayer.step1Label"},
    host: {step: 2, labelKey: "multiplayer.step2Label"},
    join: {step: 2, labelKey: "multiplayer.step2Label"},
    ready: {step: 3, labelKey: "multiplayer.step3Label"},
};

export class MultiplayerController {
    static RESULT_STAT_ROWS = [
        {role: "lines", raw: (s) => s.lines ?? 0, display: (s, raw) => s.display?.lines ?? String(raw)},
        {
            role: "trt",
            raw: (s) => s.tetrisRatePercent ?? 0,
            display: (s, raw) => s.display?.tetrisRate ?? `${raw.toFixed(1)}%`
        },
        {role: "pps", raw: (s) => s.pps ?? 0, display: (s, raw) => s.display?.pps ?? raw.toFixed(2)},
        {
            role: "efficiency",
            raw: (s) => s.efficiency ?? 0,
            display: (s, raw) => s.display?.efficiency ?? formatNumber(Math.round(raw))
        },
        {role: "combo", raw: (s) => s.maxCombo ?? 0, display: (s, raw) => s.display?.maxCombo ?? String(raw)},
        {role: "burn", raw: (s) => s.burn ?? 0, display: (s, raw) => s.display?.burn ?? String(raw), lowerBetter: true},
        {
            role: "drought-max",
            raw: (s) => s.maxDrought ?? 0,
            display: (s, raw) => s.display?.maxDrought ?? String(raw),
            lowerBetter: true
        },
        {
            role: "drought-total",
            raw: (s) => s.droughtTotal ?? 0,
            display: (s, raw) => s.display?.droughtTotal ?? String(raw),
            lowerBetter: true
        },
        {
            role: "drought-avg",
            raw: (s) => s.droughtAvg ?? 0,
            display: (s, raw) => s.display?.droughtAvg ?? raw.toFixed(1),
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
        this._localFinalScore = null;
        this._remoteFinalScore = null;
        this._localFinalStats = null;
        this._remoteFinalStats = null;
        this._wasInMatch = false;
        this._remoteName = null;
        this._lastRemoteScore = 0;
        this._lastRemoteStats = null;
        this._lastRemoteCells = null;
        this._remoteBoardVersion = 0;
        this._remoteClearingVersion = 0;
        this._remoteLivePiece = null;
        this._remoteClearing = null;
        this._remoteHardDropTrail = null;
        this._wasLocalClearing = false;
        this._frameLoopRaf = null;
        this._opponentBadgeEl = null;
        this._opponentNameBadgeEl = null;
        this._opponentScoreBadgeEl = null;
        this._opponentBestBadgeEl = null;
        this._opponentLinesBadgeEl = null;
        this._opponentTrtBadgeEl = null;
        this._opponentPpsBadgeEl = null;
        this._opponentDroughtBadgeEl = null;
        this._resultPanelEl = null;
        this._opponentPanelEl = null;
        this._opponentNameEl = null;
        this._opponentCanvasEl = null;
        this._opponentCanvasCtx = null;
        this._opponentBoardHost = null;
        this._localHeaderEl = null;
        this._raceMeterEl = null;
        this._raceMeterFillEl = null;
        this._handleOpponentWindowResize = null;
        this._botStartTimer = null;
        this._botStartDeadline = 0;
        this._botDifficultyKey = null;
        this._guestOriginalMode = null;
        this._guestOriginalDifficulty = null;
        this._activePanelName = null;
        this._negotiationRetryCount = 0;
        this._negotiationRetryTimer = null;
        this._connectInFlight = false;

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
        }
        this._wasLocalClearing = isClearing;

        if (this._remoteClearing) this._renderRemoteClearingFrame();
        else if (this._remoteHardDropTrail && this.game.settings.fallTrail) this._renderRemoteHardDropTrail();
    }

    notifyHardDropTrail() {
        const trail = this.game.hardDropTrail;
        if (!trail || !this.session?.isConnected) return;
        this._sendToPeer({kind: MESSAGE_KIND.HARD_DROP_TRAIL, entries: trail.entries, duration: trail.duration});
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

        if (this._connectInFlight) return;

        if (this.session && !this.session.isConnected) this._resetSession();
    }

    _onKeydown(event) {
        if (event.key === "Escape") this.close();
    }

    _showPanel(name) {
        const panels = this.panels;
        Object.entries(panels).forEach(([key, el]) => {
            if (el) el.hidden = key !== name;
        });
        this._activePanelName = name;
        this._updateSteps(name);
        this._renderConfigPanels();
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
        this.close();
        this._hideResultPanel();
        this._localFinalScore = null;
        this._remoteFinalScore = null;
        this._localFinalStats = null;
        this._remoteFinalStats = null;
        this._lastSentScore = -1;
        this._lastSentBoardVersion = -1;
        this._wasInMatch = false;
        this._showOpponentUI();

        const game = this.game;
        if (game.state === "idle" || game.state === "gameOver-saved") {
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

            if (game.board && game.state !== "clearing" && game.board.version !== this._lastSentBoardVersion) {
                this._lastSentBoardVersion = game.board.version;
                this._sendToPeer({kind: MESSAGE_KIND.BOARD, cells: Array.from(game.board.colors)});
            }

            if (game.state === "running" && game.current) {
                const p = game.current;
                this._sendToPeer({
                    kind: MESSAGE_KIND.PIECE,
                    x: p.x, y: p.y, mask: p.mask, width: p.width, height: p.height, colorIndex: p.colorIndex,
                });
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
        const stats = game.stats;
        const totalClears = Object.values(game.clearCounts).reduce((sum, n) => sum + n, 0);
        const tetrisRatePercent = totalClears ? (game.clearCounts[4] / totalClears) * 100 : 0;
        const elapsedSeconds = game.elapsedMs / 1000;
        const pps = elapsedSeconds >= 1 ? game.piecesSpawned / elapsedSeconds : 0;
        const efficiencyValue = game.lines > 0 ? game.score / game.lines : 0;
        const droughtAvgValue = game.droughtCount > 0 ? game.droughtTotal / game.droughtCount : 0;
        const isTimedRaceMode = game.mode === "sprint" || game.mode === "cheeseRace";
        const bestEntry = game.leaderboard.bestEntry(game.mode);
        const bestRaw = bestEntry ? (isTimedRaceMode ? bestEntry.timeMs : bestEntry.score) : null;

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
            bestRaw,
            bestIsTime: isTimedRaceMode,
            display: {
                best: stats.best,
                score: stats.score,
                lines: String(stats.lines),
                tetrisRate: stats.tetrisRate,
                pps: stats.pps,
                drought: String(stats.drought),
                maxDrought: String(stats.maxDrought),
                droughtTotal: String(stats.droughtTotal),
                droughtAvg: stats.droughtAvg,
                burn: String(stats.burn),
                maxCombo: String(stats.maxCombo),
                efficiency: stats.efficiency,
            },
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
            if (this._opponentNameEl) this._opponentNameEl.textContent = this._remoteDisplayName();
            if (this._opponentNameBadgeEl) this._opponentNameBadgeEl.textContent = this._remoteDisplayName();
            if (this._lastRemoteStats) this._updateOpponentStats(this._lastRemoteStats);
        } else if (payload.kind === MESSAGE_KIND.BOARD) {
            this._setRemoteCells(payload.cells);
            this._remoteLivePiece = null;
            if (!this._remoteClearing) {
                this._drawOpponentBoard(this._lastRemoteCells, null, this._currentHardDropTrailForDraw());
            }
        } else if (payload.kind === MESSAGE_KIND.PIECE) {
            this._remoteLivePiece = payload.cleared ? null : payload;
            if (!this._remoteClearing) {
                this._drawOpponentBoard(this._lastRemoteCells, this._remoteLivePiece, this._currentHardDropTrailForDraw());
            }
        } else if (payload.kind === MESSAGE_KIND.HARD_DROP_TRAIL) {
            this._remoteHardDropTrail = {
                entries: payload.entries || [],
                duration: payload.duration || 260,
                startTime: performance.now(),
            };
        } else if (payload.kind === MESSAGE_KIND.CLEARING) {
            if (this._remoteClearing) {
                this._drawOpponentClearingFrame(this._remoteClearing, 1);
            }
            this._setRemoteCells(payload.cells);
            this._remoteLivePiece = null;
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

        const localScoreEl = set("mp-result-local-score", local.display?.score ?? formatNumber(localScore));
        const remoteScoreEl = set("mp-result-remote-score", remote.display?.score ?? formatNumber(remoteScore));
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
        this._lastRemoteCells = null;
        this._remoteLivePiece = null;
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
    }

    _hideOpponentUI() {
        this._hideOpponentBadge();
        this._hideOpponentBoard();
    }

    _showOpponentBadge() {
        this._hideOpponentBadge();
        const statsCard = this.dom.querySelector('[data-role="stats-card"]');
        const sidebar = this.dom.querySelector(".app__sidebar");
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

        this._opponentBestBadgeEl = this._appendStatRow(panel, "sidebar.best", "mp-opponent-best-value", "—");
        this._opponentBestBadgeEl.closest(".stats__row").classList.add("stats__row--hidden");
        this._opponentScoreBadgeEl = this._appendStatRow(panel, "sidebar.score", "mp-opponent-score-value", formatNumber(0));
        this._opponentLinesBadgeEl = this._appendStatRow(panel, "sidebar.lines", "mp-opponent-lines-value", "0");
        this._opponentTrtBadgeEl = this._appendStatRow(panel, "sidebar.tetrisRate", "mp-opponent-trt-value", "0.0%");
        this._opponentPpsBadgeEl = this._appendStatRow(panel, "sidebar.pps", "mp-opponent-pps-value", "0.00");
        this._opponentDroughtBadgeEl = this._appendStatRow(panel, "sidebar.drought", "mp-opponent-drought-value", "0");

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

    _createLeaveButton() {
        const button = this.dom.createElement("button");
        button.type = "button";
        button.className = "mp-leave-button";
        button.dataset.role = "mp-leave-inline-button";
        button.setAttribute("aria-label", this._t("multiplayer.leaveButton"));
        button.textContent = "✕";
        button.addEventListener("click", () => this._leaveMatch());
        return button;
    }

    _hideOpponentBadge() {
        this._opponentBadgeEl?.remove();
        this._opponentBadgeEl = null;
        this._opponentNameBadgeEl = null;
        this._opponentScoreBadgeEl = null;
        this._opponentBestBadgeEl = null;
        this._opponentLinesBadgeEl = null;
        this._opponentTrtBadgeEl = null;
        this._opponentPpsBadgeEl = null;
        this._opponentDroughtBadgeEl = null;
    }

    _updateOpponentStats(payload) {
        this._lastRemoteScore = payload.score ?? 0;
        this._lastRemoteStats = payload;
        const display = payload.display || {};
        const bestRow = this._opponentBestBadgeEl?.closest(".stats__row");
        if (bestRow) bestRow.classList.toggle("stats__row--hidden", payload.bestRaw === null || payload.bestRaw === undefined);
        if (this._opponentBestBadgeEl) this._opponentBestBadgeEl.textContent = display.best ?? "—";
        if (this._opponentScoreBadgeEl) this._opponentScoreBadgeEl.textContent = display.score ?? formatNumber(payload.score ?? 0);
        if (this._opponentLinesBadgeEl) this._opponentLinesBadgeEl.textContent = display.lines ?? String(payload.lines ?? 0);
        if (this._opponentTrtBadgeEl) this._opponentTrtBadgeEl.textContent = display.tetrisRate ?? "0.0%";
        if (this._opponentPpsBadgeEl) this._opponentPpsBadgeEl.textContent = display.pps ?? "0.00";
        if (this._opponentDroughtBadgeEl) this._opponentDroughtBadgeEl.textContent = display.drought ?? String(payload.drought ?? 0);
    }

    _raceMetric(stats) {
        if (["sprint", "cheeseRace", "digSurvival"].includes(this.game.mode)) return stats.lines ?? 0;
        return stats.score ?? 0;
    }

    _updateRaceMeter(localStats) {
        const fill = this._raceMeterFillEl;
        if (!fill) return;
        const remoteStats = this._lastRemoteStats;
        if (!remoteStats) {
            fill.style.height = "50%";
            fill.classList.remove("mp-race-meter__fill--winning", "mp-race-meter__fill--losing");
            return;
        }
        const local = this._raceMetric(localStats);
        const remote = this._raceMetric(remoteStats);
        const total = local + remote;
        const percent = total === 0 ? 50 : 50 + 50 * (local - remote) / total;
        fill.style.height = `${Math.max(0, Math.min(100, percent))}%`;
        fill.classList.toggle("mp-race-meter__fill--winning", percent > 50);
        fill.classList.toggle("mp-race-meter__fill--losing", percent < 50);
    }

    _showOpponentBoard() {
        this._hideOpponentBoard();

        if (!globalThis.matchMedia?.("(width >= 48rem)").matches) return;

        const boardHost = this.dom.querySelector(".app__board");
        if (!boardHost) return;

        const localHeader = this.dom.createElement("div");
        localHeader.className = "mp-opponent-column__header mp-local-board-header";

        const localName = this.dom.createElement("span");
        localName.className = "mp-opponent-column__name";
        localName.textContent = this._localDisplayName();
        localHeader.appendChild(localName);

        boardHost.prepend(localHeader);
        this._opponentBoardHost = boardHost;
        this._localHeaderEl = localHeader;
        boardHost.style.paddingTop = `${localHeader.offsetHeight}px`;

        const panel = this.dom.createElement("div");
        panel.className = "app__sidebar mp-opponent-column";
        panel.dataset.role = "mp-opponent-panel";

        const header = this.dom.createElement("div");
        header.className = "mp-opponent-column__header";

        const name = this.dom.createElement("span");
        name.className = "mp-opponent-column__name";
        name.textContent = this._remoteDisplayName();
        header.appendChild(name);
        header.appendChild(this._createLeaveButton());

        panel.appendChild(header);

        const boardEl = this.dom.createElement("div");
        boardEl.className = "board mp-opponent-column__board";

        const stage = this.dom.createElement("div");
        stage.className = "board__stage";

        const canvas = this.dom.createElement("canvas");
        canvas.className = "board__canvas mp-opponent-column__canvas";
        canvas.dataset.role = "mp-opponent-canvas";

        const filterEl = this.dom.createElement("div");
        filterEl.className = "board__filter board__filter--none";

        const filterCanvas = this.dom.createElement("canvas");
        filterCanvas.className = "board__filter-canvas";
        filterEl.appendChild(filterCanvas);

        stage.appendChild(canvas);
        stage.appendChild(filterEl);
        boardEl.appendChild(stage);
        panel.appendChild(boardEl);

        boardHost.insertAdjacentElement("afterend", panel);

        const raceMeter = this.dom.createElement("div");
        raceMeter.className = "app__sidebar mp-race-meter";
        raceMeter.dataset.role = "mp-race-meter";
        const raceMeterFill = this.dom.createElement("div");
        raceMeterFill.className = "mp-race-meter__fill";
        raceMeterFill.dataset.role = "mp-race-meter-fill";
        raceMeter.appendChild(raceMeterFill);
        boardHost.insertAdjacentElement("afterend", raceMeter);

        this._opponentPanelEl = panel;
        this._opponentHeaderEl = header;
        this._opponentNameEl = name;
        this._raceMeterEl = raceMeter;
        this._raceMeterFillEl = raceMeterFill;
        this._opponentCanvasEl = canvas;
        this._opponentCanvasCtx = canvas.getContext("2d");
        this._opponentSurface = this.game.renderer?.createSurface(this._opponentCanvasCtx, canvas) ?? null;
        this.game.themeOverlay.registerTarget("opponent", {overlayEl: filterEl, canvas: filterCanvas});

        this._notifyLayoutResize();
        this._syncOpponentCanvasSize();

        this._handleOpponentWindowResize = () => this._syncOpponentCanvasSize();
        const resizeTarget = globalThis.visualViewport ?? globalThis.window ?? null;
        resizeTarget?.addEventListener("resize", this._handleOpponentWindowResize);
    }

    _syncOpponentCanvasSize() {
        const canvas = this._opponentCanvasEl;
        if (!canvas) return;
        const cellSize = BOARD_CONFIG.CELL_SIZE || OPPONENT_BOARD_FALLBACK_CELL_PX;
        const width = cellSize * BOARD_CONFIG.COLS;
        const height = cellSize * BOARD_CONFIG.ROWS;
        if (canvas.width === width && canvas.height === height) return;
        canvas.width = width;
        canvas.height = height;
        this.game.themeOverlay.resize(width, height, "opponent");
        this._drawOpponentBoard(this._lastRemoteCells, this._remoteLivePiece);
    }

    _hideOpponentBoard() {
        if (!this._opponentPanelEl && !this._localHeaderEl) return;
        this.game.themeOverlay.unregisterTarget("opponent");
        this._opponentPanelEl?.remove();
        this._opponentPanelEl = null;
        this._opponentHeaderEl = null;
        this._opponentNameEl = null;
        this._raceMeterEl?.remove();
        this._raceMeterEl = null;
        this._raceMeterFillEl = null;
        this._localHeaderEl?.remove();
        this._localHeaderEl = null;
        if (this._opponentBoardHost) {
            this._opponentBoardHost.style.paddingTop = "";
            this._opponentBoardHost = null;
        }
        this._opponentCanvasEl = null;
        this._opponentCanvasCtx = null;
        this._opponentSurface = null;
        if (this._handleOpponentWindowResize) {
            const resizeTarget = globalThis.visualViewport ?? globalThis.window ?? null;
            resizeTarget?.removeEventListener("resize", this._handleOpponentWindowResize);
            this._handleOpponentWindowResize = null;
        }
        this._notifyLayoutResize();
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
        const renderer = this.game.renderer;
        const surface = this._opponentSurface;
        if (!renderer || !surface || !cells || lineIndices.length === 0) return [];

        const {COLS, ROWS} = BOARD_CONFIG;
        return renderer.buildClearFragments({
            cells,
            cols: COLS,
            rows: ROWS,
            lineIndices,
            size: renderer.boardConfig.CELL_SIZE,
        });
    }

    _remoteBoardView(cells) {
        const {COLS, ROWS} = BOARD_CONFIG;
        if (!this._emptyRemoteCells) this._emptyRemoteCells = new Uint8Array(COLS * ROWS);
        return {cols: COLS, rows: ROWS, colors: cells || this._emptyRemoteCells, version: this._remoteBoardVersion};
    }

    _drawOpponentBoard(cells, livePiece = null, hardDropTrail = null) {
        const surface = this._opponentSurface;
        const renderer = this.game.renderer;
        if (!surface || !renderer) return;

        const board = this._remoteBoardView(cells);
        renderer.drawBoard(board, surface);

        if (hardDropTrail) {
            renderer.drawHardDropTrail(hardDropTrail.entries, hardDropTrail.progress, surface);
        }

        if (livePiece) {
            const piece = {
                x: livePiece.x,
                y: livePiece.y,
                mask: livePiece.mask,
                width: livePiece.width,
                height: livePiece.height,
                color: renderer.colorPalette[livePiece.colorIndex],
            };
            renderer.drawPiece(piece, board, surface);
        }
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

    _renderRemoteHardDropTrail() {
        const trail = this._currentHardDropTrailForDraw();
        this._drawOpponentBoard(this._lastRemoteCells, this._remoteLivePiece, trail);
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
        const surface = this._opponentSurface;
        const renderer = this.game.renderer;
        if (!surface || !renderer || !rc?.cells) return;

        const {COLS, ROWS} = BOARD_CONFIG;
        const board = {cols: COLS, rows: ROWS, colors: rc.cells, version: rc.version};
        renderer.drawClearingFrame(board, rc.lines, rc.dropRows, rc.fragments || [], progress, surface);
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
        this._remoteName = null;
        this._lastRemoteScore = 0;
        this._lastRemoteCells = null;
        this._remoteLivePiece = null;
        this._remoteClearing = null;
        this._remoteHardDropTrail = null;
        this._wasLocalClearing = false;
        this._lastSentBoardVersion = -1;
    }
}
