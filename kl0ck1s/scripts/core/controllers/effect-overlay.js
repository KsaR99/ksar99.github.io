"use strict";

import {VhsNoise} from "../effects/vhs-noise.js";
import {MatrixEffect} from "../effects/matrix-effect.js";
import {Rain} from "../effects/rain.js";
import {Snow} from "../effects/snow.js";

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

    resize(width, height) {
        for (const instance of Object.values(this.effects)) {
            instance?.resize(width, height);
        }
    }

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
