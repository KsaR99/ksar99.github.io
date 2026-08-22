// @ts-nocheck
"use strict";

export class StatTooltipController {
    root: Document;
    openButton: HTMLElement | null = null;
    tooltip: HTMLElement | null = null;
    hoverButton: HTMLElement | null = null;

    constructor(root: Document = document) {
        this.root = root;
        root.addEventListener("click", (event) => this._onClick(event));
        root.addEventListener("keydown", (event) => this._onKeyDown(event));
        root.addEventListener("focusin", (event) => this._onFocusIn(event));
        root.addEventListener("focusout", (event) => this._onFocusOut(event));
        root.addEventListener("pointerover", (event) => this._onPointerOver(event));
        root.addEventListener("pointerout", (event) => this._onPointerOut(event));
        window.addEventListener("resize", () => this._position());
        window.addEventListener("scroll", () => this._position(), true);
    }

    _findButton(target: EventTarget | null) {
        const element = target as HTMLElement | null;
        return element?.closest?.("[data-stat-info]") as HTMLElement | null;
    }

    _onClick(event: MouseEvent) {
        const button = this._findButton(event.target);
        if (button) {
            event.preventDefault();
            if (this.openButton === button && button.classList.contains("is-open")) this.close();
            else this.open(button, true);
            return;
        }
        if (this.openButton && !this.openButton.contains(event.target as Node)) this.close();
    }

    _onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") this.close();
    }

    _onFocusIn(event: FocusEvent) {
        const button = this._findButton(event.target);
        if (button) this.open(button, false);
    }

    _onFocusOut(event: FocusEvent) {
        const button = this._findButton(event.target);
        if (!button) return;
        const next = event.relatedTarget as Node | null;
        if (!next || !button.contains(next)) {
            if (this.hoverButton !== button) this.close();
        }
    }

    _onPointerOver(event: PointerEvent) {
        if (event.pointerType === "touch") return;
        const button = this._findButton(event.target);
        if (!button || button === this.hoverButton) return;
        this.hoverButton = button;
        this.open(button, false);
    }

    _onPointerOut(event: PointerEvent) {
        if (event.pointerType === "touch") return;
        const button = this._findButton(event.target);
        if (!button || button !== this.hoverButton) return;
        const next = event.relatedTarget as Node | null;
        if (next && button.contains(next)) return;
        this.hoverButton = null;
        if (this.openButton === button && !button.matches(":focus-visible") && !button.classList.contains("is-open")) {
            this.close();
        }
    }

    open(button: HTMLElement, pinned = false) {
        if (this.openButton && this.openButton !== button) {
            this.openButton.classList.remove("is-open");
            this.openButton.setAttribute("aria-expanded", "false");
        }

        this.openButton = button;
        button.classList.toggle("is-open", pinned);
        button.setAttribute("aria-expanded", pinned ? "true" : "false");

        const text = button.getAttribute("title") || button.getAttribute("aria-label") || "";
        if (!text) return;

        if (!this.tooltip) {
            this.tooltip = this.root.createElement("div");
            this.tooltip.className = "stat-tooltip-portal";
            this.tooltip.setAttribute("role", "tooltip");
            this.root.body.appendChild(this.tooltip);
        }

        this.tooltip.textContent = text;
        this.tooltip.hidden = false;
        button.setAttribute("aria-describedby", "stat-tooltip-portal");
        this.tooltip.id = "stat-tooltip-portal";
        this._position();
    }

    _position() {
        if (!this.openButton || !this.tooltip || this.tooltip.hidden) return;

        const rect = this.openButton.getBoundingClientRect();
        const gap = 8;
        const margin = 8;

        this.tooltip.style.left = "0px";
        this.tooltip.style.top = "0px";

        const tooltipRect = this.tooltip.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
        left = Math.max(margin, Math.min(left, viewportWidth - tooltipRect.width - margin));

        const spaceAbove = rect.top - margin;
        const spaceBelow = viewportHeight - rect.bottom - margin;
        const placeAbove = spaceAbove >= tooltipRect.height + gap || spaceAbove >= spaceBelow;

        let top;
        if (placeAbove) {
            top = rect.top - tooltipRect.height - gap;
        } else {
            top = rect.bottom + gap;
        }

        top = Math.max(margin, Math.min(top, viewportHeight - tooltipRect.height - margin));

        this.tooltip.style.left = `${Math.round(left)}px`;
        this.tooltip.style.top = `${Math.round(top)}px`;
    }

    close() {
        if (this.openButton) {
            this.openButton.classList.remove("is-open");
            this.openButton.setAttribute("aria-expanded", "false");
            this.openButton.removeAttribute("aria-describedby");
        }
        this.openButton = null;
        if (this.tooltip) this.tooltip.hidden = true;
    }
}
