"use strict";

import {SETTINGS_KEY} from "../game/game-constants.js";

/**
 * Owns persisted user settings (volume, visual toggles, chosen effect, ...):
 * defaults, loading/saving through the settings store, and applying them to
 * the renderer/DOM. Delegates the actual overlay effect switch to EffectOverlay.
 */
export class SettingsController {
    constructor(game) {
        this.game = game;
    }

    defaultSettings() {
        return {
            volume: 1, muted: false, glow: true, transparency: true, effect: "vhs", hudRight: false,
            ghost: true, gridLines: true, skipCountdown: false, mouseControl: false, fallTrail: true,
        };
    }

    prefersReducedMotion() {
        const media = globalThis.matchMedia;
        return media ? media("(prefers-reduced-motion: reduce)").matches : false;
    }

    async loadSettings() {
        const game = this.game;
        let settings = this.defaultSettings();
        let hasStoredSettings = false;

        try {
            const storedRaw = await game.settingsStore.get(SETTINGS_KEY);
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

        game.settings = settings;
        if (settings.difficulty && game.difficulties[settings.difficulty]) {
            game.difficulty = settings.difficulty;
        }
        game.soundManager.setVolume(settings.volume);
        game.soundManager.setMuted(settings.muted);
        this.applyPerformanceSettings();
    }

    saveSettings() {
        const game = this.game;
        return game.settingsStore.set(SETTINGS_KEY, JSON.stringify(game.settings));
    }

    applyPerformanceSettings() {
        const game = this.game;
        const {glow, transparency, effect, ghost, gridLines, fallTrail} = game.settings;
        game.renderer.setGlowEnabled(glow);
        game.renderer.setTransparencyEnabled(transparency);
        game.renderer.setGhostEnabled(ghost);
        game.renderer.setGridEnabled(gridLines);

        // Fall trail has no per-cell renderer setter like the others above -
        // game.render()/updateFallTrail() check game.settings.fallTrail
        // directly each frame. Clearing it here just means flipping the
        // toggle off mid-run makes any already-visible echoes disappear
        // immediately, instead of lingering until the piece next locks/spawns.
        // shiftAnim only exists to feed the trail distinct in-between x
        // values (see PieceController.moveHorizontal/moveToColumn), so it's
        // cut short too - otherwise a move made just before toggling off
        // would keep sliding for its last few frames instead of snapping.
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

        game.effectOverlay.setActive(effect);
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
