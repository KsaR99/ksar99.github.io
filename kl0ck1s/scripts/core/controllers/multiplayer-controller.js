"use strict";

import {MultiplayerSession} from "../net/multiplayer-session.js";
import {BotOpponent, BOT_DIFFICULTIES} from "../ai/bot-opponent.js";
import {PieceBag} from "../game/piece-bag.js";
import {mulberry32, randomSeed} from "../shared/seeded-random.js";
import {copyTextToClipboard, formatNumber} from "../shared/utils.js";
import {BOARD_CONFIG, COLOR_PALETTE, KLOCKOMINO_TYPES} from "../shared/config.js";

const SCORE_POLL_MS = 200;
const RUNNING_STATES = new Set(["countdown", "running", "clearing", "paused"]);
const FINISHED_STATES = new Set(["gameOver-entry", "gameOver-saved"]);

// Fallback cell size (px) for the opponent's board if used before the main
// board has ever been sized (shouldn't happen in practice — a match can't
// start before that initial layout pass runs).
const OPPONENT_BOARD_FALLBACK_CELL_PX = 24;

// Which of the 3 numbered steps is "current" for a given panel, and which
// i18n key describes it in the caption line under the dots.
const STEP_BY_PANEL = {
    role: {step: 1, labelKey: "multiplayer.step1Label"},
    host: {step: 2, labelKey: "multiplayer.step2Label"},
    join: {step: 2, labelKey: "multiplayer.step2Label"},
    bot: {step: 2, labelKey: "multiplayer.step2LabelBot"},
    ready: {step: 3, labelKey: "multiplayer.step3Label"},
};

/**
 * Bolts a peer-to-peer multiplayer lobby + light race-sync layer onto the
 * existing single-player screen flow, without touching it: it opens its own
 * overlay (mirrors ConfirmDialog's pattern), then on match start simply
 * clicks the real start-button so the untouched single-player Game runs
 * locally on both peers. While running it exchanges score/name/board updates
 * over the MultiplayerSession data channel and shows a live opponent panel —
 * a compact nickname+score badge everywhere, plus, on desktop, a full-size
 * board rendered right next to the local one (same cell size, same `.board`
 * markup) — followed by a win/lose result once both sides finish.
 *
 * The same overlay also offers a "practice vs bot" option: a local,
 * headless BotOpponent stands in for the peer, so there's no handshake and
 * no `MultiplayerSession` at all - the bot just fires the same
 * `{kind: "score"|"board"|"final"}` "message" shape a real peer would, so
 * every opponent-panel/result code path below runs unmodified for both.
 * For that single match the player's own piece bag is swapped for a seeded
 * one shared with the bot, so both boards draw the exact same sequence of
 * pieces - restored to plain randomness once the match ends.
 */
export class MultiplayerController {
    constructor(game, dom = globalThis.document ?? null, i18n = null) {
        this.game = game;
        this.dom = dom;
        this.i18n = i18n;
        this.session = null;
        this.role = null;

        // The player's real bag, saved once so it can be restored after a
        // bot match swaps in a seeded one (see _beginBot/_teardownBotMode).
        this._defaultBag = game.bag;
        this.botOpponent = null;

        this._pollTimer = null;
        this._lastSentScore = -1;
        this._lastSentBoardVersion = -1;
        this._localFinalScore = null;
        this._remoteFinalScore = null;
        this._wasInMatch = false;
        this._remoteName = null;
        this._lastRemoteScore = 0;
        this._opponentBadgeEl = null;
        this._opponentPanelEl = null;
        this._opponentNameEl = null;
        this._opponentScoreEl = null;
        this._opponentCanvasEl = null;
        this._opponentCanvasCtx = null;

        this._onKeydown = this._onKeydown.bind(this);
    }

    // --- element getters (queried live: the overlay itself is static, but game screens rerender) ---
    get overlayEl() {
        return this.dom?.querySelector('[data-role="mp-overlay"]') ?? null;
    }

    get panels() {
        return {
            role: this.dom?.querySelector('[data-role="mp-panel-role"]') ?? null,
            host: this.dom?.querySelector('[data-role="mp-panel-host"]') ?? null,
            join: this.dom?.querySelector('[data-role="mp-panel-join"]') ?? null,
            bot: this.dom?.querySelector('[data-role="mp-panel-bot"]') ?? null,
            ready: this.dom?.querySelector('[data-role="mp-panel-ready"]') ?? null,
        };
    }

    init() {
        if (!this.dom) return;

        // The multiplayer button lives inside screen templates that get
        // re-rendered on every idle/game-over-saved screen, so delegate
        // from a node that's never replaced instead of rebinding per render.
        this.dom.addEventListener("click", (event) => {
            if (event.target.closest('[data-role="multiplayer-button"]')) this.open();
        });

        this.dom.querySelector('[data-role="mp-close-button"]')?.addEventListener("click", () => this.close());
        this.overlayEl?.addEventListener("click", (event) => {
            if (event.target === this.overlayEl) this.close();
        });

        this.dom.querySelector('[data-role="mp-host-button"]')?.addEventListener("click", () => this._beginHost());
        this.dom.querySelector('[data-role="mp-join-button"]')?.addEventListener("click", () => this._showPanel("join"));
        this.dom.querySelector('[data-role="mp-bot-button"]')?.addEventListener("click", () => this._showPanel("bot"));

        this.dom.querySelectorAll('[data-role="mp-bot-difficulty-button"]').forEach((button) => {
            button.addEventListener("click", () => this._beginBot(button.dataset.difficulty));
        });

        this.dom.querySelector('[data-role="mp-host-copy-button"]')?.addEventListener("click", (event) =>
            this._copyFrom('[data-role="mp-host-code"]', event.currentTarget));
        this.dom.querySelector('[data-role="mp-host-connect-button"]')?.addEventListener("click", () => this._completeHost());

        this.dom.querySelector('[data-role="mp-join-connect-button"]')?.addEventListener("click", () => this._beginJoin());
        this.dom.querySelector('[data-role="mp-join-copy-button"]')?.addEventListener("click", (event) =>
            this._copyFrom('[data-role="mp-join-answer-code"]', event.currentTarget));

        this.dom.querySelector('[data-role="mp-ready-button"]')?.addEventListener("click", () => this._toggleReady());
        this.dom.querySelector('[data-role="mp-start-button"]')?.addEventListener("click", () => this._hostStart());
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
        // Only tear down an unfinished handshake; a connected session survives
        // closing the dialog so score sync / rematches keep working.
        if (this.session && !this.session.isConnected) this._resetSession();
    }

    _onKeydown(event) {
        if (event.key === "Escape") this.close();
    }

    // --- role/host/join flow ---

    _showPanel(name) {
        const panels = this.panels;
        Object.entries(panels).forEach(([key, el]) => {
            if (el) el.hidden = key !== name;
        });
        this._updateSteps(name);
    }

    _updateSteps(name) {
        const info = STEP_BY_PANEL[name];
        const activeStep = info?.step ?? 1;

        this.dom.querySelectorAll('[data-role="mp-step"]').forEach((el) => {
            const step = Number(el.dataset.step);
            el.classList.toggle("mp-step--active", step === activeStep);
            el.classList.toggle("mp-step--done", step < activeStep);
        });

        const caption = this.dom.querySelector('[data-field="mp-step-caption"]');
        if (caption) caption.textContent = info ? this._t(info.labelKey) : "";
    }

    async _beginHost() {
        this._clearError();
        this._resetSession();
        this.role = "host";
        this.session = MultiplayerSession.createHost();
        this._bindSessionEvents();
        this._showPanel("host");

        const codeEl = this.dom.querySelector('[data-role="mp-host-code"]');
        const copyButton = this.dom.querySelector('[data-role="mp-host-copy-button"]');
        const answerWrap = this.dom.querySelector('[data-role="mp-host-answer-wrap"]');
        // The code isn't ready yet (ICE gathering can take a few seconds) - clear
        // the field so its "please wait, generating…" placeholder shows through,
        // disable copying until there's an actual code to copy, and keep the
        // "paste the guest's answer" section hidden until there's a code for
        // the guest to actually answer to.
        if (codeEl) codeEl.value = "";
        if (copyButton) copyButton.disabled = true;
        if (answerWrap) answerWrap.hidden = true;

        try {
            const code = await this.session.createRoom();
            if (codeEl) codeEl.value = code;
            if (copyButton) copyButton.disabled = false;
            // Only now can the host actually accept an answer, so this is the
            // first point it makes sense to show the paste field.
            if (answerWrap) answerWrap.hidden = false;
        } catch (err) {
            this._showError(err);
        }
    }

    async _completeHost() {
        this._clearError();
        const input = this.dom.querySelector('[data-role="mp-host-answer-input"]');
        const code = input?.value ?? "";

        try {
            await this.session.acceptGuest(code);
        } catch (err) {
            this._showError(err);
        }
    }

    async _beginJoin() {
        this._clearError();
        this._resetSession();
        this.role = "guest";
        this.session = MultiplayerSession.createGuest();
        this._bindSessionEvents();

        const hostCodeInput = this.dom.querySelector('[data-role="mp-join-code-input"]');
        const answerWrap = this.dom.querySelector('[data-role="mp-join-answer-wrap"]');
        const answerEl = this.dom.querySelector('[data-role="mp-join-answer-code"]');
        const copyButton = this.dom.querySelector('[data-role="mp-join-copy-button"]');

        // Same "please wait" treatment as the host's code while the answer is
        // being generated.
        if (answerEl) answerEl.value = "";
        if (copyButton) copyButton.disabled = true;
        if (answerWrap) answerWrap.hidden = false;

        try {
            const answerCode = await this.session.joinRoom(hostCodeInput?.value ?? "");
            if (answerEl) answerEl.value = answerCode;
            if (copyButton) copyButton.disabled = false;
        } catch (err) {
            if (answerWrap) answerWrap.hidden = true;
            this._showError(err);
        }
    }

    // --- practice vs bot ---

    /** Starts a local bot match: no session, no handshake - straight into the game. */
    _beginBot(difficultyKey) {
        if (!BOT_DIFFICULTIES[difficultyKey]) return;
        this._clearError();
        this._resetSession();
        this.role = "bot";

        const seed = randomSeed();
        // Same seed, two independent bags: the player's real game and the
        // bot's headless one now draw pieces in the exact same order.
        this.game.bag = new PieceBag(KLOCKOMINO_TYPES, mulberry32(seed));
        this.botOpponent = new BotOpponent({
            types: KLOCKOMINO_TYPES,
            cols: BOARD_CONFIG.COLS,
            rows: BOARD_CONFIG.ROWS,
            seed,
            difficultyKey,
        });
        this.botOpponent.addEventListener("message", (event) => this._onPeerMessage(event.detail));
        this._remoteName = this._t("multiplayer.botName", {difficulty: this._t(`difficulty.${difficultyKey}`)});
        this.game.multiplayerConnected = true;

        this._launchMatch();
        this.botOpponent.start();
    }

    _teardownBotMode() {
        if (!this.botOpponent && this.role !== "bot") return;
        this.botOpponent?.stop();
        this.botOpponent = null;
        // Restore true randomness now that no bot match is using the seeded
        // bag - a fresh instance rather than mutating game.bag's private
        // state, since PieceBag exposes no reset/reseed hook.
        this.game.bag = this._defaultBag;
        this.role = null;
    }

    _copyFrom(selector, button) {
        const el = this.dom.querySelector(selector);
        if (!el?.value) return;
        copyTextToClipboard(el.value).then((ok) => {
            if (!ok || !button) return;
            const original = button.textContent;
            button.textContent = "✓";
            setTimeout(() => (button.textContent = original), 1200);
        });
    }

    // --- ready / start handshake ---

    _bindSessionEvents() {
        const session = this.session;
        session.addEventListener("connected", () => {
            this._showPanel("ready");
            this._updateReadyBadges();
            this._setStatus(this._t("multiplayer.statusConnected"));
            this.game.multiplayerConnected = true;
            // Let the peer know our nickname so it can show it instead of the
            // generic "Opponent" label, on its ready badges, score badge and
            // final result line.
            this._sendToPeer({kind: "name", name: this.game.playerName || ""});
        });
        session.addEventListener("ready", () => this._updateReadyBadges());
        session.addEventListener("bothready", () => {
            this._setStatus(this._t(this.role === "host"
                ? "multiplayer.statusBothReadyHost"
                : "multiplayer.statusBothReadyGuest"));
            const startButton = this.dom.querySelector('[data-role="mp-start-button"]');
            if (startButton) startButton.hidden = this.role !== "host";
        });
        session.addEventListener("start", () => this._launchMatch());
        session.addEventListener("message", (event) => this._onPeerMessage(event.detail));
        session.addEventListener("disconnected", () => {
            this._setStatus(this._t("multiplayer.statusDisconnected"));
            this._stopScoreSync();
            this._hideOpponentUI();
            this.game.multiplayerConnected = false;
        });
        session.addEventListener("error", () => this._setStatus(this._t("multiplayer.statusError")));
    }

    _updateReadyBadges() {
        const local = this.dom.querySelector('[data-role="mp-local-ready-badge"]');
        const remote = this.dom.querySelector('[data-role="mp-remote-ready-badge"]');
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
        const button = this.dom.querySelector('[data-role="mp-ready-button"]');
        if (button) button.classList.toggle("button--accent", !this.session.localReady);
    }

    _hostStart() {
        if (!this.session || this.role !== "host") return;
        this.session.sendStart();
        this._launchMatch();
    }

    _launchMatch() {
        this.close();
        this._localFinalScore = null;
        this._remoteFinalScore = null;
        this._lastSentScore = -1;
        this._lastSentBoardVersion = -1;
        this._wasInMatch = false;
        this._showOpponentUI();

        const startButton = this.dom.querySelector('[data-role="start-button"]');
        startButton?.click();
        this._startScoreSync();
    }

    // --- in-match score sync ---

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

        if (inMatch) {
            // A rematch (e.g. "Play again" from the game-over screen) re-enters
            // a running state after a finished one — clear the previous result
            // so the new match's outcome isn't shadowed by the old one.
            if (this._localFinalScore !== null || this._remoteFinalScore !== null) {
                this._localFinalScore = null;
                this._remoteFinalScore = null;
                this._lastSentScore = -1;
                this._lastSentBoardVersion = -1;
                this._showOpponentUI();
            }

            this._wasInMatch = true;
            if (game.score !== this._lastSentScore) {
                this._lastSentScore = game.score;
                this._sendToPeer({kind: "score", score: game.score});
            }
            // The board's `version` only bumps on a lock/clear/garbage change
            // (see Board), so this stays cheap: most polls send nothing.
            if (game.board && game.board.version !== this._lastSentBoardVersion) {
                this._lastSentBoardVersion = game.board.version;
                this._sendToPeer({kind: "board", cells: Array.from(game.board.colors)});
            }
            return;
        }

        if (this._wasInMatch && FINISHED_STATES.has(game.state) && this._localFinalScore === null) {
            this._localFinalScore = game.score;
            this._sendToPeer({kind: "final", score: game.score});
            // A bot may never top out on its own (a good one can run
            // indefinitely) - once the player's round is over, lock in
            // whatever score it has right now instead of waiting on it.
            this.botOpponent?.finish();
            this._maybeShowResult();
        }

        if (!this._wasInMatch) return;
        if (!RUNNING_STATES.has(game.state) && !FINISHED_STATES.has(game.state)) {
            // Left the match entirely (e.g. back to idle) without a game-over — stop polling.
            this._stopScoreSync();
            this._wasInMatch = false;
            this._hideOpponentUI();
            this._teardownBotMode();
        }
    }

    _onPeerMessage(payload) {
        if (!payload || typeof payload !== "object") return;

        if (payload.kind === "score") {
            this._updateOpponentScore(payload.score);
        } else if (payload.kind === "final") {
            this._remoteFinalScore = payload.score;
            this._updateOpponentScore(payload.score);
            this._maybeShowResult();
        } else if (payload.kind === "name") {
            this._remoteName = (payload.name || "").trim() || null;
            this._updateReadyBadges();
            if (this._opponentNameEl) this._opponentNameEl.textContent = this._remoteDisplayName();
            this._updateOpponentScore(this._lastRemoteScore);
        } else if (payload.kind === "board") {
            this._drawOpponentBoard(payload.cells);
        }
    }

    _maybeShowResult() {
        if (this._localFinalScore === null || this._remoteFinalScore === null) return;

        let resultKey;
        if (this._localFinalScore > this._remoteFinalScore) resultKey = "multiplayer.won";
        else if (this._localFinalScore < this._remoteFinalScore) resultKey = "multiplayer.lost";
        else resultKey = "multiplayer.draw";

        const resultText = this._t("multiplayer.resultScore", {
            result: this._t(resultKey),
            local: formatNumber(this._localFinalScore),
            remote: formatNumber(this._remoteFinalScore),
            name: this._remoteDisplayName(),
        });
        this._setOpponentBadgeText(resultText);
        if (this._opponentScoreEl) this._opponentScoreEl.textContent = resultText;
        this._stopScoreSync();
        this.session?.setReady(false);
    }

    // --- opponent panel (nickname/score badge everywhere + full board on desktop) ---

    _showOpponentUI() {
        this._showOpponentBadge();
        this._showOpponentBoard();
    }

    _hideOpponentUI() {
        this._hideOpponentBadge();
        this._hideOpponentBoard();
    }

    /** Compact "name: score" text badge — shown everywhere (mobile included), hidden on
     *  desktop via CSS once the full board panel below covers the same info. */
    _showOpponentBadge() {
        this._hideOpponentBadge();
        const host = this.dom.querySelector('[data-role="stats-card"]') ?? this.dom.querySelector(".app__sidebar");
        if (!host) return;

        const badge = this.dom.createElement("div");
        badge.className = "mp-opponent-badge";
        badge.dataset.role = "mp-opponent-badge";
        badge.textContent = this._t("multiplayer.opponentScore", {score: 0, name: this._remoteDisplayName()});
        host.prepend(badge);
        this._opponentBadgeEl = badge;
        this._lastRemoteScore = 0;
    }

    _hideOpponentBadge() {
        this._opponentBadgeEl?.remove();
        this._opponentBadgeEl = null;
    }

    _setOpponentBadgeText(text) {
        if (this._opponentBadgeEl) this._opponentBadgeEl.textContent = text;
    }

    /** Updates both the text badge and the desktop panel's header score. */
    _updateOpponentScore(score) {
        this._lastRemoteScore = score;
        this._setOpponentBadgeText(this._t("multiplayer.opponentScore", {
            score: formatNumber(score),
            name: this._remoteDisplayName(),
        }));
        if (this._opponentScoreEl) this._opponentScoreEl.textContent = formatNumber(score);
    }

    /**
     * Full-size board rendered right next to the local one (desktop only,
     * see CSS) — same `.board`/`.board__canvas` markup and the same cell
     * size as the local board, for a literal 1:1 visual match, with the
     * opponent's nickname and score in a header above it.
     */
    _showOpponentBoard() {
        this._hideOpponentBoard();
        // Full-size board is desktop-only real estate (mirrors the site's own
        // `(width >= 48rem)` breakpoint for styles/desktop.css) — skip
        // building it at all on narrow viewports rather than relying on CSS
        // alone to hide it, so it doesn't nudge the mobile layout's sidebar
        // width bookkeeping in main.js.
        if (!globalThis.matchMedia?.("(width >= 48rem)").matches) return;

        const boardHost = this.dom.querySelector(".app__board");
        if (!boardHost) return;

        const panel = this.dom.createElement("div");
        panel.className = "app__sidebar mp-opponent-column";
        panel.dataset.role = "mp-opponent-panel";

        const header = this.dom.createElement("div");
        header.className = "mp-opponent-column__header";

        const name = this.dom.createElement("span");
        name.className = "mp-opponent-column__name";
        name.textContent = this._remoteDisplayName();
        header.appendChild(name);

        const score = this.dom.createElement("span");
        score.className = "mp-opponent-column__score";
        score.textContent = formatNumber(0);
        header.appendChild(score);

        panel.appendChild(header);

        const boardEl = this.dom.createElement("div");
        boardEl.className = "board mp-opponent-column__board";

        const stage = this.dom.createElement("div");
        stage.className = "board__stage";

        const canvas = this.dom.createElement("canvas");
        canvas.className = "board__canvas mp-opponent-column__canvas";
        canvas.dataset.role = "mp-opponent-canvas";
        const cellSize = BOARD_CONFIG.CELL_SIZE || OPPONENT_BOARD_FALLBACK_CELL_PX;
        canvas.width = cellSize * BOARD_CONFIG.COLS;
        canvas.height = cellSize * BOARD_CONFIG.ROWS;

        stage.appendChild(canvas);
        boardEl.appendChild(stage);
        panel.appendChild(boardEl);

        boardHost.insertAdjacentElement("afterend", panel);

        this._opponentPanelEl = panel;
        this._opponentNameEl = name;
        this._opponentScoreEl = score;
        this._opponentCanvasEl = canvas;
        this._opponentCanvasCtx = canvas.getContext("2d");
        this._drawOpponentBoard(null);

        // The panel takes up real horizontal space next to the board (it's
        // sized like a second board, not a slim stat column) — nudge the
        // layout to recompute the local board's size around it, the same
        // way a window resize would.
        this._notifyLayoutResize();
    }

    _hideOpponentBoard() {
        if (!this._opponentPanelEl) return;
        this._opponentPanelEl.remove();
        this._opponentPanelEl = null;
        this._opponentNameEl = null;
        this._opponentScoreEl = null;
        this._opponentCanvasEl = null;
        this._opponentCanvasCtx = null;
        this._notifyLayoutResize();
    }

    _notifyLayoutResize() {
        const target = globalThis.visualViewport ?? globalThis.window ?? null;
        target?.dispatchEvent(new Event("resize"));
    }

    /** The opponent's nickname once known over the data channel, else a generic fallback label. */
    _remoteDisplayName() {
        return this._remoteName || this._t("multiplayer.opponentFallback");
    }

    /**
     * Draws the opponent's locked board onto the desktop board panel's
     * canvas. `cells` is the flat colorIndex array from Board#colors
     * (row-major, 0 = empty); null/undefined clears the board (e.g. right
     * after a rematch).
     */
    _drawOpponentBoard(cells) {
        const ctx = this._opponentCanvasCtx;
        const canvas = this._opponentCanvasEl;
        if (!ctx || !canvas) return;

        const {COLS, ROWS} = BOARD_CONFIG;
        const size = canvas.width / COLS;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (cells) {
            for (let y = 0; y < ROWS; y++) {
                for (let x = 0; x < COLS; x++) {
                    const colorIndex = cells[y * COLS + x];
                    if (!colorIndex) continue;
                    ctx.fillStyle = COLOR_PALETTE[colorIndex] ?? "#888";
                    ctx.fillRect(x * size, y * size, size, size);
                }
            }
        }
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

    // --- helpers ---

    _t(key, vars = {}) {
        return this.i18n ? this.i18n.t(key, vars) : key;
    }

    _setStatus(text) {
        const el = this.dom.querySelector('[data-field="mp-status-text"]');
        if (el) el.textContent = text;
    }

    _showError(err) {
        const el = this.dom.querySelector('[data-field="mp-error-text"]');
        if (!el) return;
        el.textContent = err?.message || this._t("multiplayer.genericError");
        el.hidden = false;
    }

    _clearError() {
        const el = this.dom.querySelector('[data-field="mp-error-text"]');
        if (el) el.hidden = true;
    }

    _resetSession() {
        this._stopScoreSync();
        this._hideOpponentUI();
        this._teardownBotMode();
        this.session?.close();
        this.session = null;
        this.role = null;
        this.game.multiplayerConnected = false;
        this._remoteName = null;
        this._lastRemoteScore = 0;
        this._lastSentBoardVersion = -1;
    }
}
