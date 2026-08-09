"use strict";

import {VHS} from "../ui/themes/vhs.js";
import {Matrix} from "../ui/themes/matrix.js";
import {Rain} from "../ui/themes/rain.js";
import {Snow} from "../ui/themes/snow.js";

/**
 * Drives the animated theme filter (VHS/matrix/rain/snow) over one or more
 * board canvases. The main board is registered as the "main" target at
 * construction time; other boards - currently just the multiplayer opponent
 * panel - can be registered/unregistered later via registerTarget/
 * unregisterTarget as that panel is built and torn down, so the opponent's
 * board mirrors whichever theme is active instead of always staying plain.
 * Each target gets its own set of theme instances since every theme class
 * keeps per-canvas animation state (particle positions etc.) - they can't be
 * shared across two physically different canvases.
 */
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

    /** Adds another board to keep in sync with the active theme (e.g. "opponent"). */
    registerTarget(key, {overlayEl, canvas, ctx = null}) {
        this.unregisterTarget(key);
        this._targets.set(key, {
            overlayEl: overlayEl ?? null,
            themes: this._buildThemes(canvas, ctx ?? canvas.getContext("2d", {willReadFrequently: true})),
        });
        this._updateTarget(key);
    }

    /** Stops and drops a previously registered target - call when its board is torn down. */
    unregisterTarget(key) {
        const target = this._targets.get(key);
        if (!target) return;
        for (const instance of Object.values(target.themes)) instance?.stop();
        this._targets.delete(key);
    }

    /** Resizes one target's theme canvases (default "main") to match its board canvas. */
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
        for (const key of this._targets.keys()) this._updateTarget(key);
    }

    _updateTarget(key) {
        const target = this._targets.get(key);
        if (!target) return;

        const game = this.game;
        const theme = game.activeTheme;
        const active = theme !== "none" && (game.state === "running" || game.state === "clearing");

        if (target.overlayEl) {
            target.overlayEl.classList.toggle("board__filter--active", active);
            target.overlayEl.dataset.theme = theme;
        }

        for (const [name, instance] of Object.entries(target.themes)) {
            if (!instance) continue;
            if (active && theme === name) instance.start();
            else instance.stop();
        }
    }
}
