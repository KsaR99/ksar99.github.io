"use strict";

import {APP_NAME} from "../game/game-constants.js";
import {formatDuration, formatDurationPrecise, formatNumber} from "../shared/utils.js";

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

// The brand wordmark's rainbow gradient (kept in sync with .brand__title in main.css).
const LOGO_STOPS_OKLCH = [
    "oklch(0.905399 0.15455 194.76)",
    "oklch(0.5635 0.2408 260.82)",
    "oklch(0.772 0.1738 64.55)",
    "oklch(0.968 0.211 109.77)",
    "oklch(0.73558 0.22389 146.13)",
    "oklch(0.5812 0.2986 307.03)",
    "oklch(0.6489 0.237 26.97)",
];
// Hex approximations, used only if the canvas can't parse oklch() colors.
const LOGO_STOPS_HEX = [
    "#8fe0e6",
    "#5a6fe0",
    "#e0a355",
    "#f5f36a",
    "#4fd67a",
    "#a53de0",
    "#e0524a"
];

// Hex fallbacks for the theme colors below, used only if the current
// theme leaves a variable undefined or the canvas can't parse oklch().
const THEME_COLOR_FALLBACKS = {
    "--panel": "#10151c",
    "--bg-2": "#1a2028",
    "--line": "rgba(255, 255, 255, 0.08)",
    "--text": "#ffffff",
    "--muted": "rgba(255, 255, 255, 0.55)",
    "--accent-2": "#4fd67a",
};

let oklchSupportCache = null;

function canvasSupportsOklch(dom) {
    if (oklchSupportCache !== null) return oklchSupportCache;
    try {
        const probe = dom.createElement("canvas").getContext("2d");
        probe.fillStyle = "#000000";
        probe.fillStyle = LOGO_STOPS_OKLCH[0];
        oklchSupportCache = probe.fillStyle !== "#000000";
    } catch {
        oklchSupportCache = false;
    }
    return oklchSupportCache;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Converts a CSS linear-gradient() angle (0deg = "to top", clockwise) into
// the two endpoints Canvas's createLinearGradient needs, for a box at
// (x, y, w, h) - so the canvas gradient matches the CSS one it's mirroring.
function angleGradientPoints(angleDeg, x, y, w, h) {
    const rad = (angleDeg * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const length = Math.abs(w * dx) + Math.abs(h * dy);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const half = length / 2;
    return {
        x1: cx - half * dx,
        y1: cy - half * dy,
        x2: cx + half * dx,
        y2: cy + half * dy,
    };
}

export class ShareService {
    constructor(game) {
        this.game = game;
    }

    get dom() {
        return this.game.dom ?? globalThis.document;
    }

    // Reads a color from the active theme's CSS custom properties (set on
    // <body data-theme="...">) so the card matches whatever the player has
    // selected, instead of a fixed palette baked into this file.
    _themeColor(name) {
        const dom = this.dom;
        const fallback = THEME_COLOR_FALLBACKS[name] ?? "#ffffff";
        try {
            const win = dom.defaultView ?? globalThis;
            const target = dom.body ?? dom.documentElement;
            const raw = win.getComputedStyle(target).getPropertyValue(name).trim();
            if (!raw) return fallback;
            if (raw.startsWith("oklch") && !canvasSupportsOklch(dom)) return fallback;
            return raw;
        } catch {
            return fallback;
        }
    }

    _formatCardDate(iso) {
        const date = new Date(iso);
        const locale = this.game.i18n?.locale || "en-US";
        return date.toLocaleString(locale, {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    async shareRun() {
        const game = this.game;
        const stats = game.stats;
        const modeLabel = game.i18n.t(`modes.${stats.mode}.name`);
        const name = game.playerName || game.i18n.t("leaderboard.defaultName");

        const canvas = await this._buildCard({
            modeLabel,
            score: stats.score,
            level: stats.level,
            lines: stats.lines,
            time: stats.gameTime,
            date: this._formatCardDate(new Date().toISOString()),
            name,
        });

        return this._dispatch(canvas, {
            text: this._shareText(modeLabel, stats.score, name),
            filename: "kl0ck1s-wynik.png",
        });
    }

    async shareLeaderboard(mode) {
        const game = this.game;
        const entries = game.leaderboard.forMode(mode);
        if (entries.length === 0) return {status: "empty"};

        const modeLabel = game.i18n.t(`modes.${mode}.name`);
        const isRace = game.leaderboard.isTimedRaceMode(mode);
        const defaultName = game.i18n.t("leaderboard.defaultName");

        const rows = entries.map((entry) => ({
            name: entry.name || defaultName,
            score: formatNumber(entry.score),
            level: entry.level,
            lines: entry.lines,
            time: Number.isFinite(entry.timeMs)
                ? (isRace ? formatDurationPrecise(entry.timeMs) : formatDuration(entry.timeMs))
                : "—",
            date: this._formatCardDate(entry.date),
        }));

        const canvas = await this._buildTableCard({modeLabel, rows});

        return this._dispatch(canvas, {
            text: this._tableShareText(modeLabel),
            filename: "kl0ck1s-tabela-wynikow.png",
        });
    }

    bindIconButton(button, action) {
        if (!button) return;
        const idleLabel = button.textContent;
        button.addEventListener("click", async () => {
            if (button.disabled) return;
            button.disabled = true;
            let icon = "✕";
            try {
                const {status} = await action();
                icon = this._statusIcon(status);
            } catch {
                icon = "✕";
            } finally {
                button.textContent = icon;
                setTimeout(() => {
                    button.textContent = idleLabel;
                    button.disabled = false;
                }, 1600);
            }
        });
    }

    bindLabeledButton(button, action) {
        if (!button) return;
        const i18n = this.game.i18n;
        const idleLabel = button.textContent;
        button.addEventListener("click", async () => {
            if (button.disabled) return;
            button.disabled = true;
            let label = i18n.t("share.status.error");
            try {
                const {status} = await action();
                label = status === "cancelled" ? idleLabel : i18n.t(`share.status.${status}`);
            } catch {
                label = i18n.t("share.status.error");
            } finally {
                button.textContent = label;
                setTimeout(() => {
                    button.textContent = idleLabel;
                    button.disabled = false;
                }, 1800);
            }
        });
    }

    async _buildCard({modeLabel, score, level, lines, time, date, name}) {
        const dom = this.dom;
        if (dom.fonts?.ready) {
            try {
                await dom.fonts.ready;
            } catch {
                // keep going with whatever fonts happen to be ready
            }
        }

        const panel = this._themeColor("--panel");
        const bg2 = this._themeColor("--bg-2");
        const line = this._themeColor("--line");
        const text = this._themeColor("--text");
        const muted = this._themeColor("--muted");
        const accent2 = this._themeColor("--accent-2");

        const canvas = dom.createElement("canvas");
        canvas.width = CARD_WIDTH;
        canvas.height = CARD_HEIGHT;
        const ctx = canvas.getContext("2d");

        const bg = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
        bg.addColorStop(0, panel);
        bg.addColorStop(1, bg2);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

        const glow = ctx.createRadialGradient(
            CARD_WIDTH * 0.88, CARD_HEIGHT * 0.12, 0,
            CARD_WIDTH * 0.88, CARD_HEIGHT * 0.12, 560,
        );
        glow.addColorStop(0, accent2);
        glow.addColorStop(1, "transparent");
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        ctx.restore();

        ctx.strokeStyle = line;
        ctx.lineWidth = 2;
        roundRect(ctx, 12, 12, CARD_WIDTH - 24, CARD_HEIGHT - 24, 28);
        ctx.stroke();

        this._drawLogo(ctx, CARD_WIDTH / 2, 118);

        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";

        if (name) {
            ctx.fillStyle = accent2;
            ctx.font = "700 34px 'Inter', sans-serif";
            ctx.fillText(name, CARD_WIDTH / 2, 178);
        }

        ctx.fillStyle = muted;
        ctx.font = "600 28px 'Inter', sans-serif";
        ctx.fillText(modeLabel.toUpperCase(), CARD_WIDTH / 2, 218);

        ctx.fillStyle = text;
        ctx.font = "800 132px 'Noto Sans Mono', monospace";
        ctx.fillText(String(score), CARD_WIDTH / 2, 366);

        const chips = [
            {label: "LVL", value: String(level)},
            {label: "LINII", value: String(lines)},
            {label: "CZAS", value: time},
        ];
        this._drawChips(ctx, chips, CARD_WIDTH / 2, 426, {panel, line, muted, text});

        ctx.textAlign = "center";
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = muted;
        ctx.font = "500 20px 'Inter', sans-serif";
        ctx.fillText(`${date} • ksar99.github.io/kl0ck1s/`, CARD_WIDTH / 2, CARD_HEIGHT - 46);
        ctx.globalAlpha = 1;

        return canvas;
    }

    _drawLogo(ctx, centerX, y) {
        const text = APP_NAME;
        const fontSize = 58;
        ctx.font = `800 ${fontSize}px 'Noto Sans Mono', monospace`;
        ctx.textAlign = "center";
        const width = ctx.measureText(text).width;

        // Mirror .brand__title's `linear-gradient(350deg, ...)` over the
        // wordmark's own box, so the logo reads the same as it does in-game.
        const boxX = centerX - width / 2;
        const boxY = y - fontSize * 0.9;
        const boxH = fontSize * 1.15;
        const {x1, y1, x2, y2} = angleGradientPoints(350, boxX, boxY, width, boxH);

        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        const stops = canvasSupportsOklch(this.dom) ? LOGO_STOPS_OKLCH : LOGO_STOPS_HEX;
        stops.forEach((color, i) => gradient.addColorStop(i / (stops.length - 1), color));

        ctx.fillStyle = gradient;
        ctx.fillText(text, centerX, y);
    }

    _drawChips(ctx, chips, centerX, y, {panel, line, muted, text}) {
        const height = 96;
        const gap = 18;

        const widths = chips.map((chip) => {
            ctx.font = "700 34px 'Noto Sans Mono', monospace";
            const valueWidth = ctx.measureText(chip.value).width;
            ctx.font = "700 20px 'Inter', sans-serif";
            const labelWidth = ctx.measureText(chip.label).width;
            return Math.max(valueWidth, labelWidth) + 48;
        });
        const totalWidth = widths.reduce((sum, w) => sum + w, 0) + gap * (chips.length - 1);

        ctx.textAlign = "left";
        let x = centerX - totalWidth / 2;

        chips.forEach((chip, i) => {
            const width = widths[i];

            ctx.fillStyle = panel;
            roundRect(ctx, x, y, width, height, 16);
            ctx.fill();
            ctx.strokeStyle = line;
            ctx.lineWidth = 1;
            roundRect(ctx, x, y, width, height, 16);
            ctx.stroke();

            ctx.fillStyle = muted;
            ctx.font = "700 20px 'Inter', sans-serif";
            ctx.fillText(chip.label, x + 24, y + 34);

            ctx.fillStyle = text;
            ctx.font = "700 34px 'Noto Sans Mono', monospace";
            ctx.fillText(chip.value, x + 24, y + 76);

            x += width + gap;
        });
    }

    async _buildTableCard({modeLabel, rows}) {
        const dom = this.dom;
        if (dom.fonts?.ready) {
            try {
                await dom.fonts.ready;
            } catch {
                // keep going with whatever fonts happen to be ready
            }
        }

        const panel = this._themeColor("--panel");
        const bg2 = this._themeColor("--bg-2");
        const line = this._themeColor("--line");
        const text = this._themeColor("--text");
        const muted = this._themeColor("--muted");
        const accent2 = this._themeColor("--accent-2");
        const i18n = this.game.i18n;

        const rowHeight = 54;
        const headerRowHeight = 40;
        const tableTop = 200;
        const tableGap = 10;
        const rowsTop = tableTop + headerRowHeight + tableGap;
        const tableBottom = rowsTop + rows.length * rowHeight;
        const footerY = tableBottom + 50;
        const cardHeight = footerY + 30;

        const canvas = dom.createElement("canvas");
        canvas.width = CARD_WIDTH;
        canvas.height = cardHeight;
        const ctx = canvas.getContext("2d");

        const bg = ctx.createLinearGradient(0, 0, CARD_WIDTH, cardHeight);
        bg.addColorStop(0, panel);
        bg.addColorStop(1, bg2);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, CARD_WIDTH, cardHeight);

        const glow = ctx.createRadialGradient(
            CARD_WIDTH * 0.88, 90, 0,
            CARD_WIDTH * 0.88, 90, 480,
        );
        glow.addColorStop(0, accent2);
        glow.addColorStop(1, "transparent");
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, CARD_WIDTH, cardHeight);
        ctx.restore();

        ctx.strokeStyle = line;
        ctx.lineWidth = 2;
        roundRect(ctx, 12, 12, CARD_WIDTH - 24, cardHeight - 24, 28);
        ctx.stroke();

        this._drawLogo(ctx, CARD_WIDTH / 2, 86);

        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = accent2;
        ctx.font = "700 26px 'Inter', sans-serif";
        ctx.fillText(i18n.t("leaderboard.title").toUpperCase(), CARD_WIDTH / 2, 130);

        ctx.fillStyle = muted;
        ctx.font = "600 22px 'Inter', sans-serif";
        ctx.fillText(modeLabel.toUpperCase(), CARD_WIDTH / 2, 160);

        const tableX = 70;
        const tableWidth = CARD_WIDTH - tableX * 2;
        const colGap = 16;
        const colRankW = 50;
        const colScoreW = 200;
        const colDateW = 170;
        const colTimeW = 110;
        const colStatW = 70;
        const colScoreX = tableX + tableWidth - colScoreW;
        const colDateX = colScoreX - colDateW - colGap;
        const colTimeX = colDateX - colTimeW - colGap;
        const colLinesX = colTimeX - colStatW - colGap;
        const colLevelX = colLinesX - colStatW - colGap;
        const colNameX = tableX + colRankW + colGap;
        const nameWidth = colLevelX - colNameX - colGap;

        ctx.font = "700 15px 'Inter', sans-serif";
        ctx.fillStyle = muted;
        ctx.textAlign = "left";
        ctx.fillText(i18n.t("leaderboard.headers.name").toUpperCase(), colNameX, tableTop + 20);
        ctx.textAlign = "center";
        ctx.fillText(i18n.t("leaderboard.headers.level").toUpperCase(), colLevelX + colStatW / 2, tableTop + 20);
        ctx.fillText(i18n.t("leaderboard.headers.lines").toUpperCase(), colLinesX + colStatW / 2, tableTop + 20);
        ctx.fillText(i18n.t("leaderboard.headers.time").toUpperCase(), colTimeX + colTimeW / 2, tableTop + 20);
        ctx.fillText(i18n.t("leaderboard.headers.date").toUpperCase(), colDateX + colDateW / 2, tableTop + 20);
        ctx.textAlign = "right";
        ctx.fillText(i18n.t("leaderboard.headers.score").toUpperCase(), colScoreX + colScoreW, tableTop + 20);

        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tableX, rowsTop - tableGap / 2);
        ctx.lineTo(tableX + tableWidth, rowsTop - tableGap / 2);
        ctx.stroke();

        const podium = ["🥇", "🥈", "🥉"];

        rows.forEach((row, i) => {
            const y = rowsTop + i * rowHeight;
            const midY = y + rowHeight / 2 + 7;

            if (i % 2 === 1) {
                ctx.fillStyle = line;
                ctx.save();
                ctx.globalAlpha = 0.18;
                ctx.fillRect(tableX, y, tableWidth, rowHeight);
                ctx.restore();
            }

            ctx.textAlign = "center";
            ctx.font = i < 3 ? "24px sans-serif" : "700 20px 'Noto Sans Mono', monospace";
            ctx.fillStyle = i < 3 ? text : muted;
            ctx.fillText(i < 3 ? podium[i] : String(i + 1), tableX + colRankW / 2, midY);

            ctx.textAlign = "left";
            ctx.font = "700 20px 'Inter', sans-serif";
            ctx.fillStyle = text;
            ctx.fillText(this._fitText(ctx, row.name, nameWidth), colNameX, midY);

            ctx.textAlign = "center";
            ctx.font = "600 18px 'Noto Sans Mono', monospace";
            ctx.fillStyle = muted;
            ctx.fillText(String(row.level), colLevelX + colStatW / 2, midY);
            ctx.fillText(String(row.lines), colLinesX + colStatW / 2, midY);
            ctx.fillText(row.time, colTimeX + colTimeW / 2, midY);
            ctx.font = "500 16px 'Inter', sans-serif";
            ctx.fillText(row.date, colDateX + colDateW / 2, midY);

            ctx.textAlign = "right";
            ctx.font = "800 26px 'Noto Sans Mono', monospace";
            ctx.fillStyle = accent2;
            ctx.fillText(row.score, colScoreX + colScoreW, midY);
        });

        ctx.textAlign = "center";
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = muted;
        ctx.font = "500 20px 'Inter', sans-serif";
        ctx.fillText("ksar99.github.io/kl0ck1s/", CARD_WIDTH / 2, footerY);
        ctx.globalAlpha = 1;

        return canvas;
    }

    _fitText(ctx, text, maxWidth) {
        if (ctx.measureText(text).width <= maxWidth) return text;
        let truncated = text;
        while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
            truncated = truncated.slice(0, -1);
        }
        return `${truncated}…`;
    }

    _shareText(modeLabel, score, name = null) {
        const i18n = this.game.i18n;
        return name
            ? i18n.t("share.textByName", {app: APP_NAME, name, mode: modeLabel, score})
            : i18n.t("share.text", {app: APP_NAME, mode: modeLabel, score});
    }

    _tableShareText(modeLabel) {
        return this.game.i18n.t("share.tableText", {app: APP_NAME, mode: modeLabel});
    }

    _statusIcon(status) {
        if (status === "shared" || status === "downloaded") return "✓";
        if (status === "copied") return "📋";
        if (status === "empty") return "…";
        if (status === "cancelled") return "📤";
        return "✕";
    }

    async _dispatch(canvas, {text, filename}) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) return {status: "error"};

        const nav = globalThis.navigator;

        if (nav?.share) {
            try {
                const file = new File([blob], filename, {type: "image/png"});
                const shareData = {files: [file], text, title: APP_NAME};
                if (!nav.canShare || nav.canShare(shareData)) {
                    await nav.share(shareData);
                    return {status: "shared"};
                }
            } catch (err) {
                if (err?.name === "AbortError") return {status: "cancelled"};
                // fall through to the next strategy
            }
        }

        if (nav?.clipboard?.write && globalThis.ClipboardItem) {
            try {
                await nav.clipboard.write([new ClipboardItem({"image/png": blob})]);
                return {status: "copied"};
            } catch {
                // fall through to download
            }
        }

        this._download(blob, filename);
        return {status: "downloaded"};
    }

    _download(blob, filename) {
        const dom = this.dom;
        const url = URL.createObjectURL(blob);
        const link = dom.createElement("a");
        link.href = url;
        link.download = filename;
        dom.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
}
