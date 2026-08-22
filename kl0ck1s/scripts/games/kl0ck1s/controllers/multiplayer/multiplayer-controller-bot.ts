// @ts-nocheck
import {BOT_DIFFICULTIES, BotOpponent} from "../../ai/bot-opponent.js";
import {PieceBag} from "../../game/piece-bag.js";
import {mulberry32, randomSeed} from "../../../../engine/random/seeded-random.js";
import {BOARD_CONFIG, KLOCKOMINO_TYPES} from "../../shared/config.js";
import {COUNTDOWN_STEPS} from "../../game/game-constants.js";


import type {MultiplayerController} from "../multiplayer-controller.js";
import {RUNNING_STATES} from "./multiplayer-controller-constants.js";

"use strict";

export function beginBot(controller: MultiplayerController, difficultyKey: string) {

    if (!BOT_DIFFICULTIES[difficultyKey]) return;
    controller._clearError();
    controller._resetSession();
    controller.role = "bot";
    controller._botDifficultyKey = difficultyKey;

    controller.game.modeController.resolveRandomMode();

    const seed = randomSeed();

    controller.game.bag = new PieceBag(KLOCKOMINO_TYPES, mulberry32(seed));
    controller.botOpponent = new BotOpponent({
        types: KLOCKOMINO_TYPES,
        cols: BOARD_CONFIG.COLS,
        rows: BOARD_CONFIG.ROWS,
        seed,
        difficultyKey,
        startLevel: controller.game.level,
        mode: controller.game.mode,
        modeDef: controller.game.gameModes[controller.game.mode],
    });
    controller.botOpponent.addEventListener("message", (event) => controller._onPeerMessage(event.detail));
    controller._remoteName = controller._t("multiplayer.botName", {difficulty: controller._t(`difficulty.${difficultyKey}`)});
    controller.game.multiplayerConnected = true;
    controller.game.multiplayerVsBot = true;

    controller._launchMatch();
    controller._botStartDeadline = Date.now() + 8000;
    controller._startBotWhenRunning();
}

export function startBotWhenRunning(controller: MultiplayerController) {

    clearTimeout(controller._botStartTimer);
    controller._botStartTimer = null;

    const bot = controller.botOpponent;
    if (!bot) return;

    const state = controller.game.state;
    if (state === "countdown") {
        const remaining = Math.max(0,
            (COUNTDOWN_STEPS.length - controller.game.countdownIndex) * controller.game.countdownStepDuration -
            controller.game.countdownTimer
        );
        bot.start(remaining);
        return;
    }

    if (state === "running") {
        bot.start();
        return;
    }

    if (!RUNNING_STATES.has(state) && Date.now() > controller._botStartDeadline) return;

    controller._botStartTimer = setTimeout(() => controller._startBotWhenRunning(), 50);
}

export function teardownBotMode(controller: MultiplayerController) {

    if (!controller.botOpponent && controller.role !== "bot") return;
    clearTimeout(controller._botStartTimer);
    controller._botStartTimer = null;
    controller.botOpponent?.stop();
    controller.botOpponent = null;
    controller.game.bag = controller._defaultBag;
    controller.role = null;
}
