// @ts-nocheck
import type {Game} from "../game/game.js";
import {SETTINGS_EXPORT_FILENAME} from "../game/game-constants.js";

export type ImportReviewChange = { key: string; oldValue: unknown; newValue: unknown };

type OptionsDataTransferHost = {
    game: Game;
    pendingImportChanges: ImportReviewChange[] | null;
    setPendingImportChanges(changes: ImportReviewChange[] | null): void;
    renderOptionsMenu(): void;
};

export class OptionsDataTransferController {
    constructor(private readonly host: OptionsDataTransferHost) {
    }

    setImportReviewVisible(visible: boolean): void {
        const {game} = this.host;
        if (!game.hud.overlayEl) return;
        const panels = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-panels"]');
        const review = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-import-review"]');
        const closeButton = game.hud.overlayEl.querySelector<HTMLButtonElement>('[data-role="options-close-button"]');
        if (panels) panels.hidden = visible;
        if (review) review.hidden = !visible;
        if (closeButton) closeButton.hidden = visible;
    }

    showImportMessage(kind: "empty" | "invalid"): void {
        const {game} = this.host;
        if (!game.hud.overlayEl) return;
        this.setImportReviewVisible(true);
        const subtitle = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-import-subtitle"]');
        const emptyMsg = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-import-empty"]');
        const invalidMsg = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-import-invalid"]');
        const selectAllRow = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-import-select-all-row"]');
        const list = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-import-list"]');
        const actions = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-import-actions"]');
        const closeButton = game.hud.overlayEl.querySelector<HTMLButtonElement>('[data-role="options-import-close"]');
        if (subtitle) subtitle.hidden = true;
        if (selectAllRow) selectAllRow.hidden = true;
        if (list) list.hidden = true;
        if (actions) actions.hidden = true;
        if (emptyMsg) emptyMsg.hidden = kind !== "empty";
        if (invalidMsg) invalidMsg.hidden = kind !== "invalid";
        if (closeButton) {
            closeButton.hidden = false;
            closeButton.onclick = () => this.host.renderOptionsMenu();
        }
    }

    showImportReview(changes: ImportReviewChange[]): void {
        const {game} = this.host;
        if (!game.hud.overlayEl) return;
        if (changes.length === 0) {
            this.showImportMessage("empty");
            return;
        }
        this.setImportReviewVisible(true);
        const subtitle = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-import-subtitle"]');
        const emptyMsg = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-import-empty"]');
        const invalidMsg = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-import-invalid"]');
        const selectAllRow = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-import-select-all-row"]');
        const selectAllCheckbox = game.hud.overlayEl.querySelector('[data-role="options-import-select-all"]') as HTMLInputElement | null;
        const list = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-import-list"]');
        const actions = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-import-actions"]');
        const closeButton = game.hud.overlayEl.querySelector<HTMLButtonElement>('[data-role="options-import-close"]');
        if (emptyMsg) emptyMsg.hidden = true;
        if (invalidMsg) invalidMsg.hidden = true;
        if (closeButton) closeButton.hidden = true;
        if (subtitle) {
            subtitle.hidden = false;
            subtitle.textContent = game.i18n.t("screens.options.importDiffSubtitle", {count: changes.length});
        }
        if (selectAllRow) selectAllRow.hidden = false;
        if (actions) actions.hidden = false;
        if (selectAllCheckbox) selectAllCheckbox.checked = true;
        if (list) {
            list.hidden = false;
            game.screens.renderImportDiffRows(game.dom, list, changes, game.i18n);
        }
        this.host.setPendingImportChanges(changes);
    }

    bind(): void {
        const {game} = this.host;
        if (!game.hud.overlayEl) return;
        const exportButton = game.hud.overlayEl.querySelector<HTMLButtonElement>('[data-role="options-export-button"]');
        const importButton = game.hud.overlayEl.querySelector<HTMLButtonElement>('[data-role="options-import-button"]');
        const importFile = game.hud.overlayEl.querySelector('[data-role="options-import-file"]') as HTMLInputElement | null;
        const selectAllCheckbox = game.hud.overlayEl.querySelector('[data-role="options-import-select-all"]') as HTMLInputElement | null;
        const list = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-import-list"]');
        const cancelButton = game.hud.overlayEl.querySelector<HTMLButtonElement>('[data-role="options-import-cancel"]');
        const applyButton = game.hud.overlayEl.querySelector<HTMLButtonElement>('[data-role="options-import-apply"]');

        exportButton?.addEventListener("click", () => {
            const json = game.settingsController.exportSettings();
            const blob = new Blob([json], {type: "application/json"});
            const url = URL.createObjectURL(blob);
            const link = game.dom.createElement("a");
            link.href = url;
            link.download = SETTINGS_EXPORT_FILENAME;
            link.click();
            URL.revokeObjectURL(url);
        });

        if (importButton && importFile) {
            importButton.addEventListener("click", () => importFile.click());
            importFile.addEventListener("change", async () => {
                const file = importFile.files?.[0];
                importFile.value = "";
                if (!file) return;
                try {
                    const parsed = game.settingsController.parseImportedSettings(await file.text());
                    this.showImportReview(game.settingsController.diffSettings(parsed));
                } catch {
                    this.showImportMessage("invalid");
                }
            });
        }

        if (selectAllCheckbox && list) {
            selectAllCheckbox.addEventListener("change", () => {
                list.querySelectorAll<HTMLInputElement>('[data-role="options-diff-checkbox"]').forEach((checkbox) => {
                    checkbox.checked = selectAllCheckbox.checked;
                });
            });
            list.addEventListener("change", (event) => {
                const target = event.target;
                if (!(target instanceof HTMLInputElement) || target.dataset.role !== "options-diff-checkbox") return;
                const checkboxes = Array.from(list.querySelectorAll<HTMLInputElement>('[data-role="options-diff-checkbox"]'));
                selectAllCheckbox.checked = checkboxes.every((checkbox) => checkbox.checked);
            });
        }

        cancelButton?.addEventListener("click", () => {
            this.host.setPendingImportChanges(null);
            this.host.renderOptionsMenu();
        });

        applyButton?.addEventListener("click", async () => {
            if (!list) return;
            const selectedKeys = new Set(
                Array.from(list.querySelectorAll<HTMLInputElement>('[data-role="options-diff-checkbox"]'))
                    .filter((checkbox) => checkbox.checked)
                    .map((checkbox) => checkbox.dataset.key)
                    .filter((key): key is string => Boolean(key))
            );
            const selectedChanges = (this.host.pendingImportChanges ?? []).filter((change) => selectedKeys.has(change.key));
            this.host.setPendingImportChanges(null);
            await game.settingsController.applySettingsChanges(selectedChanges);
            this.host.renderOptionsMenu();
        });
    }
}
