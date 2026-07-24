"use strict";

import {Piece} from "./piece.js";
import {dropIntervalForLevel, formatNumber} from "./utils.js";
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
                    settingsStore = null,
                    vhsNoise = null,
                    dom = (typeof document !== "undefined" ? document : null),
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
        this.settingsStore = settingsStore ?? leaderboard.store;
        this.vhsNoise = vhsNoise;
        this.dom = dom;
        this.i18n = i18n;
        this.settings = this.defaultSettings();
        this.vhsEnabled = false;
        this.previousStateBeforeOptions = null;
        this.isPlayingSession = false;
    }

    get stats() {
        return {
            score: formatNumber(this.score),
            level: this.level,
            lines: this.lines,
            best: formatNumber(this.leaderboard.bestScore()),
        };
    }

    static getKickTable(type) {
        if (type === "I") return Game.I_KICKS;
        if (type === "O") return Game.O_KICKS;
        return Game.JLSTZ_KICKS;
    }

    defaultSettings() {
        return {volume: 1, muted: false, glow: true, transparency: true, vhs: true};
    }

    prefersReducedMotion() {
        const view = this.dom?.defaultView ?? (typeof window !== "undefined" ? window : null);
        if (!view?.matchMedia) return false;
        return view.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    init() {
        this.soundManager.init();
        this.loadSettings();
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
        this.dropInterval = dropIntervalForLevel(startLevel, this.scoring);
        this.dropCounter = 0;
        this.lockDelayTimer = 0;
        this.lockDelayResets = 0;
        this.groundedTime = 0;
        this.lastAction = null;
        this.pendingSpin = null;
        this.lastTime = 0;
        this.hardDropUsed = false;
        this.clearingLines = [];
        this.clearingTimer = 0;
        this.levelUpTimer = 0;
        this.levelUpLevel = null;

        this.current = new Piece(this.bag.next(), {cols: this.board.cols});
        this.next = this.bag.next();
        this.renderer.drawNext(this.next);

        this.hud.update(this.stats);
    }

    async showIdleScreen() {
        this.state = "idle";
        this.isPlayingSession = false;
        this.hud.setPlaying(false);
        this.hud.showScreen(this.screens.loading(
            Game.APP_NAME, this.i18n.t("screens.loading.leaderboardHint"), this.dom
        ));

        const list = await this.leaderboard.load();
        if (this.state !== "idle") return;

        this.renderIdleScreen(list);
        this.hud.update(this.stats);
    }

    renderIdleScreen(list) {
        this.currentIdleList = list;
        this.hud.showScreen(
            this.screens.idle(
                list, this.difficulty, this.difficulties, (l, h) => this.renderLeaderboard(l, h), this.dom, this.i18n
            )
        );
        this.bindDifficultyButtons(() => this.renderIdleScreen(list));
    }

    bindDifficultyButtons(onChange) {
        if (!this.dom) return;
        this.dom
            .querySelectorAll('[data-role="difficulty-button"]')
            .forEach((btn) =>
                btn.addEventListener("click", ({currentTarget}) => {
                    this.difficulty = currentTarget.dataset.difficulty;
                    this.applyDifficultyTheme();
                    onChange();
                })
            );
    }

    changeDifficulty(dir) {
        const keys = Object.keys(this.difficulties);
        const currentIndex = keys.indexOf(this.difficulty);
        this.difficulty = keys[(currentIndex + dir + keys.length) % keys.length];
        this.applyDifficultyTheme();

        if (this.state === "idle") {
            this.renderIdleScreen(this.currentIdleList);
        } else if (this.state === "gameover-saved" && this.currentGameOverSaved) {
            const {list, entry} = this.currentGameOverSaved;
            this.renderGameOverSaved(list, entry);
        }
    }

    applyDifficultyTheme() {
        const color = this.boardBackgrounds?.[this.difficulty];
        if (color) this.renderer.setTheme(color);
    }

    start() {
        this.prepareNewRound();
        this.state = "running";
        this.isPlayingSession = true;
        this.hud.setPlaying(true);
        this.hud.hideOverlay();
    }

    spawnNext() {
        this.current = new Piece(this.next, {cols: this.board.cols});
        this.next = this.bag.next();
        this.hardDropUsed = false;
        this.lockDelayTimer = 0;
        this.lockDelayResets = 0;
        this.groundedTime = 0;
        this.lastAction = null;
        this.renderer.drawNext(this.next);

        if (this.board.collides(this.current, 0, 0)) {
            this.gameOver().then();
        }
    }

    async gameOver() {
        this.state = "gameover-entry";
        this.isPlayingSession = false;
        this.hud.setPlaying(false);
        this.soundManager.play("gameOver");
        this.hud.showScreen(this.screens.loading(
            this.i18n.t("screens.gameOverEntry.title"), this.i18n.t("screens.loading.leaderboardHint"), this.dom
        ));

        const [list, lastName] = await Promise.all([
            this.leaderboard.load(),
            this.leaderboard.loadLastName(),
        ]);
        if (this.state !== "gameover-entry") return;

        this.hud.showScreen(
            this.screens.gameOverEntry(
                this.stats, list, (l, h) => this.renderLeaderboard(l, h), this.dom, this.i18n
            )
        );
        this.bindScoreForm(lastName);
    }

    bindScoreForm(lastName) {
        if (!this.dom) return;
        const form = this.dom.querySelector('[data-role="score-form"]');
        const input = this.dom.querySelector('[data-role="name-input"]');
        const button = form?.querySelector("button") ?? null;
        if (!form || !input) return;

        input.value = lastName || "";
        input.focus();
        input.select();

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (button) button.disabled = true;

            const typedName = input.value.trim().slice(0, 16);
            const name = typedName || this.i18n.t("leaderboard.defaultName");
            const entry = {
                name,
                score: this.score,
                level: this.level,
                lines: this.lines,
                date: new Date().toISOString(),
            };

            const nameSavePromise = typedName ? this.leaderboard.setLastName(typedName) : Promise.resolve();

            const [, list] = await Promise.all([
                nameSavePromise,
                this.leaderboard.add(entry),
            ]);

            this.state = "gameover-saved";
            this.hud.update(this.stats);
            this.renderGameOverSaved(list, entry);
        }, {once: true});
    }

    renderGameOverSaved(list, entry) {
        this.currentGameOverSaved = {list, entry};
        this.hud.showScreen(
            this.screens.gameOverSaved(
                list, entry, (l, h) => this.renderLeaderboard(l, h),
                this.difficulty, this.difficulties, this.dom, this.i18n
            )
        );
        this.bindDifficultyButtons(() => this.renderGameOverSaved(list, entry));
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
            const raw = await this.settingsStore.get(Game.SETTINGS_KEY);
            if (raw) {
                settings = {...settings, ...JSON.parse(raw)};
                hasStoredSettings = true;
            }
        } catch {
            settings = this.defaultSettings();
        }

        if (!hasStoredSettings && this.prefersReducedMotion()) {
            settings.vhs = false;
        }

        this.settings = settings;
        this.soundManager.setVolume(settings.volume);
        this.soundManager.setMuted(settings.muted);
        this.applyPerformanceSettings();
    }

    saveSettings() {
        return this.settingsStore.set(Game.SETTINGS_KEY, JSON.stringify(this.settings));
    }

    applyPerformanceSettings() {
        const {glow, transparency, vhs} = this.settings;
        this.renderer.setGlowEnabled(glow);
        this.renderer.setTransparencyEnabled(transparency);

        const body = this.dom?.body;
        if (body) {
            body.classList.toggle("perf-no-glow", !glow);
            body.classList.toggle("perf-no-transparency", !transparency);
        }

        this.vhsEnabled = vhs;
        this.updateVhsOverlay();
    }

    updateVhsOverlay() {
        if (!this.dom) return;
        const vhsEl = this.dom.getElementById("vhs-overlay");
        const active = Boolean(this.vhsEnabled) && (this.state === "running" || this.state === "clearing");

        if (vhsEl) vhsEl.classList.toggle("board__vhs--active", active);

        if (this.vhsNoise) {
            if (active) this.vhsNoise.start();
            else this.vhsNoise.stop();
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
            } else if (previousState === "gameover-saved" && this.currentGameOverSaved) {
                const {list, entry} = this.currentGameOverSaved;
                this.renderGameOverSaved(list, entry);
            }
            return;
        }

        if (!["idle", "running", "paused", "gameover-saved"].includes(this.state)) return;

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
        const glowCheckbox = this.dom.querySelector('[data-role="glow-checkbox"]');
        const transparencyCheckbox = this.dom.querySelector('[data-role="transparency-checkbox"]');
        const vhsCheckbox = this.dom.querySelector('[data-role="vhs-checkbox"]');
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

        if (vhsCheckbox) {
            vhsCheckbox.addEventListener("change", () => {
                this.settings.vhs = vhsCheckbox.checked;
                this.applyPerformanceSettings();
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
        this.refreshCurrentScreen();
    }

    refreshCurrentScreen() {
        if (this.state === "idle") {
            this.renderIdleScreen(this.currentIdleList ?? []);
        } else if (this.state === "paused") {
            this.renderPauseMenu();
        } else if (this.state === "options") {
            this.renderOptionsMenu();
        } else if (this.state === "gameover-saved" && this.currentGameOverSaved) {
            const {list, entry} = this.currentGameOverSaved;
            this.renderGameOverSaved(list, entry);
        }
    }

    handleEnter() {
        if (this.state === "idle" || this.state === "gameover-saved") {
            this.start();
        }
    }

    addScore(points) {
        this.score += points;
        this.hud.update(this.stats);
    }

    registerLineClears(cleared, playSound = true) {
        if (cleared === 0) return;

        if (playSound) this.soundManager.play("lineClear");

        this.lines += cleared;
        this.addScore(pointsForLineClear(cleared, this.level, this.scoring));

        const newLevel = levelForLines(this.lines, this.startLevel, this.scoring);
        if (newLevel !== this.level) {
            this.level = newLevel;
            this.dropInterval = dropIntervalForLevel(this.level, this.scoring);

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
        this.addScore(pointsForSpin(spin.type, cleared, this.level, spin.mini));
    }

    lockCurrentPiece() {
        const spin = this.detectSpin();

        this.soundManager.play("drop");
        this.board.lockPiece(this.current);

        const fullRows = this.board.getFullLineIndices();

        if (fullRows.length === 0) {
            if (spin) this.registerSpin(spin, 0);
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
        if (this.state === "idle" || this.state === "gameover-saved") {
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
                this.current.shape = rotatedShape;
                this.current.x += dx;
                this.current.y += dy;
                this.current.rotationState = toState;
                this.lastAction = "rotate";
                if (this.board.collides(this.current, 0, 1)) this.resetLockDelay();
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
            KeyH: () => this.toggleControlsList(),
            KeyM: () => this.toggleSound(),
            KeyO: () => this.toggleOptions(),
            KeyP: () => this.togglePause(),
            KeyZ: () => this.rotate(),
        };

        const PREVENT_DEFAULT_KEYS = new Set([
            "ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space",
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
            if (isTypingInField(event)) return;

            if (PREVENT_DEFAULT_KEYS.has(event.code)) event.preventDefault();

            const action = KEY_ACTIONS[event.code];
            if (!action) return;

            if (REPEATABLE_KEYS.has(event.code)) {
                if (event.repeat) return;
                action();
                startRepeat(event.code, action);
                return;
            }

            if (event.code === "Space" && event.repeat) return;
            action();
        });

        this.dom.addEventListener("keyup", (event) => stopRepeat(event.code));

        if (typeof window !== "undefined") {
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
        if (this.levelUpTimer > 0) {
            this.levelUpTimer = Math.max(0, this.levelUpTimer - delta);
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
            if (this.lockDelayTimer >= this.scoring.LOCK_DELAY || this.groundedTime >= this.scoring.MAX_GROUNDED_TIME) {
                this.lockCurrentPiece();
            }
            return;
        }

        this.lockDelayTimer = 0;
        this.groundedTime = 0;
        this.dropCounter += delta;
        if (this.dropCounter > this.dropInterval) {
            this.current.y += 1;
            this.dropCounter = 0;
        }
    }

    render() {
        this.updateVhsOverlay();
        this.renderer.drawBoard(this.board);

        const showPieceBehindOptions = this.state === "options"
            && ["running", "paused"].includes(this.previousStateBeforeOptions);

        if (this.state === "running" || this.state === "paused" || showPieceBehindOptions) {
            if (this.state === "running") this.renderer.drawGhost(this.current, this.board);
            this.renderer.drawPiece(this.current);
        } else if (this.state === "clearing") {
            const progress = Math.min(1, this.clearingTimer / this.lineClearAnimationDuration);
            this.renderer.drawClearingLines(this.clearingLines, progress);
        }

        if (this.levelUpTimer > 0) {
            this.renderer.drawLevelUpBanner(this.levelUpLevel);
        }
    }

    loop(time = 0) {
        const delta = time - this.lastTime;
        this.lastTime = time;

        this.update(delta);
        this.render();

        requestAnimationFrame(this.loop.bind(this));
    }
}
