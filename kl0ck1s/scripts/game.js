"use strict";

import {Piece} from "./piece.js";
import {dropIntervalForLevel, formatDuration, formatNumber, tierForLevel} from "./utils.js";
import {levelForLines, pointsForHardDrop, pointsForLineClear, pointsForSoftDrop, pointsForSpin} from "./scoring.js";

export class Game {
    static T_FRONT_CORNERS = [
        ["topLeft", "topRight"],
        ["topRight", "bottomRight"],
        ["bottomLeft", "bottomRight"],
        ["topLeft", "bottomLeft"],
    ];

    static JLSTZ_KICKS = {
        "0>1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
        "1>2": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
        "2>3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
        "3>0": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    };

    static I_KICKS = {
        "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
        "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
        "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
        "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    };

    static O_KICKS = {
        "0>1": [[0, 0]],
        "1>2": [[0, 0]],
        "2>3": [[0, 0]],
        "3>0": [[0, 0]],
    };

    static SETTINGS_KEY = "klockis-settings";
    static APP_NAME = "Kl0ck1's";
    static NICKNAME_PATTERN = /^[a-zA-Z0-9_-]{3,16}$/;
    static COUNTDOWN_STEPS = [
        {number: 3, tint: "red"},
        {number: 2, tint: "yellow"},
        {number: 1, tint: "green"},
    ];

    constructor({
                    board,
                    bag,
                    renderer,
                    hud,
                    soundManager,
                    leaderboard,
                    screens,
                    difficulties,
                    defaultDifficulty,
                    boardBackgrounds,
                    scoring,
                    levelUpBannerDuration,
                    lineClearAnimationDuration,
                    countdownStepDuration = 500,
                    settingsStore = null,
                    vhsNoise = null,
                    matrixRain = null,
                    rain = null,
                    snow = null,
                    dom = globalThis.document ?? null,
                    i18n,
                }) {
        this.board = board;
        this.bag = bag;
        this.renderer = renderer;
        this.hud = hud;
        this.soundManager = soundManager;
        this.leaderboard = leaderboard;
        this.screens = screens;
        this.difficulties = difficulties;
        this.difficulty = defaultDifficulty;
        this.boardBackgrounds = boardBackgrounds;
        this.scoring = scoring;
        this.levelUpBannerDuration = levelUpBannerDuration;
        this.lineClearAnimationDuration = lineClearAnimationDuration;
        this.countdownStepDuration = countdownStepDuration;
        this.settingsStore = settingsStore ?? leaderboard.store;
        this.vhsNoise = vhsNoise;
        this.matrixRain = matrixRain;
        this.rain = rain;
        this.snow = snow;
        this.dom = dom;
        this.i18n = i18n;
        this.settings = this.defaultSettings();
        this.lastTime = 0;
        this.activeEffect = "none";
        this.previousStateBeforeOptions = null;
        this.isPlayingSession = false;
    }

    get stats() {
        const linesPerLevel = this.scoring.LINES_PER_LEVEL;
        const progressPercent = linesPerLevel
            ? Math.floor(((this.lines % linesPerLevel) / linesPerLevel) * 100)
            : 0;

        const totalClears = Object.values(this.clearCounts).reduce((sum, n) => sum + n, 0);
        const tetrisRatePercent = totalClears ? (this.clearCounts[4] / totalClears) * 100 : 0;

        const elapsedSeconds = this.elapsedMs / 1000;
        const pps = elapsedSeconds > 0 ? this.piecesSpawned / elapsedSeconds : 0;
        const efficiencyValue = this.lines > 0 ? this.score / this.lines : 0;

        return {
            score: formatNumber(this.score),
            level: this.level,
            lines: this.lines,
            best: formatNumber(this.leaderboard.bestScore()),
            difficulty: `${this.i18n.t(`difficulty.${this.levelTier}`)} ${this.level}`,
            difficultyPercent: progressPercent,
            gameTime: formatDuration(this.elapsedMs),
            drought: this.drought,
            maxDrought: this.maxDrought,
            tetrisRate: `${tetrisRatePercent.toFixed(1)}%`,
            singles: this.clearCounts[1],
            doubles: this.clearCounts[2],
            triples: this.clearCounts[3],
            tetrises: this.clearCounts[4],
            pps: pps.toFixed(2),
            tSpins: this.spinCounts.t,
            tSpinMinis: this.spinCounts.tMini,
            otherSpins: this.spinCounts.other,
            maxCombo: this.maxCombo,
            efficiency: formatNumber(Math.round(efficiencyValue)),
        };
    }

    static getKickTable(type) {
        if (type === "I") return Game.I_KICKS;
        if (type === "O") return Game.O_KICKS;

        return Game.JLSTZ_KICKS;
    }

    /** Tracks the "drought": how many pieces in a row have appeared since the last "I" piece. */
    registerPieceSpawn(type) {
        this.piecesSpawned += 1;
        this.drought = type === "I" ? 0 : this.drought + 1;
        this.maxDrought = Math.max(this.maxDrought, this.drought);
    }

    defaultSettings() {
        return {
            volume: 1, muted: false, glow: true, transparency: true, effect: "vhs", hudRight: false,
            ghost: true, gridLines: true, skipCountdown: false,
        };
    }

    prefersReducedMotion() {
        const media = globalThis.matchMedia;
        return media ? media("(prefers-reduced-motion: reduce)").matches : false;
    }

    async init() {
        this.soundManager.init();
        await this.loadSettings();
        this.applyDifficultyTheme();
        this.prepareNewRound();
        this.showIdleScreen().then();
        this.bindControls();
        this.bindControlsToggle();
        requestAnimationFrame(this.loop.bind(this));
    }

    renderLeaderboard(list, highlightEntry = null) {
        return this.leaderboard.renderTable(list, highlightEntry);
    }

    prepareNewRound() {
        const startLevel = this.difficulties[this.difficulty].startLevel;

        this.board.reset();
        this.score = 0;
        this.lines = 0;
        this.startLevel = startLevel;
        this.level = startLevel;
        this.levelTier = tierForLevel(this.level, this.difficulties);
        this.dropInterval = dropIntervalForLevel(startLevel, this.scoring);
        this.dropCounter = 0;
        this.lockDelayTimer = 0;
        this.lockDelayResets = 0;
        this.groundedTime = 0;
        this.lastAction = null;
        this.pendingSpin = null;
        this.rotationAnim = null;
        this.hardDropUsed = false;
        this.clearingLines = [];
        this.clearingTimer = 0;
        this.levelUpTimer = 0;
        this.levelUpLevel = null;

        this.elapsedMs = 0;
        this.drought = 0;
        this.maxDrought = 0;
        this.clearCounts = {1: 0, 2: 0, 3: 0, 4: 0};
        this.piecesSpawned = 0;
        this.spinCounts = {t: 0, tMini: 0, other: 0};
        this.currentCombo = 0;
        this.maxCombo = 0;

        this.current = new Piece(this.bag.next(), {cols: this.board.cols});
        this.registerPieceSpawn(this.current.type);
        this.next = this.bag.next();
        this.renderer.drawNext(this.next);

        this.applyLevelTheme();
        this.hud.update(this.stats);
    }

    async showIdleScreen() {
        this.state = "idle";
        this.isPlayingSession = false;
        this.hud.setPlaying(false);
        this.hud.setHasPlayedBefore(false);
        this.hud.showScreen(this.screens.loading(
            Game.APP_NAME, this.i18n.t("screens.loading.leaderboardHint"), this.dom
        ));

        const [list, lastName] = await Promise.all([
            this.leaderboard.load(),
            this.leaderboard.loadLastName(),
        ]);
        if (this.state !== "idle") return;

        this.playerName = lastName;
        this.renderIdleScreen(list);
        this.hud.update(this.stats);
    }

    renderIdleScreen(list) {
        this.currentIdleList = list;
        this.hud.showScreen(
            this.screens.idle(
                list, this.difficulty, this.difficulties, (l, h) => this.renderLeaderboard(l, h), this.dom, this.i18n, this.playerName
            )
        );
        this.bindDifficultyButtons(() => this.renderIdleScreen(list));
        this.bindNameInput();
    }

    bindNameInput() {
        if (!this.dom) return;
        const input = this.dom.querySelector('[data-role="name-input"]');
        if (!input) return;

        input.value = this.playerName || "";
        input.addEventListener("input", (e) => {
            e.target.value = e.target.value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 16);
            this.playerName = e.target.value;
            input.classList.remove("nickname-form__input--invalid");
        });
        input.addEventListener("change", () => {
            this.leaderboard.setLastName(this.playerName);
        });
    }

    setDifficulty(difficulty) {
        this.difficulty = difficulty;
        this.levelTier = difficulty;

        if (this.state === "idle" || this.state === "gameOver-saved") {
            this.level = this.difficulties[difficulty].startLevel;
            this.lines = 0;
        }

        this.applyDifficultyTheme();
        this.settings.difficulty = difficulty;
        this.saveSettings();
        this.hud.update(this.stats);
    }

    bindDifficultyButtons(onChange) {
        if (!this.dom) return;
        this.dom
            .querySelectorAll('[data-role="difficulty-button"]')
            .forEach((btn) =>
                btn.addEventListener("click", ({currentTarget}) => {
                    this.setDifficulty(currentTarget.dataset.difficulty);
                    onChange();
                })
            );
    }

    changeDifficulty(dir) {
        const keys = Object.keys(this.difficulties);
        const currentIndex = keys.indexOf(this.difficulty);
        const nextDifficulty = keys[(currentIndex + dir + keys.length) % keys.length];
        this.setDifficulty(nextDifficulty);

        if (this.state === "idle") {
            this.renderIdleScreen(this.currentIdleList);
        } else if (this.state === "gameOver-saved" && this.currentGameOverSaved) {
            const {list, entry} = this.currentGameOverSaved;
            this.renderGameOverSaved(list, entry);
        }
    }

    applyDifficultyTheme() {
        const color = this.boardBackgrounds?.[this.difficulty];
        if (color) this.renderer.setTheme(color);
    }

    applyLevelTheme() {
        const color = this.boardBackgrounds?.[this.levelTier];
        if (color) this.renderer.setTheme(color);
    }

    startCountdown() {
        this.prepareNewRound();
        this.hud.setHasPlayedBefore(true);

        if (this.settings.skipCountdown) {
            this.start();
            return;
        }

        this.state = "countdown";
        this.isPlayingSession = false;
        this.hud.setPlaying(false);
        this.countdownIndex = 0;
        this.countdownTimer = 0;

        const {number, tint} = Game.COUNTDOWN_STEPS[this.countdownIndex];
        this.hud.showScreen(
            this.screens.countdown(number, tint, this.dom, this.i18n),
            {transparentOverlay: true}
        );
    }

    advanceCountdownStep() {
        const {number, tint} = Game.COUNTDOWN_STEPS[this.countdownIndex];
        if (!this.hud.updateCountdown(number, tint)) {
            this.renderCountdownStep();
        }
    }

    renderCountdownStep() {
        const {number, tint} = Game.COUNTDOWN_STEPS[this.countdownIndex];
        this.hud.showScreen(
            this.screens.countdown(number, tint, this.dom, this.i18n),
            {transparentOverlay: true}
        );
    }

    start() {
        this.state = "running";
        this.isPlayingSession = true;
        this.hud.setPlaying(true);
        this.hud.hideOverlay();
    }

    spawnNext() {
        this.current = new Piece(this.next, {cols: this.board.cols});
        this.registerPieceSpawn(this.current.type);
        this.next = this.bag.next();
        this.hardDropUsed = false;
        this.lockDelayTimer = 0;
        this.lockDelayResets = 0;
        this.groundedTime = 0;
        this.lastAction = null;
        this.rotationAnim = null;
        this.renderer.drawNext(this.next);

        if (this.board.collides(this.current, 0, 0)) {
            this.gameOver().then();
        }
    }

    async gameOver() {
        this.state = "gameOver-entry";
        this.isPlayingSession = false;
        this.hud.setPlaying(false);
        this.soundManager.play("gameOver");
        this.hud.showScreen(this.screens.loading(
            this.i18n.t("screens.gameOverEntry.title"), this.i18n.t("screens.loading.leaderboardHint"), this.dom
        ));

        await this.leaderboard.load();
        await this.leaderboard.loadTodayBest();
        if (this.state !== "gameOver-entry") return;

        const name = this.playerName || this.i18n.t("leaderboard.defaultName");
        const entry = {
            name,
            score: this.score,
            level: this.level,
            lines: this.lines,
            date: new Date().toISOString(),
        };

        const todayBestBeforeThisGame = this.leaderboard.todayBestEntry();

        const list = await this.leaderboard.add(entry);
        await this.leaderboard.recordIfTodayBest(entry);
        if (this.state !== "gameOver-entry") return;

        this.renderGameOverEntry(list, entry, todayBestBeforeThisGame);
    }

    renderGameOverEntry(list, entry, todayBestBeforeThisGame) {
        this.currentGameOverEntry = {list, entry, todayBestBeforeThisGame};
        this.hud.showScreen(
            this.screens.gameOverEntry(
                this.stats, list, entry, todayBestBeforeThisGame, (l, h) => this.renderLeaderboard(l, h), this.dom, this.i18n
            )
        );
        this.bindGameOverContinue();
    }

    bindGameOverContinue() {
        if (!this.dom) return;
        const button = this.dom.querySelector('[data-role="gameover-continue-button"]');
        if (!button) return;
        button.addEventListener("click", () => this.continueFromGameOverEntry(), {once: true});
    }

    continueFromGameOverEntry() {
        if (this.state !== "gameOver-entry" || !this.currentGameOverEntry) return;
        const {list, entry} = this.currentGameOverEntry;
        this.state = "gameOver-saved";
        this.level = this.difficulties[this.difficulty].startLevel;
        this.lines = 0;
        this.hud.update(this.stats);
        this.renderGameOverSaved(list, entry);
    }

    renderGameOverSaved(list, entry) {
        this.currentGameOverSaved = {list, entry};
        this.hud.showScreen(
            this.screens.gameOverSaved(
                list, entry, (l, h) => this.renderLeaderboard(l, h),
                this.difficulty, this.difficulties, this.dom, this.i18n, this.playerName
            )
        );
        this.bindDifficultyButtons(() => this.renderGameOverSaved(list, entry));
        this.bindNameInput();
    }

    togglePause() {
        if (this.state === "running") {
            this.state = "paused";
            this.renderPauseMenu();
        } else if (this.state === "paused") {
            this.state = "running";
            this.hud.hideOverlay();
        }
    }

    restart() {
        if (!["running", "paused", "clearing", "countdown", "gameOver-entry", "gameOver-saved"].includes(this.state)) {
            return;
        }
        this.startCountdown();
    }

    handleEscape() {
        if (this.state === "options") {
            this.toggleOptions();
        } else {
            this.togglePause();
        }
    }

    renderPauseMenu() {
        this.hud.showScreen(this.screens.paused(this.dom, this.i18n));
        this.bindPauseMenu();
    }

    bindPauseMenu() {
        if (!this.dom) return;
        const resumeButton = this.dom.querySelector('[data-role="resume-button"]');

        if (resumeButton) {
            resumeButton.addEventListener("click", () => this.togglePause());
        }
    }

    toggleSound() {
        this.settings.muted = !this.settings.muted;
        this.soundManager.setMuted(this.settings.muted);
        this.saveSettings();

        if (!this.dom) return;
        const muteCheckbox = this.dom.querySelector('[data-role="mute-checkbox"]');
        const volumeSlider = this.dom.querySelector('[data-role="volume-slider"]');
        if (muteCheckbox) muteCheckbox.checked = this.settings.muted;
        if (volumeSlider) volumeSlider.disabled = this.settings.muted;
    }

    async loadSettings() {
        let settings = this.defaultSettings();
        let hasStoredSettings = false;

        try {
            const storedRaw = await this.settingsStore.get(Game.SETTINGS_KEY);
            if (storedRaw) {
                settings = {...settings, ...JSON.parse(storedRaw)};
                hasStoredSettings = true;
            }
        } catch {
            settings = this.defaultSettings();
        }

        if (!hasStoredSettings && this.prefersReducedMotion()) {
            settings.effect = "none";
        }

        this.settings = settings;
        if (settings.difficulty && this.difficulties[settings.difficulty]) {
            this.difficulty = settings.difficulty;
        }
        this.soundManager.setVolume(settings.volume);
        this.soundManager.setMuted(settings.muted);
        this.applyPerformanceSettings();
    }

    saveSettings() {
        return this.settingsStore.set(Game.SETTINGS_KEY, JSON.stringify(this.settings));
    }

    applyPerformanceSettings() {
        const {glow, transparency, effect, ghost, gridLines} = this.settings;
        this.renderer.setGlowEnabled(glow);
        this.renderer.setTransparencyEnabled(transparency);
        this.renderer.setGhostEnabled(ghost);
        this.renderer.setGridEnabled(gridLines);

        const body = this.dom?.body;
        if (body) {
            body.classList.toggle("perf-no-glow", !glow);
            body.classList.toggle("perf-no-transparency", !transparency);
            body.classList.toggle("hud-right", Boolean(this.settings.hudRight));
        }

        this.activeEffect = effect ?? "none";
        this.updateEffectOverlay();
    }

    updateEffectOverlay() {
        if (!this.dom) return;
        const overlayEl = this.dom.getElementById("filter-overlay");
        const effect = this.activeEffect;
        const active = effect !== "none" && (this.state === "running" || this.state === "clearing");

        if (overlayEl) {
            overlayEl.classList.toggle("board__filter--active", active);
            overlayEl.dataset.effect = effect;
        }

        if (this.vhsNoise) {
            if (active && effect === "vhs") this.vhsNoise.start();
            else this.vhsNoise.stop();
        }

        if (this.matrixRain) {
            if (active && effect === "matrix") this.matrixRain.start();
            else this.matrixRain.stop();
        }

        if (this.rain) {
            if (active && effect === "rain") this.rain.start();
            else this.rain.stop();
        }

        if (this.snow) {
            if (active && effect === "snow") this.snow.start();
            else this.snow.stop();
        }
    }

    toggleOptions() {
        if (this.state === "options") {
            const previousState = this.previousStateBeforeOptions ?? "idle";
            this.previousStateBeforeOptions = null;
            this.state = previousState;

            if (previousState === "running") {
                this.hud.hideOverlay();
            } else if (previousState === "paused") {
                this.renderPauseMenu();
            } else if (previousState === "idle") {
                this.renderIdleScreen(this.currentIdleList ?? []);
            } else if (previousState === "gameOver-saved" && this.currentGameOverSaved) {
                const {list, entry} = this.currentGameOverSaved;
                this.renderGameOverSaved(list, entry);
            } else if (previousState === "gameOver-entry" && this.currentGameOverEntry) {
                const {list, entry, todayBestBeforeThisGame} = this.currentGameOverEntry;
                this.renderGameOverEntry(list, entry, todayBestBeforeThisGame);
            }

            return;
        }

        if (!["idle", "running", "paused", "gameOver-saved", "gameOver-entry"].includes(this.state)) return;

        this.previousStateBeforeOptions = this.state;
        this.state = "options";
        this.renderOptionsMenu();
    }

    renderOptionsMenu() {
        this.hud.showScreen(this.screens.options(this.settings, this.dom, this.i18n));
        this.bindOptionsMenu();
    }

    bindOptionsMenu() {
        if (!this.dom) return;
        const muteCheckbox = this.dom.querySelector('[data-role="mute-checkbox"]');
        const volumeSlider = this.dom.querySelector('[data-role="volume-slider"]');
        const hudRightCheckbox = this.dom.querySelector('[data-role="hud-right-checkbox"]');
        const ghostCheckbox = this.dom.querySelector('[data-role="ghost-checkbox"]');
        const gridCheckbox = this.dom.querySelector('[data-role="grid-checkbox"]');
        const glowCheckbox = this.dom.querySelector('[data-role="glow-checkbox"]');
        const transparencyCheckbox = this.dom.querySelector('[data-role="transparency-checkbox"]');
        const effectSelect = this.dom.querySelector('[data-role="effect-select"]');
        const skipCountdownCheckbox = this.dom.querySelector('[data-role="skip-countdown-checkbox"]');
        const closeButton = this.dom.querySelector('[data-role="options-close-button"]');

        if (muteCheckbox) {
            muteCheckbox.addEventListener("change", () => {
                this.settings.muted = muteCheckbox.checked;
                this.soundManager.setMuted(this.settings.muted);
                if (volumeSlider) volumeSlider.disabled = this.settings.muted;
                this.saveSettings();
            });
        }

        if (volumeSlider) {
            volumeSlider.addEventListener("input", () => {
                this.settings.volume = volumeSlider.value / 100;
                this.soundManager.setVolume(this.settings.volume);
                this.saveSettings();
            });
        }

        if (hudRightCheckbox) {
            hudRightCheckbox.addEventListener("change", () => {
                this.settings.hudRight = hudRightCheckbox.checked;
                this.applyPerformanceSettings();
                this.saveSettings();
            });
        }

        if (ghostCheckbox) {
            ghostCheckbox.addEventListener("change", () => {
                this.settings.ghost = ghostCheckbox.checked;
                this.applyPerformanceSettings();
                this.saveSettings();
            });
        }

        if (gridCheckbox) {
            gridCheckbox.addEventListener("change", () => {
                this.settings.gridLines = gridCheckbox.checked;
                this.applyPerformanceSettings();
                this.saveSettings();
            });
        }

        if (glowCheckbox) {
            glowCheckbox.addEventListener("change", () => {
                this.settings.glow = glowCheckbox.checked;
                this.applyPerformanceSettings();
                this.saveSettings();
            });
        }

        if (transparencyCheckbox) {
            transparencyCheckbox.addEventListener("change", () => {
                this.settings.transparency = transparencyCheckbox.checked;
                this.applyPerformanceSettings();
                this.saveSettings();
            });
        }

        if (effectSelect) {
            effectSelect.addEventListener("change", () => {
                this.settings.effect = effectSelect.value;
                this.applyPerformanceSettings();
                this.saveSettings();
            });
        }

        if (skipCountdownCheckbox) {
            skipCountdownCheckbox.addEventListener("change", () => {
                this.settings.skipCountdown = skipCountdownCheckbox.checked;
                this.saveSettings();
            });
        }

        if (closeButton) {
            closeButton.addEventListener("click", () => this.toggleOptions());
        }

        this.bindLangSelect();
    }

    bindLangSelect() {
        if (!this.dom) return;
        const select = this.dom.querySelector('[data-role="lang-select"]');
        if (!select) return;

        select.addEventListener("change", async () => {
            const lang = select.value;
            if (lang === this.i18n.lang) return;

            await this.i18n.setLanguage(lang);
            this.refreshLanguage();
        });
    }

    toggleControlsList() {
        if (!this.dom) return;
        const list = this.dom.querySelector('[data-role="controls-list"]');
        if (list) list.classList.toggle("controls__list--collapsed");
    }

    bindControlsToggle() {
        if (!this.dom) return;
        const title = this.dom.querySelector('[data-role="controls-toggle"]');
        if (!title) return;
        title.addEventListener("click", () => this.toggleControlsList());
    }

    refreshLanguage() {
        if (this.dom) this.i18n.applyStatic(this.dom);
        this.hud.setPlaying(this.isPlayingSession);
        this.hud.update(this.stats);
        this.refreshCurrentScreen();
    }

    refreshCurrentScreen() {
        if (this.state === "idle") {
            this.renderIdleScreen(this.currentIdleList ?? []);
        } else if (this.state === "paused") {
            this.renderPauseMenu();
        } else if (this.state === "options") {
            this.renderOptionsMenu();
        } else if (this.state === "gameOver-saved" && this.currentGameOverSaved) {
            const {list, entry} = this.currentGameOverSaved;
            this.renderGameOverSaved(list, entry);
        }
    }

    handleEnter() {
        if (this.state === "idle" || this.state === "gameOver-saved") {
            if (!this.isNicknameValid()) return;
            if (this.playerName) this.leaderboard.setLastName(this.playerName);
            this.startCountdown();
        } else if (this.state === "gameOver-entry") {
            this.continueFromGameOverEntry();
        }
    }

    isNicknameValid() {
        if (!this.dom) return true;
        const input = this.dom.querySelector('[data-role="name-input"]');
        if (!input) return true;

        const valid = Game.NICKNAME_PATTERN.test(this.playerName || "");
        input.classList.toggle("nickname-form__input--invalid", !valid);
        if (!valid) {
            input.reportValidity();
            input.focus();
        }
        return valid;
    }

    addScore(points) {
        this.score += points;
        this.hud.update(this.stats);
    }

    registerLineClears(cleared, playSound = true) {
        if (cleared === 0) return;

        this.clearCounts[cleared] = (this.clearCounts[cleared] ?? 0) + 1;

        if (playSound) this.soundManager.play("lineClear");

        this.lines += cleared;
        this.addScore(pointsForLineClear(cleared, this.level, this.scoring));

        const newLevel = levelForLines(this.lines, this.startLevel, this.scoring);
        if (newLevel !== this.level) {
            this.level = newLevel;
            this.dropInterval = dropIntervalForLevel(this.level, this.scoring);
            this.levelTier = tierForLevel(this.level, this.difficulties);
            this.applyLevelTheme();

            this.soundManager.play("levelUp");
            this.levelUpLevel = this.level;
            this.levelUpTimer = this.levelUpBannerDuration;
        }

        this.hud.update(this.stats);
    }

    detectSpin() {
        if (this.lastAction !== "rotate") return null;
        if (this.board.countBlockedCorners(this.current) < 3) return null;

        if (this.current.type !== "T") {
            return {type: this.current.type, mini: false};
        }

        const flags = this.board.getCornerFlags(this.current);
        const frontKeys = Game.T_FRONT_CORNERS[this.current.rotationState % 4];
        const frontBlocked = frontKeys.every((key) => flags[key]);

        return {type: "T", mini: !frontBlocked};
    }

    registerSpin(spin, cleared) {
        if (spin.type === "T") {
            if (spin.mini) this.spinCounts.tMini += 1;
            else this.spinCounts.t += 1;
        } else {
            this.spinCounts.other += 1;
        }
        this.addScore(pointsForSpin(spin.type, cleared, this.level, spin.mini));
    }

    lockCurrentPiece() {
        const spin = this.detectSpin();

        this.soundManager.play("drop");
        this.board.lockPiece(this.current);

        const fullRows = this.board.getFullLineIndices();

        if (fullRows.length === 0) {
            if (spin) this.registerSpin(spin, 0);
            this.currentCombo = 0;
            this.spawnNext();
            return;
        }

        this.pendingSpin = spin;
        this.soundManager.play("lineClear");
        this.state = "clearing";
        this.clearingLines = fullRows;
        this.clearingTimer = 0;
    }

    finishLineClear() {
        const cleared = this.board.clearFullLines();
        if (this.pendingSpin) this.registerSpin(this.pendingSpin, cleared);
        this.registerLineClears(cleared, false);

        this.currentCombo += 1;
        this.maxCombo = Math.max(this.maxCombo, this.currentCombo);

        this.pendingSpin = null;
        this.clearingLines = [];
        this.dropCounter = 0;
        this.state = "running";
        this.spawnNext();
    }

    resetLockDelay() {
        if (this.lockDelayResets >= this.scoring.LOCK_DELAY_MAX_RESETS) return;
        this.lockDelayTimer = 0;
        this.lockDelayResets += 1;
    }

    moveHorizontal(dir) {
        if (this.state !== "running") return;
        if (!this.board.collides(this.current, dir, 0)) {
            this.current.x += dir;
            this.lastAction = "move";
            if (this.board.collides(this.current, 0, 1)) this.resetLockDelay();
        }
    }

    handleHorizontalArrow(dir) {
        if (this.state === "idle" || this.state === "gameOver-saved") {
            this.changeDifficulty(dir);
        } else {
            this.moveHorizontal(dir);
        }
    }

    softDrop() {
        if (this.state !== "running") return;
        if (this.board.collides(this.current, 0, 1)) return;

        this.current.y += 1;
        this.lastAction = "move";
        this.addScore(pointsForSoftDrop(this.scoring));
        this.dropCounter = 0;
    }

    hardDrop() {
        if (this.state !== "running") return;
        if (this.hardDropUsed) return;

        this.hardDropUsed = true;

        const cellsDropped = this.board.getDropOffset(this.current);
        this.current.y += cellsDropped;

        this.addScore(pointsForHardDrop(cellsDropped, this.scoring));
        this.lockCurrentPiece();
        this.dropCounter = 0;
    }

    rotate() {
        if (this.state !== "running") return;

        const rotatedShape = this.current.rotated();
        const fromState = this.current.rotationState;
        const toState = (fromState + 1) % 4;
        const kicks = Game.getKickTable(this.current.type)[`${fromState}>${toState}`];

        for (const [dx, dy] of kicks) {
            if (!this.board.collides(this.current, dx, dy, rotatedShape)) {
                const fromX = this.current.x;
                const fromY = this.current.y;

                this.current.shape = rotatedShape;
                this.current.x += dx;
                this.current.y += dy;
                this.current.rotationState = toState;
                this.lastAction = "rotate";
                if (this.board.collides(this.current, 0, 1)) this.resetLockDelay();

                this.rotationAnim = {fromX, fromY, toX: this.current.x, toY: this.current.y, elapsed: 0, duration: 60};
                return;
            }
        }
    }

    bindControls() {
        if (!this.dom) return;

        const KEY_ACTIONS = {
            ArrowLeft: () => this.handleHorizontalArrow(-1),
            ArrowRight: () => this.handleHorizontalArrow(1),
            ArrowDown: () => this.softDrop(),
            ArrowUp: () => this.rotate(),
            Space: () => this.hardDrop(),
            Enter: () => this.handleEnter(),
            Escape: () => this.handleEscape(),
            KeyH: () => this.toggleControlsList(),
            KeyM: () => this.toggleSound(),
            KeyO: () => this.toggleOptions(),
            KeyP: () => this.togglePause(),
            KeyZ: () => this.rotate(),
            KeyR: () => this.restart(),
        };

        const PREVENT_DEFAULT_KEYS = new Set([
            "ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space", "Enter", "Escape"
        ]);

        const REPEATABLE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowDown"]);
        const REPEAT_INITIAL_DELAY_MS = 100;
        const REPEAT_INTERVAL_MS = 50;
        const heldTimers = new Map();

        const stopRepeat = (code) => {
            const timers = heldTimers.get(code);
            if (!timers) return;
            if (timers.timeoutId !== undefined) clearTimeout(timers.timeoutId);
            if (timers.intervalId !== undefined) clearInterval(timers.intervalId);
            heldTimers.delete(code);
        };

        const startRepeat = (code, action) => {
            stopRepeat(code);
            const timeoutId = setTimeout(() => {
                const intervalId = setInterval(action, REPEAT_INTERVAL_MS);
                heldTimers.set(code, {intervalId});
            }, REPEAT_INITIAL_DELAY_MS);
            heldTimers.set(code, {timeoutId});
        };

        const isTypingInField = (event) => {
            const tag = event.target.tagName;
            return tag === "INPUT" || tag === "TEXTAREA";
        };

        this.dom.addEventListener("keydown", (event) => {
            if (isTypingInField(event) && event.code !== "Enter") return;

            if (PREVENT_DEFAULT_KEYS.has(event.code)) event.preventDefault();

            const action = KEY_ACTIONS[event.code];
            if (!action) return;

            if (REPEATABLE_KEYS.has(event.code)) {
                if (event.repeat) return;
                action();
                startRepeat(event.code, action);
                return;
            }

            if (event.repeat && event.code === "Space") return;
            action();
        });

        this.dom.addEventListener("keyup", (event) => stopRepeat(event.code), {passive: true});

        if (globalThis.window) {
            window.addEventListener("blur", () => {
                heldTimers.forEach((timers) => {
                    if (timers.timeoutId !== undefined) clearTimeout(timers.timeoutId);
                    if (timers.intervalId !== undefined) clearInterval(timers.intervalId);
                });
                heldTimers.clear();
            });
        }
    }

    update(delta) {
        if (this.rotationAnim) {
            this.rotationAnim.elapsed += delta;
            if (this.rotationAnim.elapsed >= this.rotationAnim.duration) {
                this.rotationAnim = null;
            }
        }

        if (this.levelUpTimer > 0) {
            this.levelUpTimer = Math.max(0, this.levelUpTimer - delta);
        }

        if (this.state === "running" || this.state === "clearing") {
            this.elapsedMs += delta;
            this.hud.update(this.stats);
        }

        if (this.state === "countdown") {
            this.countdownTimer += delta;
            if (this.countdownTimer >= this.countdownStepDuration) {
                this.countdownTimer = 0;
                this.countdownIndex += 1;
                if (this.countdownIndex >= Game.COUNTDOWN_STEPS.length) {
                    this.start();
                } else {
                    this.advanceCountdownStep();
                }
            }
            return;
        }

        if (this.state === "clearing") {
            this.clearingTimer += delta;
            if (this.clearingTimer >= this.lineClearAnimationDuration) {
                this.finishLineClear();
            }
            return;
        }

        if (this.state !== "running") return;

        const resting = this.board.collides(this.current, 0, 1);

        if (resting) {
            this.lockDelayTimer += delta;
            this.groundedTime += delta;
            const maxGroundedTime = this.difficulties[this.levelTier]?.groundedTime ?? this.scoring.MAX_GROUNDED_TIME;
            if (this.lockDelayTimer >= this.scoring.LOCK_DELAY || this.groundedTime >= maxGroundedTime) {
                this.lockCurrentPiece();
            }
            return;
        }

        this.lockDelayTimer = 0;
        this.dropCounter += delta;
        if (this.dropCounter > this.dropInterval) {
            this.current.y += 1;
            this.dropCounter = 0;
        }
    }

    getRenderedPiece() {
        if (!this.rotationAnim) return this.current;

        const t = Math.min(1, this.rotationAnim.elapsed / this.rotationAnim.duration);
        const {fromX, fromY, toX, toY} = this.rotationAnim;

        const rendered = Object.create(Object.getPrototypeOf(this.current));
        Object.assign(rendered, this.current, {
            x: fromX + (toX - fromX) * t,
            y: fromY + (toY - fromY) * t,
        });

        return rendered;
    }

    render() {
        this.updateEffectOverlay();
        this.renderer.drawBoard(this.board);

        const showPieceBehindOptions = this.state === "options"
            && ["running", "paused"].includes(this.previousStateBeforeOptions);

        if (this.state === "running" || this.state === "paused" || showPieceBehindOptions) {
            if (this.state === "running") this.renderer.drawGhost(this.current, this.board);
            this.renderer.drawPiece(this.getRenderedPiece());
        } else if (this.state === "clearing") {
            const progress = Math.min(1, this.clearingTimer / this.lineClearAnimationDuration);
            this.renderer.drawClearingLines(this.clearingLines, progress);
        }

        if (this.levelUpTimer > 0) {
            this.renderer.drawLevelUpBanner(this.levelUpLevel);
        }
    }

    loop(time = 0) {
        const delta = Math.min(time - this.lastTime, 100);
        this.lastTime = time;

        this.update(delta);
        this.render();

        requestAnimationFrame(this.loop.bind(this));
    }
}