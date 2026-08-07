"use strict";

import {SETTINGS_KEY} from "../game/game-constants.js";
import {defaultKeyBindings} from "../shared/key-bindings.js";

export class SettingsController {
    constructor(game) {
        this.game = game;
    }

    defaultSettings() {
        return {
            volume: 1,
            muted: false,
            glow: true,
            transparency: true,
            theme: "none",
            hudRight: false,
            ghost: true,
            gridLines: true,
            screenShake: true,
            heightSaturation: false,
            skipCountdown: false,
            skipModeInfo: false,
            mouseControl: false,
            mouseSensitivity: 1,
            touchSensitivity: null,
            keyboardDAS: 125,
            keyboardARR: 16,
            fallTrail: true,
            categoryVolumes: {
                sfx: 1,
                music: 0.1,
                voices: 0.5
            },
            soundVolumes: {
                rotate: 0.75,
                falling: 0.75,
                drop: 0.9
            },
            keyBindings: defaultKeyBindings(),
        };
    }

    prefersReducedMotion() {
        const media = globalThis.matchMedia;
        return media ? media("(prefers-reduced-motion: reduce)").matches : false;
    }

    async loadSettings() {
        const game = this.game;
        const defaults = this.defaultSettings();
        let settings = defaults;
        let hasStoredSettings = false;

        try {
            const storedRaw = await game.settingsStore.get(SETTINGS_KEY);
            if (storedRaw) {
                settings = {...defaults, ...JSON.parse(storedRaw)};
                settings.categoryVolumes = {...defaults.categoryVolumes, ...(settings.categoryVolumes ?? {})};
                settings.keyBindings = {...defaults.keyBindings, ...(settings.keyBindings ?? {})};
                hasStoredSettings = true;
            }
        } catch {
            settings = defaults;
        }

        if (!hasStoredSettings && this.prefersReducedMotion()) {
            settings.theme = "none";
        }

        game.settings = settings;
        if (settings.difficulty && game.difficulties[settings.difficulty]) {
            game.difficulty = settings.difficulty;
        }
        if (settings.mode && game.gameModes[settings.mode]) {
            game.mode = settings.mode;
        }
        game.soundManager.setVolume(settings.volume);
        game.soundManager.setMuted(settings.muted);
        this.applyAudioSettings();
        this.applyPerformanceSettings();
    }

    applyAudioSettings() {
        const game = this.game;
        const {categoryVolumes, soundVolumes} = game.settings;
        Object.entries(categoryVolumes ?? {}).forEach(([category, volume]) => {
            game.soundManager.setCategoryVolume(category, volume);
        });
        Object.entries(soundVolumes ?? {}).forEach(([key, volume]) => {
            game.soundManager.setSoundVolume(key, volume);
        });
    }

    saveSettings() {
        const game = this.game;
        return game.settingsStore.set(SETTINGS_KEY, JSON.stringify(game.settings));
    }

    applyPerformanceSettings() {
        const game = this.game;
        const {glow, transparency, theme, ghost, gridLines, fallTrail, screenShake, heightSaturation} = game.settings;
        game.renderer.setGlowEnabled(glow);
        game.renderer.setTransparencyEnabled(transparency);
        game.renderer.setGhostEnabled(ghost);
        game.renderer.setGridEnabled(gridLines);
        game.renderer.setShakeEnabled(screenShake);
        game.renderer.setHeightSaturationEnabled(heightSaturation);

        if (!fallTrail) {
            game.resetFallTrail();
            game.shiftAnim = null;
        }

        const body = game.dom?.body;
        if (body) {
            body.classList.toggle("perf-no-glow", !glow);
            body.classList.toggle("perf-no-transparency", !transparency);
            body.classList.toggle("hud-right", Boolean(game.settings.hudRight));
        }

        game.themeOverlay.setActive(theme);
    }

    settingsKeys() {
        return Object.keys(this.defaultSettings());
    }

    exportSettings() {
        const game = this.game;
        const {difficulty, mode, ...settings} = game.settings;
        const defaults = this.defaultSettings();

        const nonDefaultSettings = {};
        Object.entries(settings).forEach(([key, value]) => {
            if (JSON.stringify(value) !== JSON.stringify(defaults[key])) {
                nonDefaultSettings[key] = value;
            }
        });

        const payload = {
            app: "kl0ck1s",
            exportedAt: new Date().toISOString(),
            language: game.i18n?.lang ?? "en",
            settings: nonDefaultSettings,
        };
        return JSON.stringify(payload, null, 2);
    }

    parseImportedSettings(raw) {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new Error("Invalid JSON");
        }

        const settings = parsed && typeof parsed === "object" ? parsed.settings : null;
        if (!settings || typeof settings !== "object") throw new Error("Invalid settings file");

        const language = typeof parsed.language === "string" ? parsed.language : null;
        return {settings, language};
    }

    diffSettings({settings, language}) {
        const game = this.game;
        const changes = [];
        const defaults = this.defaultSettings();

        this.settingsKeys().forEach((key) => {
            const oldValue = game.settings[key];
            const newValue = key in settings ? settings[key] : defaults[key];
            if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return;
            changes.push({key, kind: "setting", oldValue, newValue});
        });

        if (language && game.i18n && language !== game.i18n.lang) {
            changes.push({key: "language", kind: "language", oldValue: game.i18n.lang, newValue: language});
        }

        return changes;
    }

    async applySettingsChanges(changes) {
        const game = this.game;
        let languageChange = null;

        changes.forEach((change) => {
            if (change.kind === "language") {
                languageChange = change.newValue;
            } else if (change.key === "categoryVolumes") {
                game.settings.categoryVolumes = {
                    ...this.defaultSettings().categoryVolumes,
                    ...change.newValue,
                };
            } else if (change.key === "keyBindings") {
                game.settings.keyBindings = {
                    ...this.defaultSettings().keyBindings,
                    ...change.newValue,
                };
            } else {
                game.settings[change.key] = change.newValue;
            }
        });

        if (changes.some((change) => change.kind === "setting")) {
            game.soundManager.setVolume(game.settings.volume);
            game.soundManager.setMuted(game.settings.muted);
            this.applyAudioSettings();
            this.applyPerformanceSettings();
            this.saveSettings();
        }

        if (languageChange) {
            await game.i18n.setLanguage(languageChange);
        }
    }

    toggleSound() {
        const game = this.game;
        game.settings.muted = !game.settings.muted;
        game.soundManager.setMuted(game.settings.muted);
        this.saveSettings();

        if (!game.dom) return;
        const muteCheckbox = game.dom.querySelector('[data-role="mute-checkbox"]');
        const volumeSlider = game.dom.querySelector('[data-role="volume-slider"]');
        if (muteCheckbox) muteCheckbox.checked = game.settings.muted;
        if (volumeSlider) volumeSlider.disabled = game.settings.muted;
    }
}
