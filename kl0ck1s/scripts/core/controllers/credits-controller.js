"use strict";

import {CREDITS, CREDITS_TIMING} from "../shared/config.js";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel"];

export class CreditsController {
    constructor(game) {
        this.game = game;
        this._idleTimer = null;
        this._onActivity = this._onActivity.bind(this);
    }

    bind() {
        const game = this.game;
        if (!game.dom) return;
        ACTIVITY_EVENTS.forEach((type) => game.dom.addEventListener(type, this._onActivity, {passive: true}));
        this._schedule(CREDITS_TIMING.IDLE_DELAY_MS);
    }

    _isCreditsLink(event) {
        return Boolean(event.target.closest?.('[data-role="credits-link"]'));
    }

    _onActivity(event) {
        if (this._isCreditsLink(event)) return;
        this._hide();
        this._schedule(CREDITS_TIMING.IDLE_DELAY_MS);
    }

    _schedule(delay) {
        clearTimeout(this._idleTimer);
        this._idleTimer = setTimeout(() => this._show(), delay);
    }

    _show() {
        const game = this.game;
        if (game.state !== "idle") {
            this._schedule(CREDITS_TIMING.REPEAT_INTERVAL_MS);
            return;
        }

        const root = game.dom.querySelector('[data-role="credits"]');
        const scroll = game.dom.querySelector('[data-role="credits-scroll"]');
        if (!root || !scroll) return;

        scroll.replaceChildren();
        CREDITS.forEach((person) => {
            const entry = game.dom.getElementById("tpl-credits-entry").content.cloneNode(true);
            const link = entry.querySelector('[data-role="credits-link"]');
            link.href = person.link;
            link.textContent = person.name;
            entry.querySelector('[data-field="roles"]').textContent = person.roles
                .map((role) => game.i18n.t(`credits.role${role.charAt(0).toUpperCase()}${role.slice(1)}`))
                .join(" / ");
            scroll.appendChild(entry);
        });

        scroll.style.animation = "none";
        void scroll.offsetWidth;
        scroll.style.animation = `credits-scroll-down ${CREDITS_TIMING.SCROLL_DURATION_MS}ms linear forwards`;

        root.classList.add("board__credits--visible");
        root.setAttribute("aria-hidden", "false");

        this._schedule(CREDITS_TIMING.REPEAT_INTERVAL_MS);
    }

    _hide() {
        const root = this.game.dom?.querySelector('[data-role="credits"]');
        if (!root) return;
        root.classList.remove("board__credits--visible");
        root.setAttribute("aria-hidden", "true");
    }
}
