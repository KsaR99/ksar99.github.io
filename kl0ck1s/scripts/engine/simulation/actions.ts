"use strict";

export type GameAction =
    | { type: "move"; direction: -1 | 1 }
    | { type: "rotate"; direction: -1 | 1 | 2 }
    | { type: "softDrop" }
    | { type: "hardDrop" }
    | { type: "hold" }
    | { type: "pause" }
    | { type: "resume" }
    | { type: "restart" };
