"use strict";

type Kick = readonly [number, number];
export type KickTable = Record<string, readonly Kick[]>;

function invert(kicks: readonly Kick[]): Kick[] {
    return kicks.map(([dx, dy]) => [-dx, -dy]);
}

function withReverse(cw: KickTable): KickTable {
    const result = {...cw};
    for (const [key, offsets] of Object.entries(cw)) {
        const [from, to] = key.split(">");
        result[`${to}>${from}`] = invert(offsets);
    }
    return result;
}

export const JLSTZ_KICKS = withReverse({
    "0>1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "1>2": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    "2>3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "3>0": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
});
export const I_KICKS = withReverse({
    "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
});
export const O_KICKS = withReverse({
    "0>1": [[0, 0]], "1>2": [[0, 0]], "2>3": [[0, 0]], "3>0": [[0, 0]],
});

export function getKickTable(type: string): KickTable {
    return type === "I" ? I_KICKS : type === "O" ? O_KICKS : JLSTZ_KICKS;
}
