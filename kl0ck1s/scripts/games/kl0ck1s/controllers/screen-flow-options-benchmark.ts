// @ts-nocheck
import type {ScreenFlow} from "./screen-flow.js";

import {copyTextToClipboard} from "../shared/utils.js";

type BenchmarkResult = { key: string; totalMs: number; avgMs: number; opsCount: number; percent: number };
type BenchmarkRun = { results: BenchmarkResult[]; totalMs: number; pieceCount: number };

export class ScreenFlowOptionsBenchmark {
    constructor(public readonly flow: ScreenFlow) {
    }

    private get game() {
        return this.flow.game;
    }

    bind() {
        const game = this.game;
        const button = game.hud.overlayEl?.querySelector<HTMLButtonElement>('[data-role="benchmark-run-button"]');
        const statusEl = game.hud.overlayEl?.querySelector<HTMLElement>('[data-role="benchmark-status"]');
        const resultsEl = game.hud.overlayEl?.querySelector<HTMLElement>('[data-role="benchmark-results"]');
        const copyButton = game.hud.overlayEl?.querySelector<HTMLButtonElement>('[data-role="benchmark-copy-button"]');

        game.benchmarkController.ensurePreviewCanvasSized();

        if (!button) return;

        let lastRun: BenchmarkRun | null = null;

        button.addEventListener("click", async () => {
            if (button.disabled) return;
            button.disabled = true;
            if (resultsEl) resultsEl.hidden = true;
            if (copyButton) copyButton.hidden = true;
            lastRun = null;

            if (statusEl) {
                statusEl.hidden = false;
                statusEl.textContent = game.i18n.t("screens.options.benchmarkRunning", {percent: 0});
            }

            try {
                const {results, totalMs, pieceCount} = await game.benchmarkController.run({
                    pieceCount: 10000,
                    onProgress: (done: number, total: number) => {
                        if (!statusEl) return;
                        const percent = Math.round((done / total) * 100);
                        statusEl.textContent = game.i18n.t("screens.options.benchmarkRunning", {percent});
                    },
                });

                const slowest = results[0];
                const slowestLabel = slowest
                    ? game.i18n.t(`benchmark.categories.${slowest.key}`)
                    : "";

                if (statusEl) {
                    statusEl.textContent = game.i18n.t("screens.options.benchmarkDone", {
                        pieces: pieceCount,
                        ms: Math.round(totalMs),
                        label: slowestLabel,
                        percent: slowest ? Math.round(slowest.percent) : 0,
                    });
                }

                if (resultsEl) {
                    game.screens.renderBenchmarkResults(game.dom, resultsEl, results, game.i18n);
                    resultsEl.hidden = false;
                }

                lastRun = {results, totalMs, pieceCount};
                if (copyButton) copyButton.hidden = false;
            } finally {
                button.disabled = false;
            }
        });

        if (copyButton) {
            const defaultLabel = copyButton.textContent;
            copyButton.addEventListener("click", async () => {
                if (!lastRun || copyButton.disabled) return;

                const text = game.screens.formatBenchmarkResultsText(lastRun.results, game.i18n, lastRun);
                const copied = await copyTextToClipboard(text);

                copyButton.textContent = game.i18n.t(
                    copied ? "screens.options.benchmarkCopied" : "screens.options.benchmarkCopyFailed"
                );
                copyButton.disabled = true;
                setTimeout(() => {
                    copyButton.textContent = defaultLabel;
                    copyButton.disabled = false;
                }, 1500);
            });
        }
    }

}
