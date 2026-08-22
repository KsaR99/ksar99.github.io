export {Board} from "./board.js";
export {analyzeOccupancy, getColumnHeights} from "./analysis.js";
export type {BoardMetrics} from "./analysis.js";
export type {CornerFlags, CollapseResult, OverflowRow, BoardLike} from "./types.js";
export {createBoardSnapshot, restoreBoardSnapshot} from "../snapshot/board.js";
export type {BoardSnapshot} from "../snapshot/board.js";
