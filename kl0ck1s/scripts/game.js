"use strict";

import {Piece} from "./piece.js";
import {dropIntervalForLevel} from "./utils.js";
import {pointsForLineClear, pointsForSoftDrop, pointsForHardDrop, levelForLines} from "./scoring.js";

export class Game {
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
                    dom = (typeof document !== "undefined" ? document : null),
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
        this.dom = dom;
    }

    init() {
        this.soundManager.init();
        this.applyDifficultyTheme();
        this.prepareNewRound();
        this.showIdleScreen().then();
        this.bindControls();
        this.bindControlsToggle();
        requestAnimationFrame(this.loop.bind(this));
    }

    get stats() {
        return {
            score: this.score,
            level: this.level,
            lines: this.lines,
            best: this.leaderboard.bestScore(),
        };
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
        this.hud.setPlaying(false);
        this.hud.showScreen(this.screens.loading("Kl0ck1's", "Wczytywanie tabeli wyników...", this.dom));

        const list = await this.leaderboard.load();
        if (this.state !== "idle") return;

        this.renderIdleScreen(list);
        this.hud.update(this.stats);
    }

    renderIdleScreen(list) {
        this.currentIdleList = list;
        this.hud.showScreen(
            this.screens.idle(list, this.difficulty, this.difficulties, (l, h) => this.renderLeaderboard(l, h), this.dom)
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
        this.hud.setPlaying(true);
        this.hud.hideOverlay();
    }

    spawnNext() {
        this.current = new Piece(this.next, {cols: this.board.cols});
        this.next = this.bag.next();
        this.hardDropUsed = false;
        this.lockDelayTimer = 0;
        this.renderer.drawNext(this.next);

        if (this.board.collides(this.current, 0, 0)) {
            this.gameOver().then();
        }
    }

    async gameOver() {
        this.state = "gameover-entry";
        this.hud.setPlaying(false);
        this.soundManager.play("gameOver");
        this.hud.showScreen(this.screens.loading("KONIEC GRY", "Wczytywanie tabeli wyników...", this.dom));

        const [list, lastName] = await Promise.all([
            this.leaderboard.load(),
            this.leaderboard.loadLastName(),
        ]);
        if (this.state !== "gameover-entry") return;

        this.hud.showScreen(
            this.screens.gameOverEntry(this.stats, list, (l, h) => this.renderLeaderboard(l, h), this.dom)
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

            const name = input.value.trim().slice(0, 16) || "Gracz";
            const entry = {
                name,
                score: this.score,
                level: this.level,
                lines: this.lines,
                date: new Date().toISOString(),
            };

            const [, list] = await Promise.all([
                this.leaderboard.setLastName(name),
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
                list, entry, (l, h) => this.renderLeaderboard(l, h), this.difficulty, this.difficulties, this.dom
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
        const volumePercent = Math.round(this.soundManager.volume * 100);
        this.hud.showScreen(this.screens.paused({volumePercent, muted: this.soundManager.muted}, this.dom));
        this.bindPauseMenu();
    }

    bindPauseMenu() {
        if (!this.dom) return;
        const muteCheckbox = this.dom.querySelector('[data-role="mute-checkbox"]');
        const volumeSlider = this.dom.querySelector('[data-role="volume-slider"]');
        const resumeButton = this.dom.querySelector('[data-role="resume-button"]');

        if (muteCheckbox) {
            muteCheckbox.addEventListener("change", () => {
                this.soundManager.setMuted(muteCheckbox.checked);
                if (volumeSlider) volumeSlider.disabled = muteCheckbox.checked;
            });
        }

        if (volumeSlider) {
            volumeSlider.addEventListener("input", () => {
                this.soundManager.setVolume(volumeSlider.value / 100);
            });
        }

        if (resumeButton) {
            resumeButton.addEventListener("click", () => this.togglePause());
        }
    }

    toggleSound() {
        this.soundManager.setMuted(!this.soundManager.muted);

        if (!this.dom) return;
        const muteCheckbox = this.dom.querySelector('[data-role="mute-checkbox"]');
        const volumeSlider = this.dom.querySelector('[data-role="volume-slider"]');
        if (muteCheckbox) muteCheckbox.checked = this.soundManager.muted;
        if (volumeSlider) volumeSlider.disabled = this.soundManager.muted;
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

    lockCurrentPiece() {
        this.soundManager.play("drop");
        this.board.lockPiece(this.current);

        const fullRows = this.board.getFullLineIndices();

        if (fullRows.length === 0) {
            this.spawnNext();
            return;
        }

        this.soundManager.play("lineClear");
        this.state = "clearing";
        this.clearingLines = fullRows;
        this.clearingTimer = 0;
    }

    finishLineClear() {
        const cleared = this.board.clearFullLines();
        this.registerLineClears(cleared, false);

        this.clearingLines = [];
        this.dropCounter = 0;
        this.state = "running";
        this.spawnNext();
    }

    moveHorizontal(dir) {
        if (this.state !== "running") return;
        if (!this.board.collides(this.current, dir, 0)) {
            this.current.x += dir;
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
        const kicks = [0, -1, 1, -2, 2];

        for (const kick of kicks) {
            if (!this.board.collides(this.current, kick, 0, rotatedShape)) {
                this.current.shape = rotatedShape;
                this.current.x += kick;
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
            KeyZ: () => this.rotate(),
            Space: () => this.hardDrop(),
            KeyP: () => this.togglePause(),
            Enter: () => this.handleEnter(),
            KeyM: () => this.toggleSound(),
            KeyH: () => this.toggleControlsList(),
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
            if (this.lockDelayTimer >= this.dropInterval * 5) {
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

    render() {
        this.renderer.drawBoard(this.board);

        if (this.state === "running" || this.state === "paused") {
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
