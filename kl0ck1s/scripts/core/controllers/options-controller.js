"use strict";

import {
    ARR_MAX,
    ARR_MIN,
    ARR_STEP,
    DAS_MAX,
    DAS_MIN,
    DAS_STEP,
    SENSITIVITY_MAX,
    SENSITIVITY_MIN,
    SENSITIVITY_STEP,
    SETTINGS_EXPORT_FILENAME,
} from "../game/game-constants.js";
import {copyTextToClipboard, debounce, isMobileViewport} from "../shared/utils.js";
import {defaultKeyBindings} from "../shared/key-bindings.js";

function clampToStep(value, min, max, step) {
    const clamped = Math.max(min, Math.min(max, value));
    return Math.round(clamped / step) * step;
}

export class OptionsController {
    constructor(game, gameFlow) {
        this.game = game;
        this.gameFlow = gameFlow;
        this._pauseBlockedTimer = null;
    }

    toggleMultiplayerLiveOptions() {
        const game = this.game;
        if (game.multiplayerOptionsOverlayOpen) {
            game.soundManager.stopPreview();
            game.multiplayerOptionsOverlayOpen = false;
            game.hud.hideOverlay();
            return;
        }
        if (game.state !== "running") return;
        game.multiplayerOptionsOverlayOpen = true;
        this.renderOptionsMenu();
    }

    _showMultiplayerBlockedHint(messageKey = "multiplayer.pauseBlocked") {
        const game = this.game;
        if (!game.dom) return;

        let toast = game.dom.querySelector('[data-role="mp-pause-blocked-toast"]');
        if (!toast) {
            toast = game.dom.createElement("div");
            toast.className = "mp-pause-blocked-toast";
            toast.dataset.role = "mp-pause-blocked-toast";
            (game.dom.body ?? game.dom.documentElement)?.appendChild(toast);
        }

        toast.textContent = game.i18n.t(messageKey);
        toast.classList.add("mp-pause-blocked-toast--visible");

        clearTimeout(this._pauseBlockedTimer);
        this._pauseBlockedTimer = setTimeout(() => {
            toast.classList.remove("mp-pause-blocked-toast--visible");
        }, 1800);
    }

    renderPauseMenu() {
        const game = this.game;
        game.hud.showScreen(game.screens.options(game.settings, game.dom, game.i18n, game.soundManager, "pause"));
        this.bindOptionsMenu();
    }

    closeOptionsOrPause() {
        if (this.game.multiplayerOptionsOverlayOpen) this.toggleMultiplayerLiveOptions();
        else if (this.game.state === "paused") this.gameFlow.togglePause();
        else this.toggleOptions();
    }

    refreshCurrentScreen() {
        const game = this.game;
        if (game.multiplayerOptionsOverlayOpen) {
            this.renderOptionsMenu();
        } else if (game.state === "idle") {
            this.gameFlow.renderIdleScreen(game.currentIdleList ?? []);
        } else if (game.state === "paused") {
            this.renderPauseMenu();
        } else if (game.state === "options") {
            this.renderOptionsMenu();
        }
    }

    refreshLanguage() {
        const game = this.game;
        if (game.dom) game.i18n.applyStatic(game.dom);
        game.hud.setPlaying(game.isPlayingSession, game.mode);
        game.hud.update(game.stats);
        this.refreshCurrentScreen();
    }

    bindLangSelect() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const select = game.hud.overlayEl.querySelector('[data-role="lang-select"]');
        if (!select) return;

        select.addEventListener("change", async () => {
            const lang = select.value;
            if (lang === game.i18n.lang) return;

            await game.i18n.setLanguage(lang);
            await game.soundManager.setLanguage(lang);
            this.refreshLanguage();
        });
    }

    toggleOptions() {
        const game = this.game;
        if (game.multiplayerOptionsOverlayOpen) {
            this.toggleMultiplayerLiveOptions();
            return;
        }
        if (game.state === "running" && game.multiplayerConnected && !game.multiplayerVsBot) {
            this.toggleMultiplayerLiveOptions();
            return;
        }
        if (game.state === "options") {
            game.soundManager.stopPreview();
            const previousState = game.previousStateBeforeOptions ?? "idle";
            game.previousStateBeforeOptions = null;
            game.state = previousState;

            if (previousState === "running") {
                game.hud.hideOverlay();
                game.musicDirector.resume();
            } else if (previousState === "paused") {
                this.renderPauseMenu();
            } else if (previousState === "idle") {
                this.gameFlow.renderIdleScreen(game.currentIdleList ?? []);
            } else if (previousState === "gameOver-entry" && game.currentGameOverEntry) {
                const {list, entry, todayBestBeforeThisGame, reason} = game.currentGameOverEntry;
                this.gameFlow.renderGameOverEntry(list, entry, todayBestBeforeThisGame, reason);
            }

            return;
        }

        if (!["idle", "running", "paused", "gameOver-entry"].includes(game.state))
            return;

        game.previousStateBeforeOptions = game.state;
        if (game.state === "running") {
            game.pieceController.stopAllGameplaySounds();
            game.musicDirector.pause();
        }
        game.state = "options";
        this.renderOptionsMenu();
    }

    renderOptionsMenu() {
        const game = this.game;
        const openRoles = new Set();
        game.hud.overlayEl?.querySelectorAll("details[data-role][open]").forEach((el) => {
            openRoles.add(el.dataset.role);
        });

        game.hud.showScreen(game.screens.options(game.settings, game.dom, game.i18n, game.soundManager));
        this.bindOptionsMenu();

        game.hud.overlayEl?.querySelectorAll("details[data-role]").forEach((el) => {
            if (openRoles.has(el.dataset.role)) el.open = true;
        });
    }

    togglePreviewButton(button, list) {
        const game = this.game;
        const key = button.dataset.soundKey;

        list.querySelectorAll('[data-role="sound-preview-button"]').forEach((otherButton) => {
            if (otherButton !== button) this.setPreviewButtonState(otherButton, "play");
        });

        const rate = game.previewPlaybackRateFor(key);
        const state = game.soundManager.previewToggle(
            key, () => this.setPreviewButtonState(button, "play"), {playbackRate: rate}
        );
        this.setPreviewButtonState(button, state === "playing" ? "pause" : "play");
    }

    setPreviewButtonState(button, state) {
        const game = this.game;
        button.textContent = state === "pause" ? "⏸" : "▶";
        button.setAttribute(
            "aria-label",
            game.i18n.t(state === "pause" ? "screens.options.pause" : "screens.options.preview")
        );
    }

    bindOptionsMenu() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const settingsController = game.settingsController;
        const root = game.hud.overlayEl;

        const optionsMuteToggle = root.querySelector('[data-role="options-mute-toggle"]');
        const volumeSlider = root.querySelector('[data-role="volume-slider"]');
        const hudRightCheckbox = root.querySelector('[data-role="hud-right-checkbox"]');
        const ghostCheckbox = root.querySelector('[data-role="ghost-checkbox"]');
        const gridCheckbox = root.querySelector('[data-role="grid-checkbox"]');
        const screenShakeCheckbox = root.querySelector('[data-role="screen-shake-checkbox"]');
        const heightSaturationCheckbox = root.querySelector('[data-role="height-saturation-checkbox"]');
        const glowCheckbox = root.querySelector('[data-role="glow-checkbox"]');
        const transparencyCheckbox = root.querySelector('[data-role="transparency-checkbox"]');
        const fallTrailCheckbox = root.querySelector('[data-role="fall-trail-checkbox"]');
        const hardDropFlashCheckbox = root.querySelector('[data-role="hard-drop-flash-checkbox"]');
        const blockTypeSelect = root.querySelector('[data-role="block-type-select"]');
        const themeGrid = root.querySelector('[data-role="theme-grid"]');
        const skipCountdownCheckbox = root.querySelector('[data-role="skip-countdown-checkbox"]');
        const mouseControlCheckbox = root.querySelector('[data-role="mouse-control-checkbox"]');
        const mouseSensitivityInput = root.querySelector('[data-role="mouse-sensitivity-input"]');
        const touchSensitivityInput = root.querySelector('[data-role="touch-sensitivity-input"]');
        const keyboardDasInput = root.querySelector('[data-role="keyboard-das-input"]');
        const keyboardArrInput = root.querySelector('[data-role="keyboard-arr-input"]');
        const dasArrPreview = root.querySelector('[data-role="das-arr-preview"]');
        const closeButton = root.querySelector('[data-role="options-close-button"]');
        const closeKey = root.querySelector('[data-role="options-close-key"]');

        if (optionsMuteToggle) {
            optionsMuteToggle.addEventListener("click", () => {
                settingsController.toggleSound();
                this.syncCategoryResetButtons();
            });
        }

        if (volumeSlider) {
            volumeSlider.addEventListener("input", () => {
                game.settings.volume = volumeSlider.value / 100;
                game.soundManager.setVolume(game.settings.volume);
                settingsController.saveSettings();
                settingsController.syncMuteToggle();
                this.syncCategoryResetButtons();
            });
        }

        if (hudRightCheckbox) {
            hudRightCheckbox.addEventListener("change", () => {
                game.settings.hudRight = hudRightCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        this.bindBenchmark();

        if (ghostCheckbox) {
            ghostCheckbox.addEventListener("change", () => {
                game.settings.ghost = ghostCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (gridCheckbox) {
            gridCheckbox.addEventListener("change", () => {
                game.settings.gridLines = gridCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (screenShakeCheckbox) {
            screenShakeCheckbox.addEventListener("change", () => {
                game.settings.screenShake = screenShakeCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (heightSaturationCheckbox) {
            heightSaturationCheckbox.addEventListener("change", () => {
                game.settings.heightSaturation = heightSaturationCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        const syncHeightSaturationAvailability = () => {
            if (!heightSaturationCheckbox) return;
            heightSaturationCheckbox.checked = Boolean(game.settings.heightSaturation) && !game.settings.outlineBlocks;
            heightSaturationCheckbox.disabled = Boolean(game.settings.outlineBlocks);
        };

        if (glowCheckbox) {
            glowCheckbox.addEventListener("change", () => {
                game.settings.glow = glowCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (transparencyCheckbox) {
            transparencyCheckbox.addEventListener("change", () => {
                game.settings.transparency = transparencyCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (fallTrailCheckbox) {
            fallTrailCheckbox.addEventListener("change", () => {
                game.settings.fallTrail = fallTrailCheckbox.checked;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (hardDropFlashCheckbox) {
            hardDropFlashCheckbox.addEventListener("change", () => {
                game.settings.hardDropFlash = hardDropFlashCheckbox.checked;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (blockTypeSelect) {
            blockTypeSelect.addEventListener("change", () => {
                game.settings.outlineBlocks = blockTypeSelect.value === "radioactive";
                syncHeightSaturationAvailability();
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (themeGrid) {
            themeGrid.addEventListener("click", (event) => {
                const card = event.target.closest('[data-role="theme-option"]');
                if (!card) return;
                game.settings.theme = card.dataset.value;
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncThemePicker();
                this.syncCategoryResetButtons();
            });
        }

        if (skipCountdownCheckbox) {
            skipCountdownCheckbox.addEventListener("change", () => {
                game.settings.skipCountdown = skipCountdownCheckbox.checked;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        const skipModeInfoCheckbox = root.querySelector('[data-role="skip-mode-info-checkbox"]');
        if (skipModeInfoCheckbox) {
            skipModeInfoCheckbox.addEventListener("change", () => {
                game.settings.skipModeInfo = skipModeInfoCheckbox.checked;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (mouseControlCheckbox) {
            mouseControlCheckbox.addEventListener("change", () => {
                game.settings.mouseControl = mouseControlCheckbox.checked;
                if (mouseSensitivityInput) mouseSensitivityInput.disabled = !mouseControlCheckbox.checked;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (mouseSensitivityInput) {
            mouseSensitivityInput.min = SENSITIVITY_MIN;
            mouseSensitivityInput.max = SENSITIVITY_MAX;
            mouseSensitivityInput.step = SENSITIVITY_STEP;
            mouseSensitivityInput.value = game.settings.mouseSensitivity ?? 1;
            mouseSensitivityInput.disabled = !game.settings.mouseControl;

            mouseSensitivityInput.addEventListener("change", () => {
                const parsed = parseFloat(mouseSensitivityInput.value);
                const value = clampToStep(
                    Number.isFinite(parsed) ? parsed : 1, SENSITIVITY_MIN, SENSITIVITY_MAX, SENSITIVITY_STEP
                );
                mouseSensitivityInput.value = value;
                game.settings.mouseSensitivity = value;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (touchSensitivityInput) {
            touchSensitivityInput.min = SENSITIVITY_MIN;
            touchSensitivityInput.max = SENSITIVITY_MAX;
            touchSensitivityInput.step = SENSITIVITY_STEP;
            touchSensitivityInput.value = game.settings.touchSensitivity ?? 1;

            touchSensitivityInput.addEventListener("change", () => {
                if (touchSensitivityInput.value === "") {
                    delete game.settings.touchSensitivity;
                    touchSensitivityInput.value = 1;
                    settingsController.saveSettings();
                    this.syncCategoryResetButtons();
                    return;
                }
                const parsed = parseFloat(touchSensitivityInput.value);
                if (!Number.isFinite(parsed)) {
                    touchSensitivityInput.value = game.settings.touchSensitivity ?? 1;
                    return;
                }
                const value = clampToStep(parsed, SENSITIVITY_MIN, SENSITIVITY_MAX, SENSITIVITY_STEP);
                touchSensitivityInput.value = value;
                game.settings.touchSensitivity = value;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        const syncDasArrPreview = () => {
            if (!dasArrPreview) return;
            const das = clampToStep(
                parseFloat(keyboardDasInput?.value) || DAS_MIN, DAS_MIN, DAS_MAX, DAS_STEP
            );
            const arr = clampToStep(
                parseFloat(keyboardArrInput?.value) || ARR_MIN, ARR_MIN, ARR_MAX, ARR_STEP
            );
            dasArrPreview.style.setProperty("--das-ms", `${das}ms`);
            dasArrPreview.style.setProperty("--arr-ms", `${Math.max(arr, 1)}ms`);
        };

        if (keyboardDasInput) {
            keyboardDasInput.min = DAS_MIN;
            keyboardDasInput.max = DAS_MAX;
            keyboardDasInput.step = DAS_STEP;
            keyboardDasInput.value = game.settings.keyboardDAS ?? DAS_MIN;

            keyboardDasInput.addEventListener("input", syncDasArrPreview);
            keyboardDasInput.addEventListener("change", () => {
                const parsed = parseFloat(keyboardDasInput.value);
                const value = clampToStep(
                    Number.isFinite(parsed) ? parsed : DAS_MIN, DAS_MIN, DAS_MAX, DAS_STEP
                );
                keyboardDasInput.value = value;
                game.settings.keyboardDAS = value;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
                syncDasArrPreview();
            });
        }

        if (keyboardArrInput) {
            keyboardArrInput.min = ARR_MIN;
            keyboardArrInput.max = ARR_MAX;
            keyboardArrInput.step = ARR_STEP;
            keyboardArrInput.value = game.settings.keyboardARR ?? ARR_MIN;

            keyboardArrInput.addEventListener("input", syncDasArrPreview);
            keyboardArrInput.addEventListener("change", () => {
                const parsed = parseFloat(keyboardArrInput.value);
                const value = clampToStep(
                    Number.isFinite(parsed) ? parsed : ARR_MIN, ARR_MIN, ARR_MAX, ARR_STEP
                );
                keyboardArrInput.value = value;
                game.settings.keyboardARR = value;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
                syncDasArrPreview();
            });
        }

        syncDasArrPreview();

        root.querySelectorAll('[data-role="category-volume-slider"]').forEach((slider) => {
            slider.addEventListener("input", () => {
                const category = slider.dataset.category;
                const volume = slider.value / 100;
                game.settings.categoryVolumes = {...game.settings.categoryVolumes, [category]: volume};
                game.soundManager.setCategoryVolume(category, volume);
                settingsController.saveSettings();
                settingsController.syncCategoryMuteToggle(category);
                this.syncSoundCategoryResetButtons();
            });
        });

        root.querySelectorAll('[data-role="category-mute-toggle"]').forEach((button) => {
            button.addEventListener("click", () => {
                const category = button.dataset.category;
                settingsController.toggleCategoryMuted(category);
                settingsController.syncCategoryMuteToggle(category);
                this.syncSoundCategoryResetButtons();
            });
        });

        root.querySelectorAll('[data-role="sound-list"], [data-role="sound-list-countdown"]').forEach((list) => {
            list.addEventListener("input", (event) => {
                const slider = event.target.closest('[data-role="sound-volume-slider"]');
                if (!slider) return;
                const key = slider.dataset.soundKey;
                const volume = slider.value / 100;
                game.settings.soundVolumes = {...game.settings.soundVolumes, [key]: volume};
                game.soundManager.setSoundVolume(key, volume);
                settingsController.saveSettings();
                settingsController.syncSoundMuteToggle(key);
                this.syncSoundCategoryResetButtons();
            });

            list.addEventListener("click", (event) => {
                const previewButton = event.target.closest('[data-role="sound-preview-button"]');
                if (previewButton) {
                    this.togglePreviewButton(previewButton, list);
                    return;
                }

                const muteButton = event.target.closest('[data-role="sound-mute-toggle"]');
                if (muteButton) {
                    const key = muteButton.dataset.soundKey;
                    settingsController.toggleSoundMuted(key);
                    settingsController.syncSoundMuteToggle(key);
                    this.syncSoundCategoryResetButtons();
                }
            });
        });

        if (closeButton) {
            closeButton.addEventListener("click", () => this.closeOptionsOrPause());
        }

        if (closeKey) {
            closeKey.addEventListener("click", () => this.closeOptionsOrPause());
        }

        this.bindLangSelect();
        this.bindOptionsDataMenu();
        this.bindKeybindList();
        this.bindCategoryResetButtons();
        this.bindSoundCategoryResetButtons();
        this.syncSoundCategoryResetButtons();
        this.syncCategoryResetButtons();
        this.bindOptionsSearch();
    }

    categoryResetGroups() {
        const graphicsKeys = ["screenShake", "outlineBlocks", "heightSaturation", "glow", "transparency", "fallTrail", "hardDropFlash"];
        return {
            "reset-general-button": ["volume", "muted", "hudRight", "theme"],
            "reset-controls-button": ["mouseControl", "mouseSensitivity", "touchSensitivity"],
            "reset-gameplay-button": ["skipCountdown", "skipModeInfo", "ghost", "gridLines"],
            "reset-graphics-button": isMobileViewport()
                ? graphicsKeys.filter((key) => key !== "screenShake")
                : graphicsKeys,
            "reset-advanced-button": ["keyboardDAS", "keyboardARR"],
        };
    }

    bindCategoryResetButtons() {
        const game = this.game;
        const settingsController = game.settingsController;

        Object.entries(this.categoryResetGroups()).forEach(([role, keys]) => {
            const button = game.hud.overlayEl?.querySelector(`[data-role="${role}"]`);
            if (!button) return;
            button.addEventListener("click", () => {
                settingsController.resetSettingsForKeys(keys);
                this.renderOptionsMenu();
            });
        });
    }

    syncThemePicker() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const themeGrid = game.hud.overlayEl.querySelector('[data-role="theme-grid"]');
        if (!themeGrid) return;
        const activeTheme = game.settings.theme ?? "none";
        const themeLabelKeys = {
            none: "screens.options.themeNone",
            vhs: "screens.options.themeVHS",
            matrix: "screens.options.themeMatrix",
            rain: "screens.options.themeRain",
            snow: "screens.options.themeSnow",
            volcano: "screens.options.themeVolcano",
        };
        themeGrid.querySelectorAll('[data-role="theme-option"]').forEach((card) => {
            card.setAttribute("aria-pressed", String(card.dataset.value === activeTheme));
        });
        const themeCurrent = game.hud.overlayEl.querySelector('[data-role="theme-current"]');
        if (themeCurrent) {
            themeCurrent.textContent = game.i18n.t(themeLabelKeys[activeTheme] ?? "screens.options.themeNone");
        }
    }

    syncCategoryResetButtons() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const settingsController = game.settingsController;

        Object.entries(this.categoryResetGroups()).forEach(([role, keys]) => {
            const button = game.hud.overlayEl.querySelector(`[data-role="${role}"]`);
            if (!button) return;
            button.hidden = !settingsController.isSettingsGroupModified(keys);
        });
    }

    bindSoundCategoryResetButtons() {
        const game = this.game;
        const settingsController = game.settingsController;

        ["sfx", "music", "voices"].forEach((category) => {
            const button = game.hud.overlayEl?.querySelector(`[data-role="reset-${category}-button"]`);
            if (!button) return;
            button.addEventListener("click", () => {
                const keys = game.soundManager.keysInCategory(category);
                settingsController.resetSoundCategory(category, keys);
                this.renderOptionsMenu();
            });
        });
    }

    syncSoundCategoryResetButtons() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const settingsController = game.settingsController;

        ["sfx", "music", "voices"].forEach((category) => {
            const button = game.hud.overlayEl.querySelector(`[data-role="reset-${category}-button"]`);
            if (!button) return;
            const keys = game.soundManager.keysInCategory(category);
            button.hidden = !settingsController.isSoundCategoryModified(category, keys);
        });
    }

    bindBenchmark() {
        const game = this.game;
        const button = game.hud.overlayEl?.querySelector('[data-role="benchmark-run-button"]');
        const statusEl = game.hud.overlayEl?.querySelector('[data-role="benchmark-status"]');
        const resultsEl = game.hud.overlayEl?.querySelector('[data-role="benchmark-results"]');
        const copyButton = game.hud.overlayEl?.querySelector('[data-role="benchmark-copy-button"]');

        game.benchmarkController.ensurePreviewCanvasSized();

        if (!button) return;

        let lastRun = null;

        button.addEventListener("click", async () => {
            if (button.disabled) return;
            button.disabled = true;
            if (resultsEl) resultsEl.hidden = true;
            if (copyButton) copyButton.hidden = true;
            lastRun = null;

            if (statusEl) {
                statusEl.hidden = false;
                statusEl.textContent = game.i18n.t("screens.options.benchmarkRunning", {percent: 0});
            }

            try {
                const {results, totalMs, pieceCount} = await game.benchmarkController.run({
                    pieceCount: 10000,
                    onProgress: (done, total) => {
                        if (!statusEl) return;
                        const percent = Math.round((done / total) * 100);
                        statusEl.textContent = game.i18n.t("screens.options.benchmarkRunning", {percent});
                    },
                });

                const slowest = results[0];
                const slowestLabel = slowest
                    ? game.i18n.t(`benchmark.categories.${slowest.key}`)
                    : "";

                if (statusEl) {
                    statusEl.textContent = game.i18n.t("screens.options.benchmarkDone", {
                        pieces: pieceCount,
                        ms: Math.round(totalMs),
                        label: slowestLabel,
                        percent: slowest ? Math.round(slowest.percent) : 0,
                    });
                }

                if (resultsEl) {
                    game.screens.renderBenchmarkResults(game.dom, resultsEl, results, game.i18n);
                    resultsEl.hidden = false;
                }

                lastRun = {results, totalMs, pieceCount};
                if (copyButton) copyButton.hidden = false;
            } finally {
                button.disabled = false;
            }
        });

        if (copyButton) {
            const defaultLabel = copyButton.textContent;
            copyButton.addEventListener("click", async () => {
                if (!lastRun || copyButton.disabled) return;

                const text = game.screens.formatBenchmarkResultsText(lastRun.results, game.i18n, lastRun);
                const copied = await copyTextToClipboard(text, game.dom);

                copyButton.textContent = game.i18n.t(
                    copied ? "screens.options.benchmarkCopied" : "screens.options.benchmarkCopyFailed"
                );
                copyButton.disabled = true;
                setTimeout(() => {
                    copyButton.textContent = defaultLabel;
                    copyButton.disabled = false;
                }, 1500);
            });
        }
    }

    bindKeybindList() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const list = game.hud.overlayEl.querySelector('[data-role="keybind-list"]');
        const resetButton = game.hud.overlayEl.querySelector('[data-role="keybind-reset-button"]');
        if (!list) return;

        const settingsController = game.settingsController;
        const keyboard = game.inputController.keyboard;

        const refreshList = () => {
            game.screens.renderKeybindRows(game.dom, list, game.settings.keyBindings, game.i18n);
            this.syncKeybindResetButton();
        };

        list.addEventListener("click", (event) => {
            const kbd = event.target.closest("[data-keybind-slot]");
            if (!kbd || kbd.classList.contains("kbd--listening")) return;

            list.querySelectorAll(".kbd--listening").forEach((el) => el.classList.remove("kbd--listening"));
            keyboard.cancelListening();

            const slotId = kbd.dataset.keybindSlot;
            const originalLabel = kbd.textContent;
            kbd.classList.add("kbd--listening");
            kbd.textContent = game.i18n.t("screens.options.keyboardPressKey");

            keyboard.listenForNextKey((code) => {
                kbd.classList.remove("kbd--listening");

                if (!code) {
                    kbd.textContent = originalLabel;
                    return;
                }

                const bindings = {...game.settings.keyBindings, [slotId]: code};
                Object.keys(bindings).forEach((otherId) => {
                    if (otherId !== slotId && bindings[otherId] === code) bindings[otherId] = "";
                });
                game.settings.keyBindings = bindings;
                settingsController.saveSettings();
                refreshList();
            });
        });

        if (resetButton) {
            resetButton.addEventListener("click", () => {
                game.settings.keyBindings = defaultKeyBindings();
                settingsController.saveSettings();
                refreshList();
            });
        }

        this.syncKeybindResetButton();
    }

    syncKeybindResetButton() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const resetButton = game.hud.overlayEl.querySelector('[data-role="keybind-reset-button"]');
        const resetLabel = game.hud.overlayEl.querySelector('[data-role="keybind-reset-label"]');
        if (!resetButton) return;
        const defaults = defaultKeyBindings();
        const bindings = game.settings.keyBindings ?? {};
        const isDefault = Object.keys(defaults).every((key) => bindings[key] === defaults[key])
            && Object.keys(bindings).every((key) => key in defaults);
        resetButton.hidden = isDefault;
        if (resetLabel) resetLabel.hidden = isDefault;
    }

    bindOptionsSearch() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const input = game.hud.overlayEl.querySelector('[data-role="options-search-input"]');
        const panels = game.hud.overlayEl.querySelector('[data-role="options-panels"]');
        const emptyState = game.hud.overlayEl.querySelector('[data-role="options-search-empty"]');
        if (!input || !panels) return;

        const rowSelector = ".options__row, .controls__item";
        const groupSelector = '.options[data-role^="options-group-"]:not([data-role="options-group-developer"]), .options__group';
        const searchHiddenRows = new Set();
        const searchHiddenGroups = new Set();
        const expandedByOpen = new Set();

        const isInDeveloperGroup = (el) => Boolean(el.closest('[data-role="options-group-developer"]'));

        const clearSearchState = () => {
            searchHiddenRows.forEach((row) => {
                row.hidden = false;
            });
            searchHiddenRows.clear();
            searchHiddenGroups.forEach((group) => {
                group.hidden = false;
            });
            searchHiddenGroups.clear();
            expandedByOpen.forEach((details) => {
                details.open = false;
            });
            expandedByOpen.clear();
        };

        const groupTitleText = (group) => {
            const title = group.querySelector(":scope > summary, :scope > h3");
            return title ? title.textContent.trim().toLowerCase() : "";
        };

        const rowMatchesQuery = (row, query) => {
            if (row.textContent.trim().toLowerCase().includes(query)) return true;
            let group = row.parentElement?.closest(groupSelector);
            while (group) {
                if (groupTitleText(group).includes(query)) return true;
                group = group.parentElement?.closest(groupSelector);
            }
            return false;
        };

        const applyFilter = () => {
            clearSearchState();

            const query = input.value.trim().toLowerCase();
            if (!query) {
                if (emptyState) emptyState.hidden = true;
                return;
            }

            const rows = Array.from(panels.querySelectorAll(rowSelector)).filter((row) => !isInDeveloperGroup(row));
            let anyVisible = false;

            rows.forEach((row) => {
                if (row.hidden) return;
                const matches = rowMatchesQuery(row, query);
                if (!matches) {
                    row.hidden = true;
                    searchHiddenRows.add(row);
                } else {
                    anyVisible = true;
                }
            });

            const groups = Array.from(panels.querySelectorAll(groupSelector)).filter((group) => !isInDeveloperGroup(group));
            groups.forEach((group) => {
                const hasVisibleRow = Array.from(group.querySelectorAll(rowSelector)).some((row) => !row.hidden);
                if (!hasVisibleRow) {
                    group.hidden = true;
                    searchHiddenGroups.add(group);
                } else if (group.tagName === "DETAILS" && !group.open) {
                    group.open = true;
                    expandedByOpen.add(group);
                }
            });

            if (emptyState) emptyState.hidden = anyVisible;
        };

        input.value = this.optionsSearchQuery ?? "";
        if (input.value) applyFilter();

        input.addEventListener("input", debounce(() => {
            this.optionsSearchQuery = input.value;
            applyFilter();
        }, 200));
    }

    setImportReviewVisible(visible) {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const panels = game.hud.overlayEl.querySelector('[data-role="options-panels"]');
        const review = game.hud.overlayEl.querySelector('[data-role="options-import-review"]');
        const closeButton = game.hud.overlayEl.querySelector('[data-role="options-close-button"]');
        if (panels) panels.hidden = visible;
        if (review) review.hidden = !visible;
        if (closeButton) closeButton.hidden = visible;
    }

    showImportMessage(kind) {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        this.setImportReviewVisible(true);
        const subtitle = game.hud.overlayEl.querySelector('[data-role="options-import-subtitle"]');
        const emptyMsg = game.hud.overlayEl.querySelector('[data-role="options-import-empty"]');
        const invalidMsg = game.hud.overlayEl.querySelector('[data-role="options-import-invalid"]');
        const selectAllRow = game.hud.overlayEl.querySelector('[data-role="options-import-select-all-row"]');
        const list = game.hud.overlayEl.querySelector('[data-role="options-import-list"]');
        const actions = game.hud.overlayEl.querySelector('[data-role="options-import-actions"]');
        const closeButton = game.hud.overlayEl.querySelector('[data-role="options-import-close"]');

        if (subtitle) subtitle.hidden = true;
        if (selectAllRow) selectAllRow.hidden = true;
        if (list) list.hidden = true;
        if (actions) actions.hidden = true;
        if (emptyMsg) emptyMsg.hidden = kind !== "empty";
        if (invalidMsg) invalidMsg.hidden = kind !== "invalid";
        if (closeButton) {
            closeButton.hidden = false;
            closeButton.onclick = () => this.renderOptionsMenu();
        }
    }

    showImportReview(changes) {
        const game = this.game;
        if (!game.hud.overlayEl) return;

        if (changes.length === 0) {
            this.showImportMessage("empty");
            return;
        }

        this.setImportReviewVisible(true);
        const subtitle = game.hud.overlayEl.querySelector('[data-role="options-import-subtitle"]');
        const emptyMsg = game.hud.overlayEl.querySelector('[data-role="options-import-empty"]');
        const invalidMsg = game.hud.overlayEl.querySelector('[data-role="options-import-invalid"]');
        const selectAllRow = game.hud.overlayEl.querySelector('[data-role="options-import-select-all-row"]');
        const selectAllCheckbox = game.hud.overlayEl.querySelector('[data-role="options-import-select-all"]');
        const list = game.hud.overlayEl.querySelector('[data-role="options-import-list"]');
        const actions = game.hud.overlayEl.querySelector('[data-role="options-import-actions"]');
        const closeButton = game.hud.overlayEl.querySelector('[data-role="options-import-close"]');

        if (emptyMsg) emptyMsg.hidden = true;
        if (invalidMsg) invalidMsg.hidden = true;
        if (closeButton) closeButton.hidden = true;
        if (subtitle) {
            subtitle.hidden = false;
            subtitle.textContent = game.i18n.t("screens.options.importDiffSubtitle", {count: changes.length});
        }
        if (selectAllRow) selectAllRow.hidden = false;
        if (actions) actions.hidden = false;
        if (selectAllCheckbox) selectAllCheckbox.checked = true;
        if (list) {
            list.hidden = false;
            game.screens.renderImportDiffRows(game.dom, list, changes, game.i18n);
        }

        this.pendingImportChanges = changes;
    }

    bindOptionsDataMenu() {
        const game = this.game;
        if (!game.hud.overlayEl) return;

        const exportButton = game.hud.overlayEl.querySelector('[data-role="options-export-button"]');
        const importButton = game.hud.overlayEl.querySelector('[data-role="options-import-button"]');
        const importFile = game.hud.overlayEl.querySelector('[data-role="options-import-file"]');
        const selectAllCheckbox = game.hud.overlayEl.querySelector('[data-role="options-import-select-all"]');
        const list = game.hud.overlayEl.querySelector('[data-role="options-import-list"]');
        const cancelButton = game.hud.overlayEl.querySelector('[data-role="options-import-cancel"]');
        const applyButton = game.hud.overlayEl.querySelector('[data-role="options-import-apply"]');

        if (exportButton) {
            exportButton.addEventListener("click", () => {
                const json = game.settingsController.exportSettings();
                const blob = new Blob([json], {type: "application/json"});
                const url = URL.createObjectURL(blob);
                const link = game.dom.createElement("a");
                link.href = url;
                link.download = SETTINGS_EXPORT_FILENAME;
                link.click();
                URL.revokeObjectURL(url);
            });
        }

        if (importButton && importFile) {
            importButton.addEventListener("click", () => importFile.click());

            importFile.addEventListener("change", async () => {
                const file = importFile.files?.[0];
                importFile.value = "";
                if (!file) return;

                try {
                    const text = await file.text();
                    const parsed = game.settingsController.parseImportedSettings(text);
                    const changes = game.settingsController.diffSettings(parsed);
                    this.showImportReview(changes);
                } catch {
                    this.showImportMessage("invalid");
                }
            });
        }

        if (selectAllCheckbox && list) {
            selectAllCheckbox.addEventListener("change", () => {
                list.querySelectorAll('[data-role="options-diff-checkbox"]').forEach((checkbox) => {
                    checkbox.checked = selectAllCheckbox.checked;
                });
            });
        }

        if (list && selectAllCheckbox) {
            list.addEventListener("change", (event) => {
                if (!event.target.matches('[data-role="options-diff-checkbox"]')) return;
                const checkboxes = [...list.querySelectorAll('[data-role="options-diff-checkbox"]')];
                selectAllCheckbox.checked = checkboxes.every((checkbox) => checkbox.checked);
            });
        }

        if (cancelButton) {
            cancelButton.addEventListener("click", () => {
                this.pendingImportChanges = null;
                this.renderOptionsMenu();
            });
        }

        if (applyButton) {
            applyButton.addEventListener("click", async () => {
                if (!list) return;
                const selectedKeys = new Set(
                    [...list.querySelectorAll('[data-role="options-diff-checkbox"]')]
                        .filter((checkbox) => checkbox.checked)
                        .map((checkbox) => checkbox.dataset.key)
                );
                const selectedChanges = (this.pendingImportChanges ?? []).filter((change) => selectedKeys.has(change.key));
                this.pendingImportChanges = null;
                await game.settingsController.applySettingsChanges(selectedChanges);
                this.renderOptionsMenu();
            });
        }
    }
}
