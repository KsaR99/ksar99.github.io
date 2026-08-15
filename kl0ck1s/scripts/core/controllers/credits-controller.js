"use strict";

import {CREDITS, CREDITS_TIMING} from "../shared/config.js";

const FLIP_DURATION_MS = 400;

const GAMEPLAY_STATES = new Set(["countdown", "running", "clearing"]);

export class CreditsController {
    constructor(game) {
        this.game = game;
        this._flipTimer = null;
        this._onVersionClick = this._onVersionClick.bind(this);
        this._onCreditsClick = this._onCreditsClick.bind(this);
    }

    bind() {
        const game = this.game;
        if (!game.dom) return;

        const version = game.dom.querySelector('[data-role="brand-version"]');
        version?.addEventListener("click", this._onVersionClick);

        const root = game.dom.querySelector('[data-role="credits"]');
        root?.addEventListener("click", this._onCreditsClick);
    }

    _isCreditsLink(event) {
        return Boolean(event.target.closest?.('[data-role="credits-link"]'));
    }

    _onVersionClick() {
        const game = this.game;
        if (GAMEPLAY_STATES.has(game.state)) return;

        const root = game.dom.querySelector('[data-role="credits"]');
        if (root?.classList.contains("board__credits--visible")) return;

        const flip = game.dom.querySelector('[data-role="brand-title-flip"]');
        flip?.classList.add("brand__title-flip--rotated");

        clearTimeout(this._flipTimer);
        this._flipTimer = setTimeout(() => this._show(), FLIP_DURATION_MS);
    }

    _onCreditsClick(event) {
        if (this._isCreditsLink(event)) return;

        const root = this.game.dom?.querySelector('[data-role="credits"]');
        if (!root || !root.classList.contains("board__credits--visible")) return;

        this._closeAnimated();
    }

    _show() {
        const game = this.game;
        if (GAMEPLAY_STATES.has(game.state)) return;

        const root = game.dom.querySelector('[data-role="credits"]');
        const scroll = game.dom.querySelector('[data-role="credits-scroll"]');
        if (!root || !scroll) return;

        scroll.replaceChildren();

        const title = game.dom.createElement("p");
        title.className = "brand__title";
        title.textContent = "Kl0ck1's";
        scroll.appendChild(title);

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

        scroll.getAnimations().forEach((anim) => anim.cancel());
        scroll.style.position = "absolute";
        scroll.style.transform = "";

        const topHiddenY = -scroll.scrollHeight;
        const centeredY = (root.clientHeight - scroll.scrollHeight) / 2;

        scroll.animate(
            [
                {transform: `translateY(${topHiddenY}px)`, offset: 0},
                {transform: `translateY(${centeredY}px)`, offset: 1},
            ],
            {duration: CREDITS_TIMING.ENTER_DURATION_MS, easing: "ease-in-out", fill: "forwards"}
        );

        root.classList.add("board__credits--visible");
        root.setAttribute("aria-hidden", "false");
    }

    _closeAnimated() {
        const game = this.game;
        const root = game.dom.querySelector('[data-role="credits"]');
        const scroll = game.dom.querySelector('[data-role="credits-scroll"]');
        if (!root || !scroll) {
            this._hide();
            return;
        }

        scroll.getAnimations().forEach((anim) => {
            anim.commitStyles();
            anim.cancel();
        });

        const bottomHiddenY = root.clientHeight;
        const currentTransform = scroll.style.transform || "translateY(0)";

        scroll.animate(
            [
                {transform: currentTransform},
                {transform: `translateY(${bottomHiddenY}px)`},
            ],
            {duration: CREDITS_TIMING.EXIT_DURATION_MS, easing: "ease-in"}
        ).finished
            .then(() => this._hide())
            .catch(() => this._hide());
    }

    _hide() {
        const flip = this.game.dom?.querySelector('[data-role="brand-title-flip"]');
        flip?.classList.remove("brand__title-flip--rotated");

        const root = this.game.dom?.querySelector('[data-role="credits"]');
        if (!root) return;
        root.classList.remove("board__credits--visible");
        root.setAttribute("aria-hidden", "true");
    }
}
