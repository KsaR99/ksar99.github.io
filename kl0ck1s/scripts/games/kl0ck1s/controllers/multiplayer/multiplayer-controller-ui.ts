// @ts-nocheck
import {MESSAGE_KIND,} from "../../../../engine/net/net-constants.js";


import type {MultiplayerController} from "../multiplayer-controller.js";
import {
    BOT_DIFFICULTY_ORDER,
    PANEL_KEY_CONFIG,
    RUNNING_STATES,
    STEP_BY_PANEL
} from "./multiplayer-controller-constants.js";

"use strict";

export function startFrameLoop(controller: MultiplayerController) {

    const tick = () => {
        controller._frameTick();
        controller._frameLoopRaf = requestAnimationFrame(tick);
    };
    controller._frameLoopRaf = requestAnimationFrame(tick);
}

export function frameTick(controller: MultiplayerController) {

    const game = controller.game;
    const isClearing = game.state === "clearing";
    if (isClearing && !controller._wasLocalClearing && controller.session?.isConnected) {
        controller._sendToPeer({
            kind: MESSAGE_KIND.CLEARING,
            cells: Array.from(game.board.colors),
            lines: game.clearingLines,
            dropRows: game.clearingDropRows,
            duration: game.lineClearAnimationDuration,
        });

        controller._lastSentBoardVersion = game.board.version;
        controller._lastSentBoardCells = Uint8Array.from(game.board.colors);
    }
    controller._wasLocalClearing = isClearing;

    if (controller._remoteClearing) {
        controller._renderRemoteClearingFrame();
    } else if (controller._remoteLivePiece
        || (controller._remoteHardDropTrail && controller.game.settings.fallTrail)
        || (controller._remoteHardDropFlash && controller.game.settings.hardDropFlash)) {
        controller._drawOpponentBoard(
            controller._lastRemoteCells,
            controller._currentRemoteLivePieceForDraw(),
            controller._currentHardDropTrailForDraw(),
            controller._currentHardDropFlashForDraw(),
        );
    }
}

export function notifyHardDropTrail(controller: MultiplayerController) {

    const trail = controller.game.hardDropTrail;
    const flash = controller.game.hardDropImpactFlash;
    if ((!trail && !flash) || !controller.session?.isConnected) return;
    controller._sendToPeer({
        kind: MESSAGE_KIND.HARD_DROP_TRAIL,
        entries: trail?.entries || [],
        duration: trail?.duration || 0,
        flashEntry: flash?.entry || null,
        flashDuration: flash?.duration || 0,
    });
}

export function notifyLockImpactFlash(controller: MultiplayerController) {

    const flash = controller.game.lockImpactFlash;
    if (!flash || !controller.game.multiplayerConnected) return;

    controller._sendToPeer({
        kind: MESSAGE_KIND.HARD_DROP_TRAIL,
        entries: [],
        duration: 0,
        flashEntry: flash.entry,
        flashDuration: flash.duration,
    });
}

export function notifyThemeChanged(controller: MultiplayerController) {

    const theme = controller.game.settings.theme ?? "none";
    if (!controller.session?.isConnected || theme === controller._lastSentTheme) return;
    controller._lastSentTheme = theme;
    controller._sendToPeer({kind: MESSAGE_KIND.THEME, theme});
}

export function open(controller: MultiplayerController) {

    const root = controller.overlayEl;
    if (!root) return;
    controller._clearError();
    if (controller.panels?.result) {
        controller.panels.result.hidden = true;
        controller.panels.result.style.display = "none";
    }
    if (controller._resultPanelEl) {
        controller._resultPanelEl.hidden = true;
        controller._resultPanelEl = null;
    }
    controller._showPanel(controller.session?.isConnected ? "ready" : "role");

    const hudOverlay = controller.game.hud?.overlayEl;
    if (hudOverlay && root.parentElement !== hudOverlay) {
        if (!controller._persistentOverlayParent) {
            controller._persistentOverlayParent = root.parentElement;
            controller._persistentOverlayNextSibling = root.nextSibling;
        }
        hudOverlay.replaceChildren(root);
        hudOverlay.classList.add("board__overlay--visible");
        hudOverlay.classList.remove("board__overlay--transparent");
    }
    root.hidden = false;
    root.classList.add("mp-overlay--screen");
    root.classList.add("mp-overlay--visible");
    requestAnimationFrame(() => root.querySelector("[data-role=mp-return-button]")?.focus());
}

export function close(controller: MultiplayerController) {

    const root = controller.overlayEl;
    if (!root) {
        controller.game.screenFlow?.showModeChoiceScreen?.();
        return;
    }
    root.classList.remove("mp-overlay--visible", "mp-overlay--screen");
    root.hidden = true;

    const persistentParent = controller._persistentOverlayParent;
    if (persistentParent && root.parentElement !== persistentParent) {
        const nextSibling = controller._persistentOverlayNextSibling;
        if (nextSibling && nextSibling.parentNode === persistentParent) {
            persistentParent.insertBefore(root, nextSibling);
        } else {
            persistentParent.appendChild(root);
        }
    }
    clearTimeout(controller._negotiationRetryTimer);
    controller._negotiationRetryTimer = null;
    controller._negotiationRetryCount = 0;
    controller.game.hud?.hideOverlay();

    if (controller._connectInFlight || controller._launching) return;

    if (controller.session) controller._resetSession();
    controller.game.screenFlow?.showModeChoiceScreen?.();
}

export function onKeydown(controller: MultiplayerController, event: KeyboardEvent) {

    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (controller.isResultPanelVisible) {
        const isCloseKey = event.key === "Escape"
            || event.code === "KeyX"
            || event.key.toLowerCase() === "x";
        const isEnterKey = event.key === "Enter" || event.code === "NumpadEnter";

        if (isCloseKey) {
            event.preventDefault();
            controller._closeResult();
            return;
        }

        if (isEnterKey) {
            const rematchButton = controller.overlayEl?.querySelector<HTMLButtonElement>(
                '[data-role="mp-result-rematch-button"]',
            );
            if (rematchButton && !rematchButton.hidden && !rematchButton.disabled) {
                event.preventDefault();
                rematchButton.click();
            }
            return;
        }
    }

    if (event.key === "Escape") {
        controller.close();
        return;
    }

    const config = PANEL_KEY_CONFIG[controller._activePanelName];
    if (!config) return;

    const groups = config.groups ?? [];

    if (event.code === "ArrowUp" || event.code === "ArrowDown") {
        if (!groups.length || event.repeat) return;
        event.preventDefault();

        if (controller._activePanelName === "role") {
            if (event.code === "ArrowDown") {
                if (controller._panelGroupFocus === 0 || controller._panelGroupFocus === 1) {
                    controller._panelGroupFocus = 2;
                }
            } else if (controller._panelGroupFocus === 2) {
                controller._panelGroupFocus = 0;
            }
            controller._syncPanelGroupFocus();
            return;
        }

        const dir = event.code === "ArrowDown" ? 1 : -1;
        controller._panelGroupFocus = Math.max(0, Math.min(groups.length - 1, controller._panelGroupFocus + dir));
        controller._syncPanelGroupFocus();
        return;
    }

    if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        if (event.repeat) return;
        if (controller.game.state !== "idle") return;

        if (controller._activePanelName === "role") {
            if (controller._panelGroupFocus === 0 && event.code === "ArrowRight") {
                controller._panelGroupFocus = 1;
            } else if (controller._panelGroupFocus === 1 && event.code === "ArrowLeft") {
                controller._panelGroupFocus = 0;
            } else {
                return;
            }
            event.preventDefault();
            controller._syncPanelGroupFocus();
            return;
        }

        const group = groups[controller._panelGroupFocus];
        if (!group) return;
        const role = event.code === "ArrowLeft" ? group.prev : group.next;
        const button = role ? controller.overlayEl?.querySelector(`[data-role="${role}"]`) : null;
        if (button && !button.disabled) {
            event.preventDefault();
            button.click();
        }
        return;
    }

    if (event.code === "Enter") {
        if (controller.game.state !== "idle") return;
        const root = controller.overlayEl;
        let button = null;
        if (controller._activePanelName === "role") {
            const roleGroup = groups[controller._panelGroupFocus];
            const role = roleGroup?.focus;
            const candidate = role ? root?.querySelector(`[data-role="${role}"]`) : null;
            if (candidate && !candidate.hidden && !candidate.disabled) button = candidate;
        } else {
            const primaryRole = (config.primary ?? []).find((role) => {
                const candidate = root?.querySelector(`[data-role="${role}"]`);
                return candidate && !candidate.hidden && !candidate.disabled;
            });
            button = primaryRole ? root?.querySelector(`[data-role="${primaryRole}"]`) : null;
        }
        if (button) {
            event.preventDefault();
            button.click();
        }
    }
}

export function syncPanelGroupFocus(controller: MultiplayerController) {

    const config = PANEL_KEY_CONFIG[controller._activePanelName];
    const root = controller.overlayEl;
    if (!root) return;

    (config?.groups ?? []).forEach((group, index) => {
        const el = root.querySelector(`[data-role="${group.focus}"]`);
        if (el) el.classList.toggle("difficulty--focused", index === controller._panelGroupFocus);
    });
}

export function showPanel(controller: MultiplayerController, name: string) {

    const panels = controller.panels;
    Object.entries(panels).forEach(([key, el]) => {
        if (el) el.hidden = key !== name;
    });
    controller._activePanelName = name;
    controller._panelGroupFocus = 0;
    controller._updateSteps(name);
    controller._renderConfigPanels();
    controller._syncPanelGroupFocus();
}

export function updateSteps(controller: MultiplayerController, name: string) {

    const info = STEP_BY_PANEL[name];
    const root = controller.overlayEl;
    const steps = root?.querySelector('[data-role="mp-steps"]');
    const caption = root?.querySelector('[data-field="mp-step-caption"]');

    if (!info) {
        if (steps) steps.hidden = true;
        if (caption) caption.hidden = true;
        return;
    }

    if (steps) steps.hidden = false;
    if (caption) caption.hidden = false;

    root?.querySelectorAll('[data-role="mp-step"]').forEach((el) => {
        const step = Number(el.dataset.step);
        el.classList.toggle("mp-step--active", step === info.step);
        el.classList.toggle("mp-step--done", step < info.step);
    });

    if (caption) caption.textContent = controller._t(info.labelKey);
}

export function renderConfigPanels(controller: MultiplayerController) {

    const game = controller.game;
    const root = controller.overlayEl;

    const botModeLabel = root?.querySelector('[data-field="mp-bot-mode-label"]');
    if (botModeLabel) botModeLabel.textContent = controller._t(`modes.${game.mode}.name`);
    const botModeDescription = root?.querySelector('[data-field="mp-bot-mode-description"]');
    if (botModeDescription) botModeDescription.textContent = `💡 ${controller._t(`modes.${game.mode}.description`)}`;

    const diffDefForBot = game.difficulties[game.difficulty];
    const botLevelLabel = root?.querySelector('[data-field="mp-bot-level-label"]');
    if (botLevelLabel) botLevelLabel.textContent = controller._t(`difficulty.${game.difficulty}`);
    const botLevelValue = root?.querySelector('[data-field="mp-bot-level-value"]');
    if (botLevelValue && diffDefForBot) {
        botLevelValue.textContent = controller._t("difficulty.levelPrefix", {level: diffDefForBot.startLevel});
    }

    controller._syncBotDifficultySlider();

    const readyModeLabel = root?.querySelector('[data-field="mp-ready-mode-label"]');
    if (readyModeLabel) readyModeLabel.textContent = controller._t(`modes.${game.mode}.name`);

    const diffDef = game.difficulties[game.difficulty];
    const readyDifficultyLabel = root?.querySelector('[data-field="mp-ready-difficulty-label"]');
    if (readyDifficultyLabel) readyDifficultyLabel.textContent = controller._t(`difficulty.${game.difficulty}`);
    const readyDifficultyLevel = root?.querySelector('[data-field="mp-ready-difficulty-level"]');
    if (readyDifficultyLevel && diffDef) {
        readyDifficultyLevel.textContent = controller._t("difficulty.levelPrefix", {level: diffDef.startLevel});
    }

    const isHost = controller.role === "host";
    root?.querySelectorAll(
        '[data-role="mp-ready-mode-prev"], [data-role="mp-ready-mode-next"], ' +
        '[data-role="mp-ready-difficulty-prev"], [data-role="mp-ready-difficulty-next"]'
    ).forEach((button) => {
        button.disabled = !isHost;
    });

    const hint = root?.querySelector('[data-field="mp-config-hint"]');
    if (hint) hint.textContent = controller._t(isHost ? "multiplayer.configHostHint" : "multiplayer.configGuestHint");
}

export function syncBotDifficultySlider(controller: MultiplayerController) {

    const root = controller.overlayEl;
    const slider = root?.querySelector('[data-role="mp-bot-difficulty-slider"]');
    if (!slider) return;
    const key = BOT_DIFFICULTY_ORDER[Number(slider.value)] ?? "easy";
    slider.setAttribute("aria-valuetext", controller._t(`difficulty.${key}`));
    root.querySelectorAll('[data-role="mp-bot-difficulty-tick"]').forEach((tick) => {
        tick.classList.toggle("bot-difficulty-slider__tick--active", tick.dataset.difficulty === key);
    });
}

export function changeMatchMode(controller: MultiplayerController, dir: number) {

    if (controller.role === "guest") return;
    controller.game.modeController.changeMode(dir);
    controller._renderConfigPanels();
    controller._sendConfigIfHost();
}

export function changeBotLevel(controller: MultiplayerController, dir: number) {

    controller.game.difficultyController.changeDifficulty(dir);
    controller._renderConfigPanels();
}

export function changeMatchDifficulty(controller: MultiplayerController, dir: number) {

    if (controller.role === "guest") return;
    controller.game.difficultyController.changeDifficulty(dir);
    controller._renderConfigPanels();
    controller._sendConfigIfHost();
}

export function sendConfigIfHost(controller: MultiplayerController) {

    if (controller.role !== "host" || !controller.session?.isConnected) return;
    controller._sendToPeer({
        kind: MESSAGE_KIND.CONFIG,
        mode: controller.game.mode,
        difficulty: controller.game.difficulty
    });
}

export function applyRemoteConfig(controller: MultiplayerController, mode: string, difficulty: string) {

    const game = controller.game;
    if (controller.role !== "guest") return;
    if (RUNNING_STATES.has(game.state)) return;

    if (mode && game.gameModes[mode] && mode !== game.mode) {
        if (controller._guestOriginalMode === null) controller._guestOriginalMode = game.mode;
        game.mode = mode;
        game.modeController.reset();
    }

    if (difficulty && game.difficulties[difficulty] && difficulty !== game.difficulty) {
        if (controller._guestOriginalDifficulty === null) controller._guestOriginalDifficulty = game.difficulty;
        game.difficulty = difficulty;
        game.levelTier = difficulty;
        game.level = game.difficulties[difficulty].startLevel;
        game.lines = 0;
    }

    game.hud.update(game.stats);
    controller._renderConfigPanels();
}
