// @ts-nocheck
"use strict";

import {formatKeyCode} from "../shared/key-bindings.js";

export class FirstGameTutorial {
    game: any;
    root: HTMLElement | null;
    timer: number | null;
    onKeyDown: ((event: KeyboardEvent) => void) | null;

    constructor(game) {
        this.game = game;
        this.root = game.dom.querySelector('[data-role="first-game-tutorial"]');
        this.timer = null;
        this.onKeyDown = null;
    }

    isKeyboardMode(): boolean {
        const input = this.game.inputController;
        const touch = input?.touch;
        const touchBar = this.game.dom.querySelector('[data-role="touch-controls"]');
        const coarsePointer = this.game.dom.defaultView?.matchMedia?.("(pointer: coarse)")?.matches;
        return !(touch?.enabled || touchBar?.classList.contains("touch-controls--visible") || coarsePointer);
    }

    key(slot: string, fallback: string): string {
        const code = this.game.settings?.keyBindings?.[slot] ?? fallback;
        return formatKeyCode(code);
    }

    control(labelKey: string, keyLabel: string): string {
        const label = this.game.i18n.t(labelKey);
        return `<div class="first-game-tutorial__control">
            <span class="first-game-tutorial__label">${this.escape(label)}</span>
            <kbd class="first-game-tutorial__key">${this.escape(keyLabel)}</kbd>
        </div>`;
    }

    escape(value: unknown): string {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    render(): void {
        if (!this.root) return;

        const fragment = this.game.dom.getElementById("tpl-first-game-tutorial")?.content?.cloneNode(true);
        if (!fragment) return;

        const controls = fragment.querySelector('[data-role="first-game-tutorial-controls"]');
        const hint = fragment.querySelector('[data-field="hint"]');
        const dismiss = fragment.querySelector('[data-role="first-game-tutorial-dismiss"]');
        const dontShow = fragment.querySelector('[data-role="first-game-tutorial-dont-show"]');
        const dontShowLabel = fragment.querySelector('[data-field="dont-show-label"]');
        const closeHint = fragment.querySelector('[data-field="close-hint"]');
        const badge = fragment.querySelector('[data-i18n="screens.firstGameTutorial.badge"]');
        const title = fragment.querySelector('[data-i18n="screens.firstGameTutorial.title"]');

        const keyboard = this.isKeyboardMode();

        if (keyboard) {
            controls.innerHTML = [
                this.control("screens.firstGameTutorial.move", `${this.key("moveLeft", "ArrowLeft")} / ${this.key("moveRight", "ArrowRight")}`),
                this.control("screens.firstGameTutorial.rotate", this.key("rotateUp", "ArrowUp")),
                this.control("screens.firstGameTutorial.softDrop", this.key("softDrop", "ArrowDown")),
                this.control("screens.firstGameTutorial.hardDrop", this.key("hardDrop", "Space")),
            ].join("");

            hint.textContent = this.game.i18n.t("screens.firstGameTutorial.keyboardHint");
        } else {
            controls.innerHTML = [
                this.control("screens.firstGameTutorial.move", "← / →"),
                this.control("screens.firstGameTutorial.rotate", "↺ / ↻"),
                this.control("screens.firstGameTutorial.softDrop", "↓"),
                this.control("screens.firstGameTutorial.hardDrop", "⏬"),
            ].join("");

            hint.textContent = this.game.i18n.t("screens.firstGameTutorial.touchHint");
        }

        badge.textContent = this.game.i18n.t("screens.firstGameTutorial.badge");
        title.textContent = this.game.i18n.t("screens.firstGameTutorial.title");
        if (dontShowLabel) dontShowLabel.textContent = this.game.i18n.t("screens.firstGameTutorial.dontShowAgain");
        if (closeHint) closeHint.textContent = this.game.i18n.t("screens.firstGameTutorial.closeHint");

        const dismissText = this.game.i18n.t("screens.firstGameTutorial.dismiss");
        dismiss.textContent = dismissText;

        this.root.innerHTML = "";
        this.root.appendChild(fragment);
        this.root.classList.toggle("first-game-tutorial--touch", !keyboard);
        this.root.hidden = false;
        const board = this.root.closest(".board");
        board?.classList.add("first-game-tutorial-active");

        if (dontShow) {
            dontShow.checked = this.game.settings?.showFirstGameTutorial === false;
            dontShow.addEventListener("change", () => {
                if (!dontShow.checked) return;
                this.game.settings.showFirstGameTutorial = false;
                this.game.settingsController?.saveSettings?.();
                this.hide();
            });
        }

        dismiss.addEventListener("click", () => {
            this.hide();
        }, {once: true});

        if (this.timer != null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.onKeyDown) {
            this.game.dom.removeEventListener("keydown", this.onKeyDown, true);
            this.onKeyDown = null;
        }
        this.onKeyDown = (event: KeyboardEvent) => {
            if (this.root?.hidden) return;
            if (event.key !== "Enter" && event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            this.hide();
        };
        this.game.dom.addEventListener("keydown", this.onKeyDown, true);
    }

    showIfFirstGame(): void {
        if (this.game.settings?.showFirstGameTutorial === false) return;

        this.render();

    }

    hide(): void {
        if (!this.root) return;
        this.root.hidden = true;
        this.root.innerHTML = "";
        this.root.closest(".board")?.classList.remove("first-game-tutorial-active");
        if (this.timer != null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.onKeyDown) {
            this.game.dom.removeEventListener("keydown", this.onKeyDown, true);
            this.onKeyDown = null;
        }
    }
}
