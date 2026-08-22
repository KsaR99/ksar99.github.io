import type {ScreenFlow} from "./screen-flow.js";

import {debounce} from "../shared/utils.js";

export class ScreenFlowOptionsSearch {
    private query = "";

    constructor(public readonly flow: ScreenFlow) {
    }

    private get game() {
        return this.flow.game;
    }

    bind() {
        const game = this.game;
        if (!game.hud.overlayEl) return;
        const input = game.hud.overlayEl.querySelector<HTMLInputElement>('[data-role="options-search-input"]');
        const panels = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-panels"]');
        const emptyState = game.hud.overlayEl.querySelector<HTMLElement>('[data-role="options-search-empty"]');
        if (!input || !panels) return;

        const rowSelector = ".options__row, .controls__item";
        const groupSelector = '.options[data-role^="options-group-"]:not([data-role="options-group-developer"]), .options__group';
        const searchHiddenRows = new Set<HTMLElement>();
        const searchHiddenGroups = new Set<HTMLElement>();
        const expandedByOpen = new Set<HTMLDetailsElement>();

        const isInDeveloperGroup = (el: HTMLElement): boolean => Boolean(el.closest('[data-role="options-group-developer"]'));

        const clearSearchState = () => {
            searchHiddenRows.forEach((row) => {
                row.hidden = false;
            });
            searchHiddenRows.clear();
            searchHiddenGroups.forEach((group) => {
                group.hidden = false;
            });
            searchHiddenGroups.clear();
            expandedByOpen.forEach((details) => {
                details.open = false;
            });
            expandedByOpen.clear();
        };

        const groupTitleText = (group: HTMLElement): string => {
            const title = group.querySelector(":scope > summary, :scope > h3");
            return title?.textContent?.trim().toLowerCase() ?? "";
        };

        const rowMatchesQuery = (row: HTMLElement, query: string): boolean => {
            if (row.textContent?.trim().toLowerCase().includes(query)) return true;
            let group = row.parentElement?.closest<HTMLElement>(groupSelector);
            while (group) {
                if (groupTitleText(group).includes(query)) return true;
                group = group.parentElement?.closest<HTMLElement>(groupSelector);
            }
            return false;
        };

        const applyFilter = () => {
            clearSearchState();

            const query = input.value.trim().toLowerCase();
            if (!query) {
                if (emptyState) emptyState.hidden = true;
                return;
            }

            const rows = Array.from(panels.querySelectorAll<HTMLElement>(rowSelector)).filter((row) => !isInDeveloperGroup(row));
            let anyVisible = false;

            rows.forEach((row) => {
                if (row.hidden) return;
                const matches = rowMatchesQuery(row, query);
                if (!matches) {
                    row.hidden = true;
                    searchHiddenRows.add(row);
                } else {
                    anyVisible = true;
                }
            });

            const groups = Array.from(panels.querySelectorAll<HTMLElement>(groupSelector)).filter((group) => !isInDeveloperGroup(group));
            groups.forEach((group) => {
                const hasVisibleRow = Array.from(group.querySelectorAll<HTMLElement>(rowSelector)).some((row) => !row.hidden);
                if (!hasVisibleRow) {
                    group.hidden = true;
                    searchHiddenGroups.add(group);
                } else if (group instanceof HTMLDetailsElement && !group.open) {
                    group.open = true;
                    expandedByOpen.add(group);
                }
            });

            if (emptyState) emptyState.hidden = anyVisible;
        };

        input.value = this.query ?? "";
        if (input.value) applyFilter();

        input.addEventListener("input", debounce(() => {
            this.query = input.value;
            applyFilter();
        }, 200));
    }

}
