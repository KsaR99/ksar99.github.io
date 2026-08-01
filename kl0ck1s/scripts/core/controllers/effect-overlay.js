"use strict";

import {VhsNoise} from "../effects/vhs-noise.js";
import {MatrixEffect} from "../effects/matrix-effect.js";
import {Rain} from "../effects/rain.js";
import {Snow} from "../effects/snow.js";

/**
 * Drives the board's visual filter overlay (VHS noise, matrix rain, rain, snow, ...)
 * and, since the two are meant to match, the board theme (background + accent
 * border, see .board[data-theme] in main.css) that goes along with whichever
 * effect is selected. Owns the effect canvas: given `canvas`/`ctx`, it builds
 * every effect instance itself. Adding a new effect later means adding it
 * here and a matching .board[data-theme="..."] block in main.css — nothing
 * else in the game (or main.js) needs to know the effect classes exist.
 */
export class EffectOverlay {
    constructor(game, {canvas = null, ctx = null} = {}) {
        this.game = game;
        this.effects = canvas && ctx ? {
            vhs: new VhsNoise(canvas, ctx),
            matrix: new MatrixEffect(canvas, ctx),
            rain: new Rain(canvas, ctx),
            snow: new Snow(canvas, ctx),
        } : {};
    }

    /** Resizes every effect's backing canvas/buffers. Call whenever the board canvas resizes. */
    resize(width, height) {
        for (const instance of Object.values(this.effects)) {
            instance?.resize(width, height);
        }
    }

    /** Sets which effect is selected and immediately syncs the overlay and board theme to it. */
    setActive(effect) {
        this.game.activeEffect = effect ?? "none";
        this.game.renderer.setTheme(this.game.activeEffect);
        this.update();
    }

    /** Called every render frame: syncs overlay visibility to game state (only active while playing). */
    update() {
        const game = this.game;
        const effect = game.activeEffect;
        const active = effect !== "none" && (game.state === "running" || game.state === "clearing");

        if (game.dom) {
            const overlayEl = game.dom.getElementById("filter-overlay");
            if (overlayEl) {
                overlayEl.classList.toggle("board__filter--active", active);
                overlayEl.dataset.effect = effect;
            }
        }

        for (const [name, instance] of Object.entries(this.effects)) {
            if (!instance) continue;
            if (active && effect === name) instance.start();
            else instance.stop();
        }
    }
}
