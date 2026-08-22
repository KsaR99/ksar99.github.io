// @ts-nocheck
import type {ScreenFlow} from "./screen-flow.js";

import {defaultKeyBindings, type KeyBindingMap} from "../shared/key-bindings.js";

export class ScreenFlowOptionsKeybindings {
    constructor(public readonly flow: ScreenFlow) {
    }

    private get game() {
        return this.flow.game;
    }

    bind() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const list = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="keybind-list"]');
        const resetButton = game.hud.overlayEl.querySelector<HTMLButtonElement>('[data-role="keybind-reset-button"]');
        if (!list) return;

        const settingsController = game.settingsController;
        const keyboard = game.inputController.keyboard;

        const refreshList = () => {
            game.screens.renderKeybindRows(game.dom, list, game.settings.keyBindings, game.i18n);
            this.syncResetButton();
        };

        list.addEventListener("click", (event) => {
            const kbd = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-keybind-slot]") : null;
            if (!kbd || kbd.classList.contains("kbd--listening")) return;

            list.querySelectorAll(".kbd--listening").forEach((el) => el.classList.remove("kbd--listening"));
            keyboard.cancelListening();

            const slotId = kbd.dataset.keybindSlot;
            if (!slotId) return;
            const originalLabel = kbd.textContent;
            kbd.classList.add("kbd--listening");
            kbd.textContent = game.i18n.t("screens.options.keyboardPressKey");

            keyboard.listenForNextKey((code: string | null) => {
                kbd.classList.remove("kbd--listening");

                if (!code) {
                    kbd.textContent = originalLabel;
                    return;
                }

                const bindings: KeyBindingMap = {...(game.settings.keyBindings as KeyBindingMap), [slotId]: code};
                Object.keys(bindings).forEach((otherId) => {
                    if (otherId !== slotId && bindings[otherId] === code) bindings[otherId] = "";
                });
                game.settings.keyBindings = bindings;
                settingsController.saveSettings();
                refreshList();
            });
        });

        if (resetButton) {
            resetButton.addEventListener("click", () => {
                game.settings.keyBindings = defaultKeyBindings();
                settingsController.saveSettings();
                refreshList();
            });
        }

        this.syncResetButton();
    }

    syncResetButton() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const resetButton = game.hud.overlayEl.querySelector<HTMLButtonElement>('[data-role="keybind-reset-button"]');
        const resetLabel = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="keybind-reset-label"]');
        if (!resetButton) return;
        const defaults = defaultKeyBindings();
        const bindings = game.settings.keyBindings ?? {};
        const isDefault = Object.keys(defaults).every((key) => bindings[key] === defaults[key])
            && Object.keys(bindings).every((key) => key in defaults);
        resetButton.hidden = isDefault;
        if (resetLabel) resetLabel.hidden = isDefault;
    }

}
