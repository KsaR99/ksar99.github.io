"use strict";

import {VHS} from "../ui/themes/vhs.js";
import {Matrix} from "../ui/themes/matrix.js";
import {Rain} from "../ui/themes/rain.js";
import {Snow} from "../ui/themes/snow.js";

const THEME_NAMES = ["none", "matrix", "rain", "snow", "vhs"];
const THEME_MODIFIER_CLASSES = THEME_NAMES.map((name) => `board__filter--${name}`);
const THEME_BODY_CLASSES = THEME_NAMES.map((name) => `body--theme-${name}`);

export class ThemeOverlay {
    constructor(game, {canvas = null, ctx = null} = {}) {
        this.game = game;
        this._targets = new Map();
        this._targetThemeOverrides = new Map();
        if (canvas && ctx) {
            this._targets.set("main", {
                overlayEl: game.dom?.getElementById("filter-overlay") ?? null,
                themes: this._buildThemes(canvas, ctx),
            });
        }
    }

    _buildThemes(canvas, ctx) {
        return {
            vhs: new VHS(canvas, ctx),
            matrix: new Matrix(canvas, ctx),
            rain: new Rain(canvas, ctx),
            snow: new Snow(canvas, ctx),
        };
    }

    registerTarget(key, {overlayEl, canvas, ctx = null}) {
        const overrideBefore = this._targetThemeOverrides.get(key);
        console.debug("[theme-debug] registerTarget: override BEFORE unregisterTarget", {key, overrideBefore});
        this.unregisterTarget(key);
        console.debug("[theme-debug] registerTarget: override AFTER unregisterTarget (should be gone)", {
            key,
            overrideAfter: this._targetThemeOverrides.get(key),
        });
        this._targets.set(key, {
            overlayEl: overlayEl ?? null,
            themes: this._buildThemes(canvas, ctx ?? canvas.getContext("2d")),
        });
        this._updateTarget(key);
    }

    unregisterTarget(key) {
        const target = this._targets.get(key);
        if (!target) return;
        for (const instance of Object.values(target.themes)) instance?.stop();
        this._targets.delete(key);
        this._targetThemeOverrides.delete(key);
        console.debug("[theme-debug] unregisterTarget: deleted target + override", {key});
    }

    setTargetTheme(key, theme) {
        this._targetThemeOverrides.set(key, theme ?? "none");
        console.debug("[theme-debug] setTargetTheme", {key, theme: theme ?? "none"});
        this._updateTarget(key);
    }

    clearTargetTheme(key) {
        this._targetThemeOverrides.delete(key);
        console.debug("[theme-debug] clearTargetTheme", {key});
        this._updateTarget(key);
    }

    resize(width, height, key = "main") {
        const target = this._targets.get(key);
        if (!target) return;
        for (const instance of Object.values(target.themes)) {
            instance?.resize(width, height);
        }
    }

    setActive(theme) {
        this.game.activeTheme = theme ?? "none";
        this.game.renderer.setTheme(this.game.activeTheme);
        this._updateBodyTheme();
        this.update();
    }

    update() {
        for (const key of this._targets.keys()) this._updateTarget(key);
    }

    _updateBodyTheme() {
        const body = this.game.dom?.body;
        if (!body) return;
        const theme = this.game.activeTheme;
        if (this._appliedBodyTheme === theme) return;
        this._appliedBodyTheme = theme;
        body.classList.remove(...THEME_BODY_CLASSES);
        body.classList.add(`body--theme-${theme}`);
    }

    _updateTarget(key) {
        const target = this._targets.get(key);
        if (!target) return;

        const game = this.game;
        const theme = this._targetThemeOverrides.get(key) ?? game.activeTheme;
        const active = theme !== "none" && (game.state === "running" || game.state === "clearing");

        if (target.overlayEl) {
            const overlayClasses = target.overlayEl.classList;
            overlayClasses.toggle("board__filter--active", active);
            if (target._appliedTheme !== theme) {
                target._appliedTheme = theme;
                overlayClasses.remove(...THEME_MODIFIER_CLASSES);
                overlayClasses.add(`board__filter--${theme}`);
            }
        }

        for (const [name, instance] of Object.entries(target.themes)) {
            if (!instance) continue;
            if (active && theme === name) instance.start();
            else instance.stop();
        }
    }
}
