// @ts-nocheck
"use strict";

export class ParticleField {

    _fieldTypes: Record<string, new (count: number) => Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer>>;
    count: 0;

    constructor(fieldTypes) {
        this._fieldTypes = fieldTypes;
        this.count = 0;
        for (const name in fieldTypes) {
            this[name] = new fieldTypes[name](0);
        }
    }

    allocate(count, spawn, width, height) {
        this.count = count;
        for (const name in this._fieldTypes) {
            this[name] = new this._fieldTypes[name](count);
        }
        for (let i = 0; i < count; i++) spawn(i, width, height, true);
    }
}

export function resizeParticleEffect(effect, width, height, densityFn, fields, spawn) {
    const {w, h, unchanged} = effect.resizeCanvas(width, height, fields.count);
    if (unchanged) return false;

    fields.allocate(densityFn(w, h), spawn, w, h);
    effect.ctx.clearRect(0, 0, w, h);
    return true;
}
