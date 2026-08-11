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
        this.unregisterTarget(key);
        this._targets.set(key, {
            overlayEl: overlayEl ?? null,
            themes: this._buildThemes(canvas, ctx ?? canvas.getContext("2d", {willReadFrequently: true})),
        });
        this._updateTarget(key);
    }

    unregisterTarget(key) {
        const target = this._targets.get(key);
        if (!target) return;
        for (const instance of Object.values(target.themes)) instance?.stop();
        this._targets.delete(key);
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
        this.update();
    }

    update() {
        this._updateBodyTheme();
        for (const key of this._targets.keys()) this._updateTarget(key);
    }

    _updateBodyTheme() {
        const body = this.game.dom?.body;
        if (!body) return;
        body.classList.remove(...THEME_BODY_CLASSES);
        body.classList.add(`body--theme-${this.game.activeTheme}`);
    }

    _updateTarget(key) {
        const target = this._targets.get(key);
        if (!target) return;

        const game = this.game;
        const theme = game.activeTheme;
        const active = theme !== "none" && (game.state === "running" || game.state === "clearing");

        if (target.overlayEl) {
            const overlayClasses = target.overlayEl.classList;
            overlayClasses.toggle("board__filter--active", active);
            overlayClasses.remove(...THEME_MODIFIER_CLASSES);
            overlayClasses.add(`board__filter--${theme}`);
        }

        for (const [name, instance] of Object.entries(target.themes)) {
            if (!instance) continue;
            if (active && theme === name) instance.start();
            else instance.stop();
        }
    }
}
