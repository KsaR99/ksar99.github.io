"use strict";

import {VHS} from "../ui/themes/vhs.js";
import {Matrix} from "../ui/themes/matrix.js";
import {Rain} from "../ui/themes/rain.js";
import {Snow} from "../ui/themes/snow.js";

export class ThemeOverlay {
    constructor(game, {canvas = null, ctx = null} = {}) {
        this.game = game;
        this.themes = canvas && ctx ? {
            vhs: new VHS(canvas, ctx),
            matrix: new Matrix(canvas, ctx),
            rain: new Rain(canvas, ctx),
            snow: new Snow(canvas, ctx),
        } : {};
    }

    resize(width, height) {
        for (const instance of Object.values(this.themes)) {
            instance?.resize(width, height);
        }
    }

    setActive(theme) {
        this.game.activeTheme = theme ?? "none";
        this.game.renderer.setTheme(this.game.activeTheme);
        this.update();
    }

    update() {
        const game = this.game;
        const theme = game.activeTheme;
        const active = theme !== "none" && (game.state === "running" || game.state === "clearing");

        if (game.dom) {
            const overlayEl = game.dom.getElementById("filter-overlay");
            if (overlayEl) {
                overlayEl.classList.toggle("board__filter--active", active);
                overlayEl.dataset.theme = theme;
            }
        }

        for (const [name, instance] of Object.entries(this.themes)) {
            if (!instance) continue;
            if (active && theme === name) instance.start();
            else instance.stop();
        }
    }
}
