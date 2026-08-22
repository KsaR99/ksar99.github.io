// @ts-nocheck
import type {Game} from "./game.js";
import {
    COUNTDOWN_STEPS,
    FALL_TRAIL_FRAME_MS,
    FALL_TRAIL_MAX_LENGTH,
    fallTrailLengthForInterval,
    HUD_UPDATE_INTERVAL_MS,
    SQUARE_SPIN_SCALE_DIP
} from "./game-constants.js";

export class GameRuntime {
    private readonly game: Game;
    private backgroundTicker: number | null = null;
    private lastTime = 0;

    constructor(game: Game) {
        this.game = game;
    }

    _updateHardcoreMask(delta: number): void {
        const game = this.game;
        const state = game.gameState;
        if (state.state === "clearing") {
            if (game.hardcoreMaskAnim) {
                game.hardcoreMaskAnim.elapsed += delta;
                const t = Math.min(1, game.hardcoreMaskAnim.elapsed / game.hardcoreMaskAnim.duration);
                const {fromRow, toRow} = game.hardcoreMaskAnim;
                game.hardcoreMaskDisplayRow = fromRow + (toRow - fromRow) * t;
                if (t >= 1) game.hardcoreMaskAnim = null;
            }
            return;
        }

        const target = game.modeController.hardcoreMaskFromRow();

        if (target === null) {
            game.hardcoreMaskTargetRow = null;
            game.hardcoreMaskDisplayRow = null;
            game.hardcoreMaskAnim = null;
            return;
        }

        if (game.hardcoreMaskTargetRow === null) {
            game.hardcoreMaskTargetRow = target;
            game.hardcoreMaskDisplayRow = target;
            game.hardcoreMaskAnim = null;
            return;
        }

        if (target !== game.hardcoreMaskTargetRow) {
            game.hardcoreMaskAnim = {
                fromRow: game.hardcoreMaskDisplayRow,
                toRow: target,
                elapsed: 0,
                duration: game.lineClearAnimationDuration,
            };
            game.hardcoreMaskTargetRow = target;
        }

        if (game.hardcoreMaskAnim) {
            game.hardcoreMaskAnim.elapsed += delta;
            const t = Math.min(1, game.hardcoreMaskAnim.elapsed / game.hardcoreMaskAnim.duration);
            const {fromRow, toRow} = game.hardcoreMaskAnim;
            game.hardcoreMaskDisplayRow = fromRow + (toRow - fromRow) * t;
            if (t >= 1) game.hardcoreMaskAnim = null;
        }
    }

    update(delta: number): void {
        const game = this.game;
        const state = game.gameState;
        this._updateHardcoreMask(delta);

        if (state.rotationAnim) {
            state.rotationAnim.elapsed += delta;
            if (state.rotationAnim.elapsed >= state.rotationAnim.duration) {
                state.rotationAnim = null;
            }
        }

        if (state.shiftAnim) {
            state.shiftAnim.elapsed += delta;
            if (state.shiftAnim.elapsed >= state.shiftAnim.duration) {
                state.shiftAnim = null;
            }
        }

        if (state.hardDropTrail) {
            state.hardDropTrail.elapsed += delta;
            if (state.hardDropTrail.elapsed >= state.hardDropTrail.duration) {
                state.hardDropTrail = null;
            }
        }

        if (state.hardDropImpactFlash) {
            state.hardDropImpactFlash.elapsed += delta;
            if (state.hardDropImpactFlash.elapsed >= state.hardDropImpactFlash.duration) {
                state.hardDropImpactFlash = null;
            }
        }

        if (state.zenShiftAnim) {
            state.zenShiftAnim.elapsed += delta;
            if (state.zenShiftAnim.elapsed >= state.zenShiftAnim.duration) {
                state.zenShiftAnim = null;
            }
        }

        if (state.lockImpactFlash) {
            state.lockImpactFlash.elapsed += delta;
            if (state.lockImpactFlash.elapsed >= state.lockImpactFlash.duration) {
                state.lockImpactFlash = null;
            }
        }

        if (state.levelUpTimer > 0) {
            state.levelUpTimer = Math.max(0, state.levelUpTimer - delta);
        }

        if (state.comboBannerTimer > 0) {
            state.comboBannerTimer = Math.max(0, state.comboBannerTimer - delta);
        }

        if (state.state === "running" || state.state === "clearing") {
            state._hudUpdateAcc = (state._hudUpdateAcc ?? 0) + delta;
            if (state._hudUpdateAcc >= HUD_UPDATE_INTERVAL_MS) {
                state._hudUpdateAcc = 0;
                game.hud.update(game.stats);
            }

            game.musicDirector.update(game.board, delta);
        }

        if (state.state === "countdown") {
            state.countdownTimer += delta;
            while (state.countdownTimer >= game.countdownStepDuration) {
                state.countdownTimer -= game.countdownStepDuration;
                ++state.countdownIndex;
                if (state.countdownIndex >= COUNTDOWN_STEPS.length) {
                    game.screenFlow.start();
                    break;
                }
                game.screenFlow.advanceCountdownStep();
            }
            return;
        }

        if (state.state === "clearing") {
            state.clearingTimer += delta;
            const duration = state.cascadeFalling ? game.cascadeFallDuration : game.lineClearAnimationDuration;
            if (state.clearingTimer >= duration) {
                if (state.cascadeFalling) {
                    game.pieceController.finishCascadeFall();
                } else {
                    game.pieceController.finishLineClear();
                }

                state._hudUpdateAcc = 0;
                game.hud.update(game.stats);
            }
            return;
        }

        if (state.state !== "running") return;

        game.engine.state.phase = "running";
        game.engine.maxGroundedTimeMs = game.getMaxGroundedTime();
        const result = game.engine.step(delta);
        state.current = game.engine.state.current;

        if (result.dropped) {
            game.noteRowStep();
            state.shiftAnim = null;
        }

        game.pieceController.updateGrounded(state.rawGrounded, delta);
        game.pieceController.updateFalling();

        game.modeController.update(delta);
        if (state.state !== "running") return;

        if (result.lockReady) {
            game.pieceController.lockCurrentPiece();
        }
    }

    getRenderedPiece() {
        const game = this.game;
        const state = game.gameState;
        const base = state.current;
        if (!base) return base;

        let x = base.x;
        let y = base.y;
        let angle = 0;
        let scale = 1;
        let squareSpinActive = false;

        if (state.rotationAnim) {
            const anim = state.rotationAnim;
            const t = Math.min(1, anim.elapsed / anim.duration);
            const eased = t * t * (3 - 2 * t);

            x = anim.fromX + (base.x - anim.fromX) * eased;
            y = anim.fromY + (base.y - anim.fromY) * eased;

            if (anim.squareSpin) {
                squareSpinActive = true;
                const SHRINK_PHASE = 0.25;
                const GROW_PHASE = 0.25;
                const SPIN_START = SHRINK_PHASE;
                const SPIN_END = 1 - GROW_PHASE;

                if (t < SHRINK_PHASE) {
                    const localT = t / SHRINK_PHASE;
                    const localEased = localT * localT * (3 - 2 * localT);
                    angle = 0;
                    scale = 1 - SQUARE_SPIN_SCALE_DIP * localEased;
                } else if (t < SPIN_END) {
                    const localT = (t - SPIN_START) / (SPIN_END - SPIN_START);
                    const localEased = localT * localT * (3 - 2 * localT);
                    angle = anim.spinAngle * localEased;
                    scale = 1 - SQUARE_SPIN_SCALE_DIP;
                } else {
                    const localT = (t - SPIN_END) / GROW_PHASE;
                    const localEased = localT * localT * (3 - 2 * localT);
                    angle = anim.spinAngle;
                    scale = (1 - SQUARE_SPIN_SCALE_DIP) + SQUARE_SPIN_SCALE_DIP * localEased;
                }
            } else {
                angle = anim.fromAngle * (1 - eased);
            }
        } else {
            if (state.shiftAnim && state.rawGrounded) {
                const t = Math.min(1, state.shiftAnim.elapsed / state.shiftAnim.duration);
                const {fromX, toX} = state.shiftAnim;
                x = fromX + (toX - fromX) * t;
            }
            if (state.state === "running" && state.dropInterval > 0 && !state.rawGrounded) {
                // Only show fractional fall when the next whole-cell position is
                // actually free. Otherwise the interpolation would visually sink
                // the piece into the block it is about to land on.
                const nextCellBlocked = game.board.collides(base, 0, 1);
                if (!nextCellBlocked) {
                    y = base.y + Math.min(0.999, state.dropCounter / state.dropInterval);
                }
            }
        }

        if (x === base.x && y === base.y && angle === 0 && scale === 1) return base;

        const rendered = Object.create(Object.getPrototypeOf(base));
        Object.assign(rendered, base, {x, y, renderAngle: angle, renderScale: scale});

        if (squareSpinActive) {
            rendered.pivotX = base.width / 2;
            rendered.pivotY = base.height / 2;
        }

        return rendered;
    }

    updateFallTrail(renderedPiece) {
        const game = this.game;
        const state = game.gameState;
        const moveIntervalMs = Math.min(state.effectiveDropIntervalMs, state.effectiveShiftIntervalMs);
        const trailLength = fallTrailLengthForInterval(moveIntervalMs);

        if (trailLength === 0) {
            state.fallTrailCount = 0;
            return;
        }

        if (state._trailPieceRef !== state.current) {
            state._trailPieceRef = state.current;
            this._primeFallTrail(renderedPiece, trailLength, moveIntervalMs);
            return;
        }

        const slot = state.fallTrail[state.fallTrailHead];
        slot.x = renderedPiece.x;
        slot.y = renderedPiece.y;
        slot.mask = renderedPiece.mask;
        slot.width = renderedPiece.width;
        slot.height = renderedPiece.height;
        slot.color = renderedPiece.color;

        state.fallTrailHead = (state.fallTrailHead + 1) % FALL_TRAIL_MAX_LENGTH;
        state.fallTrailCount = Math.min(trailLength, state.fallTrailCount + 1);
    }

    _primeFallTrail(renderedPiece, trailLength, moveIntervalMs) {
        const game = this.game;
        const state = game.gameState;
        const stepPerFrame = Number.isFinite(moveIntervalMs) && moveIntervalMs > 0
            ? FALL_TRAIL_FRAME_MS / moveIntervalMs
            : 0;

        for (let i = 0; i < trailLength; i++) {
            const framesAgo = trailLength - i;
            const slot = state.fallTrail[i];
            slot.x = renderedPiece.x;
            slot.y = renderedPiece.y - framesAgo * stepPerFrame;
            slot.mask = renderedPiece.mask;
            slot.width = renderedPiece.width;
            slot.height = renderedPiece.height;
            slot.color = renderedPiece.color;
        }
        state.fallTrailHead = trailLength % FALL_TRAIL_MAX_LENGTH;
        state.fallTrailCount = trailLength;
    }

    render() {
        const game = this.game;
        const state = game.gameState;
        game.themeOverlay.update();

        const boardStage = game.renderer.boardEl;
        const boardEl = boardStage?.closest(".board") ?? boardStage;
        if (boardEl) {
            const tutorialActive = boardEl?.classList.contains("first-game-tutorial-active");
            const shouldHideCursor = ["running", "clearing", "countdown"].includes(state.state)
                && !state.settings.mouseControl
                && !tutorialActive;

            if (shouldHideCursor !== boardEl.classList.contains("cursor-hidden")) {
                boardEl.classList.toggle("cursor-hidden", shouldHideCursor);
                game._forceCursorRepaint();
            }
        }

        const showPieceBehindOptions = state.state === "options"
            && ["running", "paused"].includes(state.previousStateBeforeOptions);

        if (state.state === "clearing") {
            if (state.cascadeFalling) {
                const progress = Math.min(1, state.clearingTimer / game.cascadeFallDuration);
                game.renderer.drawCascadeFallFrame(game.board, state.clearingDropGrid, progress);
            } else {
                const progress = Math.min(1, state.clearingTimer / game.lineClearAnimationDuration);
                game.renderer.drawClearingFrame(
                    game.board, state.clearingLines, state.clearingDropRows, state.clearingFragments, progress
                );
            }
        } else if (state.zenShiftAnim) {
            const progress = Math.min(1, state.zenShiftAnim.elapsed / state.zenShiftAnim.duration);
            game.renderer.drawZenShiftFrame(game.board, state.zenShiftAnim.rowDelta, progress);
        } else {
            game.renderer.drawBoard(game.board);
        }

        if (game.hardcoreMaskDisplayRow !== null) {
            game.renderer.drawHardcoreMask(game.board, game.hardcoreMaskDisplayRow, state.activeTheme);
        }

        if (state.hardDropTrail) {
            const progress = Math.min(1, state.hardDropTrail.elapsed / state.hardDropTrail.duration);
            game.renderer.drawHardDropTrail(state.hardDropTrail.entries, progress);
        }

        if (state.hardDropImpactFlash) {
            const progress = Math.min(1, state.hardDropImpactFlash.elapsed / state.hardDropImpactFlash.duration);
            game.renderer.drawHardDropImpactFlash(state.hardDropImpactFlash.entry, progress);
        }

        if (state.lockImpactFlash) {
            const progress = Math.min(1, state.lockImpactFlash.elapsed / state.lockImpactFlash.duration);
            game.renderer.drawLockImpactFlash(state.lockImpactFlash.entry, progress);
        }

        if (["running", "paused"].includes(state.state)
            || showPieceBehindOptions) {
            const renderedPiece = this.getRenderedPiece();

            if (state.state === "running") {
                game.renderer.drawGhost(state.current, game.board);
                if (state.settings.fallTrail) {
                    this.updateFallTrail(renderedPiece);
                    game.renderer.drawFallTrail(state.fallTrail, state.fallTrailHead, state.fallTrailCount);
                } else {
                    state.fallTrailCount = 0;
                }
            } else {
                state.fallTrailCount = 0;
            }

            if (state.rotationAnim) {
                const direction = Math.sign(state.rotationAnim.fromAngle);
                game.renderer.drawRotationIndicator(renderedPiece, direction);
            }

            game.renderer.drawPiece(renderedPiece, game.board);
        }

        if (state.levelUpTimer > 0 || state.comboBannerTimer > 0) {
            game.renderer.drawBanners(
                game.board,
                game.renderer,
                state.levelUpTimer > 0 ? state.levelUpLevel : null,
                state.comboBannerTimer > 0 ? state.comboBannerCombo : null,
            );
        }

        game.renderer.flushWebGL();
    }

    startBackgroundTicker() {
        const game = this.game;
        const state = game.gameState;
        if (this.backgroundTicker) return;
        this.backgroundTicker = window.setInterval(() => {
            const now = performance.now();
            const delta = Math.min(now - this.lastTime, 1000);
            this.lastTime = now;
            this.update(delta);
        }, 200);
    }

    stopBackgroundTicker() {
        if (this.backgroundTicker) {
            window.clearInterval(this.backgroundTicker);
            this.backgroundTicker = null;
        }
    }

    loop(time = 0) {
        const game = this.game;
        const state = game.gameState;
        const delta = Math.min(time - this.lastTime, 100);
        this.lastTime = time;

        this.update(delta);
        this.render();

        requestAnimationFrame(this.loop.bind(this));
    }
}
