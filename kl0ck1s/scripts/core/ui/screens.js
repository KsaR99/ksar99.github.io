"use strict";

import {formatNumber} from "../shared/utils.js";
import {DEV_MODE, SOUND_FILES, VOICE_COUNTING_NUMBERS, voiceCountingKey} from "../shared/config.js";
import {defaultKeyBindings, formatKeyCode, KEY_BIND_SLOTS} from "../shared/key-bindings.js";

const VOICE_COUNTING_KEYS = new Set(VOICE_COUNTING_NUMBERS.map(voiceCountingKey));

function setMuteToggleState(button, muted, i18n, effectiveMuted = muted) {
    if (!button) return;
    button.setAttribute("aria-pressed", String(muted));
    button.setAttribute("aria-label", i18n.t(muted ? "screens.options.unmute" : "screens.options.mute"));
    const icon = button.querySelector("[data-role$=\"mute-toggle-icon\"]");
    if (icon) icon.textContent = effectiveMuted ? "🔇" : "🔊";
}

function clone(dom, templateId) {
    return dom.getElementById(templateId).content.cloneNode(true);
}

function fillDifficultyCarousel(container, selectedDifficulty, difficulties, i18n) {
    if (!container) return;
    const def = difficulties[selectedDifficulty];
    container.querySelector('[data-field="difficultyLabel"]').textContent = i18n.t(`difficulty.${selectedDifficulty}`);
    container.querySelector('[data-field="difficultyLevel"]').textContent = i18n.t("difficulty.levelPrefix", {level: def.startLevel});
}

function fillModeCarousel(container, selectedMode, i18n) {
    if (!container) return;
    container.querySelector('[data-field="modeLabel"]').textContent = i18n.t(`modes.${selectedMode}.name`);
}

function fillModeDescription(container, selectedMode, i18n) {
    if (!container) return;
    container.textContent = `💡 ${i18n.t(`modes.${selectedMode}.description`)}`;
}

function fillProfileSelect(dom, select, profiles, current, i18n, trash = []) {
    if (!select) return;
    select.innerHTML = "";

    const names = [...profiles];
    if (current && !names.includes(current)) names.unshift(current);

    names.forEach((name) => {
        const option = dom.createElement("option");
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });

    const newOption = dom.createElement("option");
    newOption.value = "";
    newOption.textContent = i18n.t("screens.idle.newProfileOption");
    select.appendChild(newOption);

    if (trash.length) {
        const group = dom.createElement("optgroup");
        group.label = i18n.t("screens.idle.restoreProfileGroup");
        trash.forEach((entry) => {
            const option = dom.createElement("option");
            option.value = `restore:${entry.name}`;
            option.textContent = entry.name;
            group.appendChild(option);
        });
        select.appendChild(group);
    }

    select.value = current && names.includes(current) ? current : "";
}

function fillSoundRows(dom, container, keys, soundVolumes, soundMuted, i18n) {
    keys.forEach((key) => {
        const row = clone(dom, "tpl-options-sound-row").querySelector('[data-role="sound-row"]');
        const label = SOUND_FILES[key]?.label ?? i18n.t(`sounds.${key}`);
        row.querySelector('[data-field="name"]').textContent = label;

        const isMuted = Boolean(soundMuted[key]);
        const volume = soundVolumes[key] ?? 1;

        const slider = row.querySelector('[data-role="sound-volume-slider"]');
        slider.dataset.soundKey = key;
        slider.value = Math.round(volume * 100);
        slider.disabled = isMuted;

        const muteToggle = row.querySelector('[data-role="sound-mute-toggle"]');
        muteToggle.dataset.soundKey = key;
        setMuteToggleState(muteToggle, isMuted, i18n, isMuted || volume === 0);

        const previewButton = row.querySelector('[data-role="sound-preview-button"]');
        previewButton.dataset.soundKey = key;
        previewButton.setAttribute("aria-label", i18n.t("screens.options.preview"));

        container.appendChild(row);
    });
}

function groupedKeyBindSlots() {
    const groups = [];
    const byLabel = new Map();
    KEY_BIND_SLOTS.forEach((slot) => {
        let group = byLabel.get(slot.labelKey);
        if (!group) {
            group = {labelKey: slot.labelKey, slots: []};
            byLabel.set(slot.labelKey, group);
            groups.push(group);
        }
        group.slots.push(slot);
    });
    return groups;
}

function renderKeybindRows(dom, container, keyBindings, i18n) {
    container.innerHTML = "";
    const bindings = keyBindings ?? {};

    groupedKeyBindSlots().forEach((group) => {
        const row = dom.createElement("li");
        row.className = "controls__item";

        const label = dom.createElement("span");
        label.textContent = i18n.t(group.labelKey);
        row.appendChild(label);

        const kbdWrap = dom.createElement("span");
        group.slots.forEach((slot, index) => {
            if (index > 0) kbdWrap.appendChild(dom.createTextNode("\u00A0"));
            const kbd = dom.createElement("kbd");
            kbd.className = "kbd kbd--clickable kbd--rebind";
            kbd.dataset.keybindSlot = slot.id;
            kbd.setAttribute("role", "button");
            kbd.tabIndex = 0;
            const code = slot.id in bindings ? bindings[slot.id] : slot.defaultCode;
            kbd.textContent = formatKeyCode(code);
            kbdWrap.appendChild(kbd);
        });
        row.appendChild(kbdWrap);

        container.appendChild(row);
    });
}

const DIFF_LABEL_KEYS = {
    language: "screens.options.language",
    volume: "screens.options.volume",
    muted: "screens.options.mute",
    hudRight: "screens.options.hudRight",
    theme: "screens.options.theme",
    mouseControl: "screens.options.mouseControl",
    mouseSensitivity: "screens.options.mouseSensitivity",
    touchSensitivity: "screens.options.touchSensitivity",
    skipCountdown: "screens.options.skipCountdown",
    skipModeInfo: "screens.options.skipModeInfo",
    ghost: "screens.options.ghost",
    gridLines: "screens.options.gridLines",
    screenShake: "screens.options.screenShake",
    heightSaturation: "screens.options.heightSaturation",
    glow: "screens.options.glow",
    transparency: "screens.options.transparency",
    fallTrail: "screens.options.fallTrail",
    keyboardDAS: "screens.options.keyboardDas",
    keyboardARR: "screens.options.keyboardArr",
    categoryVolumes: "screens.options.categoryVolume",
    categoryMuted: "screens.options.mute",
    soundVolumes: "screens.options.soundVolumesLabel",
    keyBindings: "screens.options.keyboardTitle",
};

const BENCHMARK_LABEL_KEYS = {
    pieceGeneration: "benchmark.categories.pieceGeneration",
    movement: "benchmark.categories.movement",
    rotation: "benchmark.categories.rotation",
    dropOffset: "benchmark.categories.dropOffset",
    lockPiece: "benchmark.categories.lockPiece",
    lineClearDetect: "benchmark.categories.lineClearDetect",
    lineClearApply: "benchmark.categories.lineClearApply",
    scoring: "benchmark.categories.scoring",
    renderBackgroundRebuild: "benchmark.categories.renderBackgroundRebuild",
    renderBlit: "benchmark.categories.renderBlit",
    renderDrawPiece: "benchmark.categories.renderDrawPiece",
    renderDrawGhost: "benchmark.categories.renderDrawGhost",
    audioPlay: "benchmark.categories.audioPlay",
    audioStop: "benchmark.categories.audioStop",
};

const THEME_LABEL_KEYS = {
    none: "screens.options.themeNone",
    vhs: "screens.options.themeVHS",
    matrix: "screens.options.themeMatrix",
    rain: "screens.options.themeRain",
    snow: "screens.options.themeSnow",
};

function formatSettingValue(key, value, i18n) {
    if (key === "language") return i18n.languages[value] ?? value;
    if (key === "theme") return i18n.t(THEME_LABEL_KEYS[value] ?? "screens.options.themeNone");
    if (key === "touchSensitivity") return (value ?? 1) === 1 ? i18n.t("screens.options.autoValue") : `${Math.round(value * 100)}%`;
    if (key === "volume" || key === "mouseSensitivity") return `${Math.round(value * 100)}%`;
    if (key === "keyboardDAS" || key === "keyboardARR") return `${Math.round(value)} ms`;
    if (typeof value === "boolean") return i18n.t(value ? "screens.options.valueOn" : "screens.options.valueOff");
    if (key === "categoryVolumes" || key === "soundVolumes") {
        return Object.entries(value ?? {}).map(([k, v]) => `${k}: ${Math.round(v * 100)}%`).join(", ") || "—";
    }
    if (key === "categoryMuted") {
        return Object.entries(value ?? {})
            .map(([k, v]) => `${k}: ${i18n.t(v ? "screens.options.valueOn" : "screens.options.valueOff")}`)
            .join(", ") || "—";
    }
    if (key === "keyBindings") {
        const defaults = defaultKeyBindings();
        return Object.entries(value ?? {})
            .map(([k, v]) => `${k}: ${formatKeyCode(v)}`)
            .join(", ") || Object.entries(defaults).map(([k, v]) => `${k}: ${formatKeyCode(v)}`).join(", ");
    }
    return String(value);
}

function fillModeInfoRules(dom, container, mode, i18n) {
    const rules = i18n.raw(`modes.${mode}.rules`) ?? [];
    rules.forEach((rule) => {
        const item = clone(dom, "tpl-mode-info-rule").querySelector('[data-field="rule"]');
        item.textContent = rule;
        container.appendChild(item);
    });
}

export const Screens = {
    renderKeybindRows,

    loading(title, text, dom = document) {
        const screen = clone(dom, "tpl-screen-loading");
        screen.querySelector('[data-field="title"]').textContent = title;
        screen.querySelector('[data-field="hint"]').textContent = text;
        return screen;
    },

    idle(list, selectedDifficulty, difficulties, selectedMode, gameModes, renderLeaderboard, dom = document, i18n, playerName = "", profiles = [], trash = []) {
        const screen = clone(dom, "tpl-screen-idle");
        fillDifficultyCarousel(screen.querySelector('[data-role="difficulty-select"]'), selectedDifficulty, difficulties, i18n);
        fillModeCarousel(screen.querySelector('[data-role="mode-select"]'), selectedMode, i18n);
        fillModeDescription(screen.querySelector('[data-field="modeDescription"]'), selectedMode, i18n);
        screen.querySelector('[data-role="name-input"]').value = playerName;
        fillProfileSelect(dom, screen.querySelector('[data-role="profile-select"]'), profiles, playerName, i18n, trash);
        screen.querySelector('[data-role="delete-profile-button"]').disabled = !playerName;
        screen.querySelector('[data-field="leaderboard"]').appendChild(renderLeaderboard(list));
        i18n.applyStatic(screen);
        return screen;
    },

    options(settings, dom = document, i18n, soundManager = null, context = "options") {
        const screen = clone(dom, "tpl-screen-options");

        if (soundManager) {
            const categoryVolumes = settings.categoryVolumes ?? {};
            const categoryMuted = settings.categoryMuted ?? {};
            const soundVolumes = settings.soundVolumes ?? {};
            const soundMuted = settings.soundMuted ?? {};

            ["sfx", "music", "voices"].forEach((category) => {
                const keys = soundManager.keysInCategory(category);
                const group = screen.querySelector(`[data-role="sound-group-${category}"]`);
                if (!group) return;

                if (keys.length === 0) {
                    group.remove();
                    return;
                }

                const categorySlider = group.querySelector('[data-role="category-volume-slider"]');
                const categoryIsMuted = Boolean(categoryMuted[category]);
                if (categorySlider) {
                    categorySlider.value = Math.round((categoryVolumes[category] ?? 1) * 100);
                    categorySlider.disabled = categoryIsMuted;
                }
                const categoryMuteToggle = group.querySelector('[data-role="category-mute-toggle"]');
                setMuteToggleState(
                    categoryMuteToggle, categoryIsMuted, i18n,
                    categoryIsMuted || (categoryVolumes[category] ?? 1) === 0
                );

                if (category === "voices") {
                    const countdownKeys = keys.filter((key) => VOICE_COUNTING_KEYS.has(key));
                    const otherKeys = keys.filter((key) => !VOICE_COUNTING_KEYS.has(key));

                    const list = group.querySelector('[data-role="sound-list"]');
                    if (list) fillSoundRows(dom, list, otherKeys, soundVolumes, soundMuted, i18n);

                    const countdownGroup = group.querySelector('[data-role="sound-group-voices-countdown"]');
                    const countdownList = group.querySelector('[data-role="sound-list-countdown"]');
                    if (countdownKeys.length === 0) {
                        countdownGroup?.remove();
                    } else if (countdownList) {
                        fillSoundRows(dom, countdownList, countdownKeys, soundVolumes, soundMuted, i18n);
                    }
                } else {
                    const list = group.querySelector('[data-role="sound-list"]');
                    if (list) fillSoundRows(dom, list, keys, soundVolumes, soundMuted, i18n);
                }
            });
        }

        const optionsMuteToggle = screen.querySelector('[data-role="options-mute-toggle"]');
        const volumeSlider = screen.querySelector('[data-role="volume-slider"]');
        setMuteToggleState(
            optionsMuteToggle, Boolean(settings.muted), i18n, Boolean(settings.muted) || settings.volume === 0
        );
        volumeSlider.value = Math.round(settings.volume * 100);
        volumeSlider.disabled = Boolean(settings.muted);
        screen.querySelector('[data-role="hud-right-checkbox"]').checked = settings.hudRight;
        const developerGroup = screen.querySelector('[data-role="options-group-developer"]');
        if (developerGroup) developerGroup.hidden = !DEV_MODE;
        screen.querySelector('[data-role="ghost-checkbox"]').checked = settings.ghost;
        screen.querySelector('[data-role="grid-checkbox"]').checked = settings.gridLines;
        const screenShakeCheckbox = screen.querySelector('[data-role="screen-shake-checkbox"]');
        if (screenShakeCheckbox) screenShakeCheckbox.checked = Boolean(settings.screenShake);
        const heightSaturationCheckbox = screen.querySelector('[data-role="height-saturation-checkbox"]');
        if (heightSaturationCheckbox) heightSaturationCheckbox.checked = Boolean(settings.heightSaturation);
        screen.querySelector('[data-role="glow-checkbox"]').checked = settings.glow;
        screen.querySelector('[data-role="transparency-checkbox"]').checked = settings.transparency;
        const fallTrailCheckbox = screen.querySelector('[data-role="fall-trail-checkbox"]');
        if (fallTrailCheckbox) fallTrailCheckbox.checked = Boolean(settings.fallTrail);
        const skipCountdownCheckbox = screen.querySelector('[data-role="skip-countdown-checkbox"]');
        if (skipCountdownCheckbox) skipCountdownCheckbox.checked = Boolean(settings.skipCountdown);
        const skipModeInfoCheckbox = screen.querySelector('[data-role="skip-mode-info-checkbox"]');
        if (skipModeInfoCheckbox) skipModeInfoCheckbox.checked = Boolean(settings.skipModeInfo);

        const mouseControlCheckbox = screen.querySelector('[data-role="mouse-control-checkbox"]');
        if (mouseControlCheckbox) mouseControlCheckbox.checked = Boolean(settings.mouseControl);

        const mouseSensitivitySlider = screen.querySelector('[data-role="mouse-sensitivity-slider"]');
        if (mouseSensitivitySlider) {
            mouseSensitivitySlider.value = Math.round((settings.mouseSensitivity ?? 1) * 100);
            mouseSensitivitySlider.disabled = !settings.mouseControl;
        }

        const themeSelect = screen.querySelector('[data-role="theme-select"]');
        if (themeSelect) themeSelect.value = settings.theme ?? "none";

        const keybindList = screen.querySelector('[data-role="keybind-list"]');
        if (keybindList) renderKeybindRows(dom, keybindList, settings.keyBindings, i18n);

        const langSelect = screen.querySelector('[data-role="lang-select"]');
        if (langSelect) {
            Object.entries(i18n.languages).forEach(([code, name]) => {
                const option = dom.createElement("option");
                option.value = code;
                option.textContent = name;
                option.selected = code === i18n.lang;
                langSelect.appendChild(option);
            });
        }

        i18n.applyStatic(screen);

        if (context === "pause") {
            const title = screen.querySelector(".screen__title");
            if (title) title.textContent = i18n.t("screens.paused.title");
            const closeBefore = screen.querySelector('[data-i18n="screens.options.closeHintBefore"]');
            const closeKeyEl = screen.querySelector('[data-role="options-close-key"]');
            const closeAfter = screen.querySelector('[data-i18n="screens.options.closeHintAfter"]');
            const closeButton = screen.querySelector('[data-role="options-close-button"]');
            if (closeBefore) closeBefore.textContent = i18n.t("screens.paused.resumeHintBefore");
            if (closeKeyEl) closeKeyEl.textContent = "P";
            if (closeAfter) closeAfter.textContent = i18n.t("screens.paused.resumeHintAfter");
            if (closeButton) closeButton.textContent = i18n.t("screens.paused.resumeButton");
        }

        return screen;
    },

    renderImportDiffRows(dom, container, changes, i18n) {
        container.innerHTML = "";
        changes.forEach((change) => {
            const row = clone(dom, "tpl-options-diff-row").querySelector('[data-role="options-diff-row"]');
            const labelKey = DIFF_LABEL_KEYS[change.key];
            row.querySelector('[data-field="label"]').textContent = labelKey ? i18n.t(labelKey) : change.key;
            row.querySelector('[data-field="oldValue"]').textContent = formatSettingValue(change.key, change.oldValue, i18n);
            row.querySelector('[data-field="newValue"]').textContent = formatSettingValue(change.key, change.newValue, i18n);
            const checkbox = row.querySelector('[data-role="options-diff-checkbox"]');
            checkbox.checked = true;
            checkbox.dataset.key = change.key;
            container.appendChild(row);
        });
    },

    renderBenchmarkResults(dom, container, results, i18n) {
        container.innerHTML = "";
        results.forEach((result, index) => {
            const row = clone(dom, "tpl-benchmark-row").querySelector('[data-role="benchmark-row"]');
            const labelKey = BENCHMARK_LABEL_KEYS[result.key];
            row.querySelector('[data-field="label"]').textContent = labelKey ? i18n.t(labelKey) : result.key;
            row.querySelector('[data-field="value"]').textContent =
                `${result.totalMs.toFixed(1)} ms · ${Math.round(result.percent)}% · ${result.avgMs.toFixed(3)} ms/op`;
            if (index === 0) row.classList.add("options__benchmark-row--top");
            container.appendChild(row);
        });
    },

    formatBenchmarkResultsText(results, i18n, {pieceCount, totalMs} = {}) {
        const lines = [];

        if (pieceCount != null && totalMs != null) {
            const slowest = results[0];
            const slowestLabelKey = slowest ? BENCHMARK_LABEL_KEYS[slowest.key] : null;
            const slowestLabel = slowestLabelKey ? i18n.t(slowestLabelKey) : (slowest?.key ?? "");
            lines.push(i18n.t("screens.options.benchmarkDone", {
                pieces: pieceCount,
                ms: Math.round(totalMs),
                label: slowestLabel,
                percent: slowest ? Math.round(slowest.percent) : 0,
            }));
            lines.push("");
        }

        results.forEach((result) => {
            const labelKey = BENCHMARK_LABEL_KEYS[result.key];
            const label = labelKey ? i18n.t(labelKey) : result.key;
            lines.push(`${label}: ${result.totalMs.toFixed(1)} ms · ${Math.round(result.percent)}% · ${result.avgMs.toFixed(3)} ms/op`);
        });

        return lines.join("\n");
    },

    modeInfo(mode, dom = document, i18n) {
        const screen = clone(dom, "tpl-screen-mode-info");
        screen.querySelector('[data-field="modeName"]').textContent = i18n.t(`modes.${mode}.name`);
        fillModeInfoRules(dom, screen.querySelector('[data-field="rules"]'), mode, i18n);
        i18n.applyStatic(screen);
        return screen;
    },

    calibrationResult(sensitivity, dom = document, i18n) {
        const screen = clone(dom, "tpl-screen-calibration-result");
        const successEl = screen.querySelector('[data-role="calibration-success"]');
        const failedEl = screen.querySelector('[data-role="calibration-failed"]');
        const valueEl = screen.querySelector('[data-field="sensitivityValue"]');

        if (sensitivity != null) {
            if (valueEl) valueEl.textContent = `${Math.round(sensitivity * 100)}%`;
            if (failedEl) failedEl.hidden = true;
        } else {
            if (successEl) successEl.hidden = true;
        }

        i18n.applyStatic(screen);
        return screen;
    },

    keyboardCalibrationResult(dasMs, arrMs, dom = document, i18n) {
        const screen = clone(dom, "tpl-screen-keyboard-calibration-result");
        const successEl = screen.querySelector('[data-role="keyboard-calibration-success"]');
        const failedEl = screen.querySelector('[data-role="keyboard-calibration-failed"]');
        const dasEl = screen.querySelector('[data-field="dasValue"]');
        const arrEl = screen.querySelector('[data-field="arrValue"]');

        if (dasMs != null || arrMs != null) {
            if (dasEl) dasEl.textContent = dasMs != null ? `${Math.round(dasMs)} ms` : "-";
            if (arrEl) arrEl.textContent = arrMs != null ? `${Math.round(arrMs)} ms` : "-";
            if (failedEl) failedEl.hidden = true;
        } else {
            if (successEl) successEl.hidden = true;
        }

        i18n.applyStatic(screen);
        return screen;
    },

    countdown(number, tint, dom = document) {
        const screen = clone(dom, "tpl-screen-countdown");
        screen.querySelector('[data-role="countdown-screen"]').dataset.tint = tint;
        screen.querySelector('[data-field="number"]').textContent = number;
        return screen;
    },

    gameOverEntry(stats, list, highlightEntry, todayBestEntry, renderLeaderboard, dom = document, i18n, reason = "topOut") {
        const screen = clone(dom, "tpl-screen-gameover-entry");
        screen.querySelector('[data-field="playerName"]').textContent = highlightEntry?.name ?? "";
        screen.querySelector('[data-field="score"]').textContent = stats.score;
        screen.querySelector('[data-field="level"]').textContent = stats.level;
        screen.querySelector('[data-field="lines"]').textContent = stats.lines;

        const headerTimeEl = screen.querySelector('[data-role="gameover-header-time"]');
        const isTimedRaceMode = stats.mode === "sprint" || stats.mode === "cheeseRace";
        if (headerTimeEl) {
            if (isTimedRaceMode) {
                headerTimeEl.querySelector('[data-field="headerTime"]').textContent = stats.gameTime;
            } else {
                headerTimeEl.remove();
            }
        }

        screen.querySelector('[data-field="gameTime"]').textContent = stats.gameTime;
        screen.querySelector('[data-field="maxDrought"]').textContent = stats.maxDrought;

        const droughtTotalEl = screen.querySelector('[data-field="droughtTotal"]');
        if (droughtTotalEl) droughtTotalEl.textContent = stats.droughtTotal;

        const droughtAvgEl = screen.querySelector('[data-field="droughtAvg"]');
        if (droughtAvgEl) droughtAvgEl.textContent = stats.droughtAvg;

        const burnEl = screen.querySelector('[data-field="burn"]');
        if (burnEl) burnEl.textContent = stats.burn;

        const transitionEl = screen.querySelector('[data-field="transitionScore"]');
        if (transitionEl) transitionEl.textContent = stats.transitionScore;

        screen.querySelector('[data-field="tetrisRate"]').textContent = stats.tetrisRate;
        screen.querySelector('[data-field="clearBreakdown"]').textContent =
            `${stats.singles} / ${stats.doubles} / ${stats.triples} / ${stats.tetrises}`;
        screen.querySelector('[data-field="pps"]').textContent = stats.pps;
        screen.querySelector('[data-field="spinsBreakdown"]').textContent =
            `${stats.tSpins} / ${stats.tSpinMinis} / ${stats.otherSpins}`;
        screen.querySelector('[data-field="maxCombo"]').textContent = stats.maxCombo;
        screen.querySelector('[data-field="efficiency"]').textContent = stats.efficiency;

        const todayBestRow = screen.querySelector('[data-role="today-best-row"]');
        if (todayBestEntry) {
            todayBestRow.querySelector('[data-field="todayBest"]').textContent = formatNumber(todayBestEntry.score);
            todayBestRow.querySelector('[data-field="todayBestName"]').textContent = todayBestEntry.name;
        } else if (todayBestRow) {
            todayBestRow.remove();
        }

        screen.querySelector('[data-field="leaderboard"]').appendChild(renderLeaderboard(list, highlightEntry));
        i18n.applyStatic(screen);

        const titleKeyByReason = {
            sprintComplete: "screens.gameOverEntry.titleSprintComplete",
            timeUp: "screens.gameOverEntry.titleTimeUp",
            cheeseClear: "screens.gameOverEntry.titleCheeseClear",
            digComplete: "screens.gameOverEntry.titleDigComplete",
        };
        const titleKey = titleKeyByReason[reason];
        if (titleKey) {
            const titleEl = screen.querySelector('[data-field="title"]');
            if (titleEl) titleEl.textContent = i18n.t(titleKey);
        }

        return screen;
    },

    gameOverSaved(list, highlightEntry, renderLeaderboard, selectedDifficulty, difficulties, selectedMode, gameModes, dom = document, i18n, playerName = "", profiles = [], trash = []) {
        const screen = clone(dom, "tpl-screen-gameover-saved");
        fillDifficultyCarousel(screen.querySelector('[data-role="difficulty-select"]'), selectedDifficulty, difficulties, i18n);
        fillModeCarousel(screen.querySelector('[data-role="mode-select"]'), selectedMode, i18n);
        fillModeDescription(screen.querySelector('[data-field="modeDescription"]'), selectedMode, i18n);
        screen.querySelector('[data-role="name-input"]').value = playerName;
        fillProfileSelect(dom, screen.querySelector('[data-role="profile-select"]'), profiles, playerName, i18n, trash);
        screen.querySelector('[data-role="delete-profile-button"]').disabled = !playerName;
        screen.querySelector('[data-field="leaderboard"]').appendChild(renderLeaderboard(list, highlightEntry));
        i18n.applyStatic(screen);
        return screen;
    },
};
