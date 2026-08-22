// @ts-nocheck
import type {ScreenFlow} from "./screen-flow.js";
import type {Game} from "../game/game.js";
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
} from "../game/game-constants.js";
import {isMobileViewport} from "../shared/utils.js";
import {ScreenFlowOptionsBenchmark} from "./screen-flow-options-benchmark.js";
import {ScreenFlowOptionsKeybindings} from "./screen-flow-options-keybindings.js";
import {ScreenFlowOptionsSearch} from "./screen-flow-options-search.js";
import {type ImportReviewChange, OptionsDataTransferController} from "./options-data-transfer.js";

"use strict";

function clampToStep(value: number, min: number, max: number, step: number): number {
    const clamped = Math.max(min, Math.min(max, value));
    return Math.round(clamped / step) * step;
}

export class ScreenFlowOptions {
    private readonly benchmark: ScreenFlowOptionsBenchmark;
    private readonly keybindings: ScreenFlowOptionsKeybindings;
    private readonly search: ScreenFlowOptionsSearch;
    private readonly dataTransfer: OptionsDataTransferController;
    private pendingImportChanges: ImportReviewChange[] | null = null;

    constructor(public readonly flow: ScreenFlow) {
        this.benchmark = new ScreenFlowOptionsBenchmark(flow);
        this.keybindings = new ScreenFlowOptionsKeybindings(flow);
        this.search = new ScreenFlowOptionsSearch(flow);
        const controller = this;
        this.dataTransfer = new OptionsDataTransferController({
            game: flow.game,
            get pendingImportChanges() {
                return controller.pendingImportChanges;
            },
            setPendingImportChanges: (changes) => {
                controller.pendingImportChanges = changes;
            },
            renderOptionsMenu: () => controller.renderOptionsMenu(),
        });
    }

    private get game(): Game {
        return this.flow.game;
    }

    refreshCurrentScreen() {
        const game = this.game;
        if (game.multiplayerOptionsOverlayOpen) {
            this.renderOptionsMenu();
        } else if (game.state === "idle") {
            this.flow.renderIdleScreen(game.currentIdleList ?? []);
        } else if (game.state === "paused") {
            this.flow.renderPauseMenu();
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
        const select = game.hud.overlayEl.querySelector<HTMLSelectElement>('[data-role="lang-select"]');
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
            this.flow.toggleMultiplayerLiveOptions();
            return;
        }
        if (game.state === "running" && game.multiplayerConnected && !game.multiplayerVsBot) {
            this.flow.toggleMultiplayerLiveOptions();
            return;
        }
        if (game.state === "options") {
            game.soundManager.stopPreview();
            const previousState = game.previousStateBeforeOptions ?? "idle";
            game.previousStateBeforeOptions = null;

            if (game.multiplayerConnected && ["running", "paused"].includes(previousState)) {
                game.state = previousState;
                game.multiplayerController?.leaveMatch();
                return;
            }

            game.state = previousState;

            if (previousState === "running") {
                game.hud.hideOverlay();
                game.musicDirector.resume();
            } else if (previousState === "paused") {
                this.flow.renderPauseMenu();
            } else if (previousState === "idle") {
                this.flow.renderIdleScreen(game.currentIdleList ?? []);
            } else if (previousState === "gameOver-entry" && game.currentGameOverEntry) {
                const {list, entry, todayBestBeforeThisGame, reason} = game.currentGameOverEntry;
                this.flow.renderGameOverEntry(list, entry, todayBestBeforeThisGame, reason);
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
        game.hud.overlayEl?.querySelectorAll<HTMLDetailsElement>("details[data-role][open]").forEach((el) => {
            openRoles.add(el.dataset.role);
        });

        game.hud.showScreen(game.screens.options(game.settings, game.dom, game.i18n, game.soundManager));
        this.bindOptionsMenu();

        game.hud.overlayEl?.querySelectorAll<HTMLDetailsElement>("details[data-role]").forEach((el) => {
            if (openRoles.has(el.dataset.role)) el.open = true;
        });
    }

    togglePreviewButton(button: HTMLButtonElement, list: HTMLElement): void {
        const game = this.game;
        const key = button.dataset.soundKey;

        list.querySelectorAll<HTMLButtonElement>('[data-role="sound-preview-button"]').forEach((otherButton) => {
            if (otherButton !== button) this.setPreviewButtonState(otherButton, "play");
        });

        const rate = game.previewPlaybackRateFor(key);
        const state = game.soundManager.previewToggle(
            key, () => this.setPreviewButtonState(button, "play"), {playbackRate: rate}
        );
        this.setPreviewButtonState(button, state === "playing" ? "pause" : "play");
    }

    setPreviewButtonState(button: HTMLButtonElement, state: "play" | "pause"): void {
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

        const optionsMuteToggle = root.querySelector<HTMLButtonElement>('[data-role="options-mute-toggle"]');
        const volumeSlider = root.querySelector<HTMLInputElement>('[data-role="volume-slider"]');
        const hudRightCheckbox = root.querySelector<HTMLInputElement>('[data-role="hud-right-checkbox"]');
        const ghostTypeSelect = root.querySelector<HTMLSelectElement>('[data-role="ghost-type-select"]');
        const gridCheckbox = root.querySelector<HTMLInputElement>('[data-role="grid-checkbox"]');
        const screenShakeCheckbox = root.querySelector<HTMLInputElement>('[data-role="screen-shake-checkbox"]');
        const heightSaturationCheckbox = root.querySelector<HTMLInputElement>('[data-role="height-saturation-checkbox"]');
        const glowCheckbox = root.querySelector<HTMLInputElement>('[data-role="glow-checkbox"]');
        const transparencyCheckbox = root.querySelector<HTMLInputElement>('[data-role="transparency-checkbox"]');
        const fallTrailCheckbox = root.querySelector<HTMLInputElement>('[data-role="fall-trail-checkbox"]');
        const hardDropFlashCheckbox = root.querySelector<HTMLInputElement>('[data-role="hard-drop-flash-checkbox"]');
        const blockTypeSelect = root.querySelector<HTMLSelectElement>('[data-role="block-type-select"]');
        const themeGrid = root.querySelector<HTMLElement>('[data-role="theme-grid"]');
        const skipCountdownCheckbox = root.querySelector<HTMLInputElement>('[data-role="skip-countdown-checkbox"]');
        const mouseControlCheckbox = root.querySelector<HTMLInputElement>('[data-role="mouse-control-checkbox"]');
        const mouseSensitivityInput = root.querySelector<HTMLInputElement>('[data-role="mouse-sensitivity-input"]');
        const touchSensitivityInput = root.querySelector<HTMLInputElement>('[data-role="touch-sensitivity-input"]');
        const keyboardDasInput = root.querySelector<HTMLInputElement>('[data-role="keyboard-das-input"]');
        const keyboardArrInput = root.querySelector<HTMLInputElement>('[data-role="keyboard-arr-input"]');
        const dasPreview = root.querySelector<HTMLElement>('[data-role="das-preview"]');
        const arrPreview = root.querySelector<HTMLElement>('[data-role="arr-preview"]');
        const closeButton = root.querySelector<HTMLButtonElement>('[data-role="options-close-button"]');
        const closeKey = root.querySelector<HTMLElement>('[data-role="options-close-key"]');

        if (optionsMuteToggle) {
            optionsMuteToggle.addEventListener("click", () => {
                settingsController.toggleSound();
                this.syncCategoryResetButtons();
            });
        }

        if (volumeSlider) {
            volumeSlider.addEventListener("input", () => {
                game.settings.volume = Number(volumeSlider.value) / 100;
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

        this.benchmark.bind();

        if (ghostTypeSelect) {
            ghostTypeSelect.addEventListener("change", () => {
                game.settings.ghostType = ghostTypeSelect.value;
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

        const heightSaturationRow = root.querySelector<HTMLElement>('[data-role="height-saturation-row"]');
        const syncHeightSaturationAvailability = () => {
            const isColorful = (game.settings.blockType ?? (game.settings.outlineBlocks ? "radioactive" : "colorful")) === "colorful";
            if (!isColorful) game.settings.heightSaturation = false;
            if (heightSaturationCheckbox) {
                heightSaturationCheckbox.checked = isColorful && Boolean(game.settings.heightSaturation);
                heightSaturationCheckbox.disabled = !isColorful;
            }
            if (heightSaturationRow) heightSaturationRow.hidden = !isColorful;
        };
        syncHeightSaturationAvailability();

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
                game.settings.blockType = blockTypeSelect.value;
                game.settings.outlineBlocks = blockTypeSelect.value === "radioactive";
                game.settings.asciiFallingPieces = blockTypeSelect.value === "ascii";
                if (blockTypeSelect.value !== "colorful") game.settings.heightSaturation = false;
                syncHeightSaturationAvailability();
                settingsController.applyPerformanceSettings();
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (themeGrid) {
            themeGrid.addEventListener("click", (event) => {
                const card = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-role="theme-option"]') : null;
                if (!card) return;
                const theme = card.dataset.value;
                if (!theme) return;
                game.settings.theme = theme;
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

        const skipModeInfoCheckbox = root.querySelector<HTMLInputElement>('[data-role="skip-mode-info-checkbox"]');
        const showFirstGameTutorialCheckbox = root.querySelector<HTMLInputElement>('[data-role="show-first-game-tutorial-checkbox"]');
        if (skipModeInfoCheckbox) {
            skipModeInfoCheckbox.addEventListener("change", () => {
                game.settings.skipModeInfo = skipModeInfoCheckbox.checked;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (showFirstGameTutorialCheckbox) {
            showFirstGameTutorialCheckbox.addEventListener("change", () => {
                game.settings.showFirstGameTutorial = showFirstGameTutorialCheckbox.checked;
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
            mouseSensitivityInput.min = String(SENSITIVITY_MIN);
            mouseSensitivityInput.max = String(SENSITIVITY_MAX);
            mouseSensitivityInput.step = String(SENSITIVITY_STEP);
            mouseSensitivityInput.value = String(game.settings.mouseSensitivity ?? 1);
            mouseSensitivityInput.disabled = !game.settings.mouseControl;

            mouseSensitivityInput.addEventListener("change", () => {
                const parsed = parseFloat(mouseSensitivityInput.value);
                const value = clampToStep(
                    Number.isFinite(parsed) ? parsed : 1, SENSITIVITY_MIN, SENSITIVITY_MAX, SENSITIVITY_STEP
                );
                mouseSensitivityInput.value = String(value);
                game.settings.mouseSensitivity = value;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        if (touchSensitivityInput) {
            touchSensitivityInput.min = String(SENSITIVITY_MIN);
            touchSensitivityInput.max = String(SENSITIVITY_MAX);
            touchSensitivityInput.step = String(SENSITIVITY_STEP);
            touchSensitivityInput.value = String(game.settings.touchSensitivity ?? 1);

            touchSensitivityInput.addEventListener("change", () => {
                if (touchSensitivityInput.value === "") {
                    game.settings.touchSensitivity = null;
                    touchSensitivityInput.value = "1";
                    settingsController.saveSettings();
                    this.syncCategoryResetButtons();
                    return;
                }
                const parsed = parseFloat(touchSensitivityInput.value);
                if (!Number.isFinite(parsed)) {
                    touchSensitivityInput.value = String(game.settings.touchSensitivity ?? 1);
                    return;
                }
                const value = clampToStep(parsed, SENSITIVITY_MIN, SENSITIVITY_MAX, SENSITIVITY_STEP);
                touchSensitivityInput.value = String(value);
                game.settings.touchSensitivity = value;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
            });
        }

        const syncDasArrPreview = () => {
            if (!dasPreview && !arrPreview) return;
            const das = clampToStep(
                parseFloat(keyboardDasInput?.value ?? "") || DAS_MIN, DAS_MIN, DAS_MAX, DAS_STEP
            );
            const arr = clampToStep(
                parseFloat(keyboardArrInput?.value ?? "") || ARR_MIN, ARR_MIN, ARR_MAX, ARR_STEP
            );
            dasPreview?.style.setProperty("--das-ms", `${das}ms`);
            arrPreview?.style.setProperty("--arr-ms", `${Math.max(arr, 1)}ms`);
        };

        if (keyboardDasInput) {
            keyboardDasInput.min = String(DAS_MIN);
            keyboardDasInput.max = String(DAS_MAX);
            keyboardDasInput.step = String(DAS_STEP);
            keyboardDasInput.value = String(game.settings.keyboardDAS ?? DAS_MIN);

            keyboardDasInput.addEventListener("input", syncDasArrPreview);
            keyboardDasInput.addEventListener("change", () => {
                const parsed = parseFloat(keyboardDasInput.value);
                const value = clampToStep(
                    Number.isFinite(parsed) ? parsed : DAS_MIN, DAS_MIN, DAS_MAX, DAS_STEP
                );
                keyboardDasInput.value = String(value);
                game.settings.keyboardDAS = value;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
                syncDasArrPreview();
            });
        }

        if (keyboardArrInput) {
            keyboardArrInput.min = String(ARR_MIN);
            keyboardArrInput.max = String(ARR_MAX);
            keyboardArrInput.step = String(ARR_STEP);
            keyboardArrInput.value = String(game.settings.keyboardARR ?? ARR_MIN);

            keyboardArrInput.addEventListener("input", syncDasArrPreview);
            keyboardArrInput.addEventListener("change", () => {
                const parsed = parseFloat(keyboardArrInput.value);
                const value = clampToStep(
                    Number.isFinite(parsed) ? parsed : ARR_MIN, ARR_MIN, ARR_MAX, ARR_STEP
                );
                keyboardArrInput.value = String(value);
                game.settings.keyboardARR = value;
                settingsController.saveSettings();
                this.syncCategoryResetButtons();
                syncDasArrPreview();
            });
        }

        syncDasArrPreview();

        root.querySelectorAll<HTMLInputElement>('[data-role="category-volume-slider"]').forEach((slider) => {
            slider.addEventListener("input", () => {
                const category = slider.dataset.category;
                if (!category) return;
                const volume = Number(slider.value) / 100;
                game.settings.categoryVolumes = {...game.settings.categoryVolumes, [category]: volume};
                game.soundManager.setCategoryVolume(category, volume);
                settingsController.saveSettings();
                settingsController.syncCategoryMuteToggle(category);
                this.syncSoundCategoryResetButtons();
            });
        });

        root.querySelectorAll<HTMLButtonElement>('[data-role="category-mute-toggle"]').forEach((button) => {
            button.addEventListener("click", () => {
                const category = button.dataset.category;
                if (!category) return;
                settingsController.toggleCategoryMuted(category);
                settingsController.syncCategoryMuteToggle(category);
                this.syncSoundCategoryResetButtons();
            });
        });

        root.querySelectorAll<HTMLElement>('[data-role="sound-list"], [data-role="sound-list-countdown"]').forEach((list) => {
            list.addEventListener("input", (event) => {
                const slider = event.target instanceof Element ? event.target.closest<HTMLInputElement>('[data-role="sound-volume-slider"]') : null;
                if (!slider) return;
                const key = slider.dataset.soundKey;
                if (!key) return;
                const volume = Number(slider.value) / 100;
                game.settings.soundVolumes = {...game.settings.soundVolumes, [key]: volume};
                game.soundManager.setSoundVolume(key, volume);
                settingsController.saveSettings();
                settingsController.syncSoundMuteToggle(key);
                this.syncSoundCategoryResetButtons();
            });

            list.addEventListener("click", (event) => {
                const previewButton = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-role="sound-preview-button"]') : null;
                if (previewButton) {
                    this.togglePreviewButton(previewButton, list);
                    return;
                }

                const muteButton = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-role="sound-mute-toggle"]') : null;
                if (muteButton) {
                    const key = muteButton.dataset.soundKey;
                    if (!key) return;
                    settingsController.toggleSoundMuted(key);
                    settingsController.syncSoundMuteToggle(key);
                    this.syncSoundCategoryResetButtons();
                }
            });
        });


        this.bindLangSelect();
        this.dataTransfer.bind();
        this.keybindings.bind();
        this.bindCategoryResetButtons();
        this.bindSoundCategoryResetButtons();
        this.syncSoundCategoryResetButtons();
        this.syncCategoryResetButtons();
        this.search.bind();
    }

    categoryResetGroups() {
        const graphicsKeys = ["screenShake", "ghostType", "blockType", "heightSaturation", "glow", "transparency", "fallTrail", "hardDropFlash"];
        return {
            "reset-general-button": ["volume", "muted", "hudRight", "theme"],
            "reset-controls-button": ["mouseControl", "mouseSensitivity", "touchSensitivity"],
            "reset-gameplay-button": ["skipCountdown", "skipModeInfo", "gridLines"],
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
        const activeTheme = game.settings.theme || "none";
        const themeLabelKeys: Record<string, string> = {
            none: "screens.options.themeNone",
            vhs: "screens.options.themeVHS",
            matrix: "screens.options.themeMatrix",
            rain: "screens.options.themeRain",
            snow: "screens.options.themeSnow",
            volcano: "screens.options.themeVolcano",
        };
        themeGrid.querySelectorAll<HTMLElement>('[data-role="theme-option"]').forEach((card) => {
            card.setAttribute("aria-pressed", String(card.dataset.value === activeTheme));
        });
        const themeCurrent = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="theme-current"]');
        if (themeCurrent) {
            themeCurrent.textContent = game.i18n.t(themeLabelKeys[activeTheme] ?? "screens.options.themeNone");
        }
    }

    syncCategoryResetButtons() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const settingsController = game.settingsController;

        Object.entries(this.categoryResetGroups()).forEach(([role, keys]) => {
            const button = game.hud.overlayEl.querySelector<HTMLButtonElement>(`[data-role="${role}"]`);
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
            const button = game.hud.overlayEl.querySelector<HTMLButtonElement>(`[data-role="reset-${category}-button"]`);
            if (!button) return;
            const keys = game.soundManager.keysInCategory(category);
            button.hidden = !settingsController.isSoundCategoryModified(category, keys);
        });
    }

    bindBenchmark() {
        return this.benchmark.bind();
    }

    bindKeybindList() {
        return this.keybindings.bind();
    }

    syncKeybindResetButton() {
        return this.keybindings.syncResetButton();
    }

    bindOptionsSearch() {
        return this.search.bind();
    }

    setImportReviewVisible(visible: boolean) {
        return this.dataTransfer.setImportReviewVisible(visible);
    }

    showImportMessage(kind: "empty" | "invalid") {
        return this.dataTransfer.showImportMessage(kind);
    }

    showImportReview(changes: ImportReviewChange[]) {
        return this.dataTransfer.showImportReview(changes);
    }

    bindOptionsDataMenu() {
        return this.dataTransfer.bind();
    }

}
