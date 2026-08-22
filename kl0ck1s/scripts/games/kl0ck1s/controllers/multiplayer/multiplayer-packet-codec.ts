import {BOARD_CONFIG,} from "../../shared/config.js";
import {
    CELL_COLOR_MASK,
    CELL_INDEX_SHIFT,
    MESSAGE_KIND,
    PIECE_POS_AXIS_MAX,
    PIECE_POS_FRAC_BITS,
    PIECE_POS_MASK,
    PIECE_POS_SHIFT,
} from "../../../../engine/net/net-constants.js";

export type BoardPacket =
    | { kind: typeof MESSAGE_KIND.BOARD; cells: number[] }
    | { kind: typeof MESSAGE_KIND.BOARD; d: number[] };

export function buildBoardPacket(cells: Uint8Array, previous: Uint8Array | null): BoardPacket {
    if (previous && previous.length === cells.length) {
        const changes: number[] = [];
        for (let i = 0; i < cells.length; i++) {
            if (cells[i] !== previous[i]) changes.push((i << CELL_INDEX_SHIFT) | cells[i]);
        }
        if (changes.length * 2 < cells.length) {
            return {kind: MESSAGE_KIND.BOARD, d: changes};
        }
    }
    return {kind: MESSAGE_KIND.BOARD, cells: Array.from(cells)};
}

export function packPiecePosition(x: number, y: number): number {
    const scale = 1 << PIECE_POS_FRAC_BITS;
    const xFixed = Math.round(Math.max(0, Math.min(PIECE_POS_AXIS_MAX, x)) * scale);
    const yFixed = Math.round(Math.max(0, Math.min(PIECE_POS_AXIS_MAX, y)) * scale);
    return (xFixed << PIECE_POS_SHIFT) | yFixed;
}

export function unpackPiecePosition(pos: number): { x: number; y: number } {
    const scale = 1 << PIECE_POS_FRAC_BITS;
    return {
        x: (pos >> PIECE_POS_SHIFT) / scale,
        y: (pos & PIECE_POS_MASK) / scale,
    };
}

export function decodeBoardPacket(
    payload: { cells?: number[]; d?: number[] },
    previous: Uint8Array | null,
): Uint8Array {
    if (payload.cells) return Uint8Array.from(payload.cells);
    const cells = previous
        ? Uint8Array.from(previous)
        : new Uint8Array(BOARD_CONFIG.COLS * BOARD_CONFIG.ROWS);
    for (const packed of payload.d ?? []) {
        cells[packed >> CELL_INDEX_SHIFT] = packed & CELL_COLOR_MASK;
    }
    return cells;
}
