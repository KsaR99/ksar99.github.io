"use strict";

import {
    dropIntervalForLevel,
    formatDuration,
    formatDurationPrecise,
    formatNumber,
    tierForLevel
} from "../shared/utils.js";
import {levelForLines, pointsForLineClear, pointsForSpin} from "../game/scoring.js";

export class StatsTracker {
    constructor(game) {
        this.game = game;
    }

    get stats() {
        const game = this.game;
        const linesPerLevel = game.scoring.LINES_PER_LEVEL;
        const progressPercent = linesPerLevel
            ? Math.floor(((game.lines % linesPerLevel) / linesPerLevel) * 100)
            : 0;

        const totalClears = Object.values(game.clearCounts).reduce((sum, n) => sum + n, 0);
        const tetrisRatePercent = totalClears ? (game.clearCounts[4] / totalClears) * 100 : 0;

        const elapsedSeconds = game.elapsedMs / 1000;
        const pps = elapsedSeconds > 0 ? game.piecesSpawned / elapsedSeconds : 0;
        const efficiencyValue = game.lines > 0 ? game.score / game.lines : 0;
        const droughtAvgValue = game.droughtCount > 0 ? game.droughtTotal / game.droughtCount : 0;

        const isTimedRaceMode = game.mode === "sprint" || game.mode === "cheeseRace";
        const bestEntry = game.leaderboard.bestEntry(game.mode);
        const bestDisplay = isTimedRaceMode
            ? (bestEntry ? formatDurationPrecise(bestEntry.timeMs) : "—")
            : formatNumber(bestEntry ? bestEntry.score : 0);

        return {
            score: formatNumber(game.score),
            level: game.level,
            lines: game.lines,
            best: bestDisplay,
            mode: game.mode,
            objective: game.modeController.objectiveText() !== null
                ? `${game.i18n.t("sidebar.objective")}: ${game.modeController.objectiveText()}`
                : null,
            objectivePercent: game.modeController.objectivePercent(),
            objectiveUrgency: game.modeController.objectiveUrgency(),
            objectiveColorMode: game.modeController.objectiveColorMode(),
            difficulty: `${game.i18n.t(`difficulty.${game.levelTier}`)} ${game.level}`,
            difficultyPercent: progressPercent,
            gameTime: isTimedRaceMode ? formatDurationPrecise(game.elapsedMs) : formatDuration(game.elapsedMs),
            drought: game.drought,
            maxDrought: game.maxDrought,
            droughtTotal: game.droughtTotal,
            droughtAvg: droughtAvgValue.toFixed(1),
            burn: game.burn,
            transitionScore: game.transitionScore !== null ? formatNumber(game.transitionScore) : "—",
            tetrisRate: `${tetrisRatePercent.toFixed(1)}%`,
            singles: game.clearCounts[1],
            doubles: game.clearCounts[2],
            triples: game.clearCounts[3],
            tetrises: game.clearCounts[4],
            pps: pps.toFixed(2),
            tSpins: game.spinCounts.t,
            tSpinMinis: game.spinCounts.tMini,
            otherSpins: game.spinCounts.other,
            maxCombo: game.maxCombo,
            efficiency: formatNumber(Math.round(efficiencyValue)),
        };
    }

    reset() {
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
        game.levelUpTimer = 0;
        game.levelUpLevel = null;
    }

    registerPieceSpawn(type) {
        const game = this.game;
        ++game.piecesSpawned;

        if (type === "I") {
            if (game.drought > 0) {
                game.droughtTotal += game.drought;
                ++game.droughtCount;
            }
            game.drought = 0;
            return;
        }

        ++game.drought;
        game.maxDrought = Math.max(game.maxDrought, game.drought);
    }

    addScore(points) {
        const game = this.game;
        game.score += points;
        game.hud.update(game.stats);
    }

    registerLineClears(cleared, playSound = true) {
        const game = this.game;
        if (cleared === 0) return;

        game.clearCounts[cleared] = (game.clearCounts[cleared] ?? 0) + 1;
        game.burn = cleared === 4 ? 0 : game.burn + cleared;

        if (playSound) game.soundManager.play(`lineClear${Math.min(cleared, 4)}`);

        game.lines += cleared;
        this.addScore(pointsForLineClear(cleared, game.level, game.scoring));

        const newLevel = levelForLines(game.lines, game.startLevel, game.scoring);
        if (newLevel !== game.level) {
            game.level = newLevel;
            game.dropInterval = dropIntervalForLevel(game.level, game.scoring);
            game.levelTier = tierForLevel(game.level, game.difficulties);

            if (game.transitionScore === null) {
                game.transitionScore = game.score;
            }

            game.soundManager.play("levelUp");
            game.levelUpLevel = game.level;
            game.levelUpTimer = game.levelUpBannerDuration;
        }

        game.hud.update(game.stats);
    }

    registerSpin(spin, cleared) {
        const game = this.game;
        if (spin.type === "T") {
            if (spin.mini) ++game.spinCounts.tMini;
            else ++game.spinCounts.t;
        } else {
            ++game.spinCounts.other;
        }
        this.addScore(pointsForSpin(spin.type, cleared, game.level, spin.mini));
    }
}
