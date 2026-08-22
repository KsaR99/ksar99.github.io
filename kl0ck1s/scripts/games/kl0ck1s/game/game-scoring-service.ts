// @ts-nocheck
"use strict";

import type {Game} from "./game.js";
import {pointsForLineClear, pointsForSpin} from "./scoring.js";
import {GameProgressionService} from "./game-progression-service.js";

export interface SpinResult {
    type: string;
    mini?: boolean;
}

export class GameScoringService {
    constructor(
        private readonly game: Game,
        private readonly progression: GameProgressionService,
    ) {
    }

    reset(): void {
        const game = this.game;
        game.score = 0;
        game.lines = 0;
        game.elapsedMs = 0;
        game.drought = 0;
        game.maxDrought = 0;
        game.droughtTotal = 0;
        game.droughtCount = 0;
        game.burn = 0;
        game.transitionScore = null;
        game.clearCounts = {1: 0, 2: 0, 3: 0, 4: 0};
        game.piecesSpawned = 0;
        game.spinCounts = {t: 0, tMini: 0, other: 0};
        game.currentCombo = 0;
        game.maxCombo = 0;
        game.cascadeChain = 0;
        game.levelUpTimer = 0;
        game.levelUpLevel = null;
        game.comboBannerTimer = 0;
        game.comboBannerCombo = null;
    }

    addScore(points: number): void {
        if (!points) return;
        const game = this.game;
        game.score += points;
        game.events.emit({type: "scoreChanged", points, total: game.score});
    }

    registerPieceSpawn(type: string): void {
        const game = this.game;
        if (type === "I") {
            if (game.drought > 0) {
                game.droughtTotal += game.drought;
                ++game.droughtCount;
            }
            game.drought = 0;
        } else {
            ++game.drought;
            game.maxDrought = Math.max(game.maxDrought, game.drought);
        }
    }

    registerLineClears(cleared: number, playSound = true): void {
        if (cleared <= 0) return;
        const game = this.game;
        game.clearCounts[cleared] = (game.clearCounts[cleared] ?? 0) + 1;
        game.burn = cleared === 4 ? 0 : game.burn + cleared;
        if (playSound) game.soundManager.play(`lineClear${Math.min(cleared, 4)}`);

        game.lines += cleared;
        this.addScore(pointsForLineClear(cleared, game.level, game.scoring));
        this.progression.updateForLines();
        game.events.emit({type: "lineClear", lines: cleared, totalLines: game.lines, score: game.score});
    }

    registerSpin(spin: SpinResult, cleared: number): void {
        const game = this.game;
        const mini = spin.mini === true;
        if (spin.type === "T") {
            if (mini) ++game.spinCounts.tMini;
            else ++game.spinCounts.t;
        } else {
            ++game.spinCounts.other;
        }
        const points = pointsForSpin(spin.type, cleared, game.level, mini);
        this.addScore(points);
        game.events.emit({type: "spin", pieceType: spin.type, cleared, mini, points});
    }

    registerSoftDrop(): void {
        this.addScore(this.game.scoring.SOFT_DROP_POINT);
    }

    registerHardDrop(cellsDropped: number): void {
        this.addScore(cellsDropped * this.game.scoring.HARD_DROP_POINT);
    }
}
