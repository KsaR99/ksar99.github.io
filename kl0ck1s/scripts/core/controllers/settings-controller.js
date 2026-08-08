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
            heightSaturation: true,
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
        let stored = null;
        let hasStoredSettings = false;

        try {
            const storedRaw = await game.settingsStore.get(SETTINGS_KEY);
            if (storedRaw) {
                stored = JSON.parse(storedRaw);
                hasStoredSettings = true;
            }
        } catch {
            stored = null;
        }

        this.applyStoredSettings(stored ?? {});

        if (!hasStoredSettings && this.prefersReducedMotion()) {
            game.settings.theme = "none";
        }
    }

    /**
     * Applies a (possibly partial) settings object on top of the defaults,
     * updating game.settings, game.difficulty/mode, and live audio/render
     * state. Used both for the initial load and when switching to a profile
     * that has its own saved settings.
     */
    applyStoredSettings(stored) {
        const game = this.game;
        const defaults = this.defaultSettings();
        const settings = {...defaults, ...stored};
        settings.categoryVolumes = {...defaults.categoryVolumes, ...(stored.categoryVolumes ?? {})};
        settings.soundVolumes = {...defaults.soundVolumes, ...(stored.soundVolumes ?? {})};
        settings.keyBindings = {...defaults.keyBindings, ...(stored.keyBindings ?? {})};

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
        this.syncMuteToggle();
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
        const profile = game.leaderboard.profile;
        if (profile) {
            game.leaderboard.saveProfileSettings(profile, game.settings);
        }
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

    resetSettingsForKeys(keys) {
        const game = this.game;
        const defaults = this.defaultSettings();
        keys.forEach((key) => {
            game.settings[key] = defaults[key];
        });

        game.soundManager.setVolume(game.settings.volume);
        game.soundManager.setMuted(game.settings.muted);
        this.applyAudioSettings();
        this.applyPerformanceSettings();
        this.saveSettings();
        this.syncMuteToggle();
    }

    isSoundCategoryModified(category, keys) {
        const game = this.game;
        const defaults = this.defaultSettings();
        const settings = game.settings;

        const defaultCategoryVolume = defaults.categoryVolumes[category] ?? 1;
        const currentCategoryVolume = settings.categoryVolumes?.[category] ?? 1;
        if (currentCategoryVolume !== defaultCategoryVolume) return true;

        return keys.some((key) => {
            const defaultVolume = defaults.soundVolumes[key] ?? 1;
            const currentVolume = settings.soundVolumes?.[key] ?? 1;
            return currentVolume !== defaultVolume;
        });
    }

    resetSoundCategory(category, keys) {
        const game = this.game;
        const defaults = this.defaultSettings();

        const categoryVolumes = {...game.settings.categoryVolumes};
        categoryVolumes[category] = defaults.categoryVolumes[category] ?? 1;
        game.settings.categoryVolumes = categoryVolumes;

        const soundVolumes = {...game.settings.soundVolumes};
        keys.forEach((key) => {
            if (key in defaults.soundVolumes) soundVolumes[key] = defaults.soundVolumes[key];
            else delete soundVolumes[key];
        });
        game.settings.soundVolumes = soundVolumes;

        this.applyAudioSettings();
        this.saveSettings();
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
            this.syncMuteToggle();
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
        this.syncMuteToggle();
    }

    syncMuteToggle() {
        const game = this.game;
        if (!game.dom) return;
        const button = game.dom.querySelector('[data-role="mute-toggle"]');
        if (!button) return;
        const muted = Boolean(game.settings.muted);
        button.setAttribute("aria-pressed", String(muted));
        const icon = button.querySelector('[data-role="mute-toggle-icon"]');
        if (icon) icon.textContent = muted ? "🔇" : "🔊";
    }
}
