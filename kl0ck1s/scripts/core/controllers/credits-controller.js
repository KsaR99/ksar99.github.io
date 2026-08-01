"use strict";

import {CREDITS, CREDITS_TIMING} from "../shared/config.js";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel"];

// States that count as "actual gameplay" - credits must stay hidden during
// these. Everything else (idle, paused, options, game over, ...) is a menu/
// break in play, so credits are allowed to show there instead of only on
// the idle screen.
const GAMEPLAY_STATES = new Set(["countdown", "running", "clearing"]);

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
        if (GAMEPLAY_STATES.has(game.state)) {
            this._schedule(CREDITS_TIMING.IDLE_DELAY_MS);
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

        scroll.getAnimations().forEach((anim) => anim.cancel());

        // Always animate - the reduced-motion accessibility fallback isn't
        // wanted here, so no prefers-reduced-motion check.
        // translateY(±100%) resolves against the scroll list's OWN height,
        // not the board's - with only a few credits that's much shorter than
        // the board, so a plain -100%/100% keyframe barely moves it and it
        // settles visibly mid-board instead of clearing it. Measure the real
        // distances instead and animate in actual pixels: enter from fully
        // above the board, hold centered so it's readable, then continue down
        // and out below. iterations: Infinity loops it seamlessly straight
        // back to "fully above" with no gap.
        scroll.style.position = "absolute";
        scroll.style.transform = "";
        const topHiddenY = -scroll.scrollHeight;
        const bottomHiddenY = root.clientHeight;
        const centeredY = (root.clientHeight - scroll.scrollHeight) / 2;

        // Hold at center for exactly HOLD_DURATION_MS, whatever
        // SCROLL_DURATION_MS is - split the remaining time evenly between
        // the top->center approach and the center->bottom exit.
        const holdFraction = Math.min(0.9, CREDITS_TIMING.HOLD_DURATION_MS / CREDITS_TIMING.SCROLL_DURATION_MS);
        const enterEnd = (1 - holdFraction) / 2;
        const holdEnd = enterEnd + holdFraction;

        scroll.animate(
            [
                {transform: `translateY(${topHiddenY}px)`, offset: 0},
                {transform: `translateY(${centeredY}px)`, offset: enterEnd},
                {transform: `translateY(${centeredY}px)`, offset: holdEnd},
                {transform: `translateY(${bottomHiddenY}px)`, offset: 1},
            ],
            {duration: CREDITS_TIMING.SCROLL_DURATION_MS, easing: "ease-in-out", iterations: Infinity}
        );

        root.classList.add("board__credits--visible");
        root.setAttribute("aria-hidden", "false");

        this._schedule(CREDITS_TIMING.IDLE_DELAY_MS);
    }

    _hide() {
        const root = this.game.dom?.querySelector('[data-role="credits"]');
        if (!root) return;
        root.classList.remove("board__credits--visible");
        root.setAttribute("aria-hidden", "true");
    }
}
