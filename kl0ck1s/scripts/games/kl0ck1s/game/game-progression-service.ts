// @ts-nocheck
"use strict";

import type {Game} from "./game.js";
import {dropIntervalForLevel, numberToVoiceKeys, tierForLevel} from "../shared/utils.js";
import {levelForLines} from "./scoring.js";

export class GameProgressionService {
    constructor(private readonly game: Game) {
    }

    initialize(startLevel: number): void {
        const game = this.game;
        game.startLevel = startLevel;
        game.level = startLevel;
        game.levelTier = tierForLevel(startLevel, game.difficulties);
        game.dropInterval = dropIntervalForLevel(startLevel, game.scoring);
    }

    reset(startLevel: number): void {
        this.initialize(startLevel);
    }

    updateForLines(): boolean {
        const game = this.game;
        const mode = game.gameModes[game.mode];
        const newLevel = levelForLines(game.lines, game.startLevel, game.scoring);
        if (mode?.freezeLevel || newLevel === game.level) return false;

        const previousLevel = game.level;
        game.level = newLevel;
        game.dropInterval = dropIntervalForLevel(newLevel, game.scoring);
        game.levelTier = tierForLevel(newLevel, game.difficulties);

        if (game.transitionScore === null) game.transitionScore = game.score;

        game.soundManager.play("levelUp");
        game.soundManager.playSequence(["voiceLevel", ...numberToVoiceKeys(newLevel, game.i18n.lang)]);
        game.levelUpLevel = newLevel;
        game.levelUpTimer = game.levelUpBannerDuration;
        game.events.emit({type: "levelUp", level: newLevel, previousLevel, score: game.score});
        return true;
    }
}
