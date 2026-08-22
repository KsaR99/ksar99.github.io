// @ts-nocheck
"use strict";

export class ConfirmDialog {

    dom: Document;
    _resolve: ((value: boolean) => void) | null;
    _previouslyFocused: Element | null;

    constructor(dom: Document = globalThis.document) {
        this.dom = dom;
        this._resolve = null;
        this._previouslyFocused = null;
        this._onKeydown = this._onKeydown.bind(this);
        this._onOverlayClick = this._onOverlayClick.bind(this);
    }

    get overlayEl() {
        return this.dom?.querySelector('[data-role="confirm-overlay"]') ?? null;
    }

    get messageEl() {
        return this.dom?.querySelector('[data-field="confirm-message"]') ?? null;
    }

    get okButton() {
        return this.dom?.querySelector('[data-role="confirm-ok-button"]') ?? null;
    }

    get cancelButton() {
        return this.dom?.querySelector('[data-role="confirm-cancel-button"]') ?? null;
    }

    bind() {
        this.okButton?.addEventListener("click", () => this._settle(true));
        this.cancelButton?.addEventListener("click", () => this._settle(false));
        this.overlayEl?.addEventListener("click", this._onOverlayClick);
    }

    _onOverlayClick(e: MouseEvent): void {
        if (e.target === this.overlayEl) this._settle(false);
    }

    _onKeydown(e: KeyboardEvent): void {
        if (e.key === "Escape") {
            e.preventDefault();
            this._settle(false);
        } else if (e.key === "Enter") {
            e.preventDefault();
            this._settle(true);
        }
    }

    ask(message: string): Promise<boolean> {
        const overlay = this.overlayEl;
        if (!overlay) {
            return Promise.resolve(globalThis.confirm ? globalThis.confirm(message) : true);
        }

        if (this._resolve) this._settle(false);

        return new Promise((resolve) => {
            this._resolve = resolve;
            if (this.messageEl) this.messageEl.textContent = message;

            this._previouslyFocused = this.dom.activeElement;
            overlay.hidden = false;
            requestAnimationFrame(() => overlay.classList.add("confirm-overlay--visible"));

            this.dom.addEventListener("keydown", this._onKeydown);
            this.okButton?.focus();
        });
    }

    _settle(result: boolean): void {
        if (!this._resolve) return;
        const resolve = this._resolve;
        this._resolve = null;

        const overlay = this.overlayEl;
        overlay?.classList.remove("confirm-overlay--visible");
        if (overlay) overlay.hidden = true;
        this.dom.removeEventListener("keydown", this._onKeydown);
        this._previouslyFocused?.focus?.();
        this._previouslyFocused = null;
        resolve(result);
    }
}
