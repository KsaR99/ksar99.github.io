import {GARBAGE_COLOR_INDEX} from "../shared/config.js";
import {Board as EngineBoard} from "../../../engine/board/board.js";

export class Board extends EngineBoard {
    constructor(cols: number, rows: number) {
        super(cols, rows, {garbageColorIndex: GARBAGE_COLOR_INDEX});
    }
}

export type {CornerFlags, CollapseResult} from "../../../engine/board/types.js";
