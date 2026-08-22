// @ts-nocheck
"use strict";

const VERTEX_SHADER = `#version 300 es
in vec2 aCorner;
in vec4 aRect;
in vec4 aUv;
uniform vec2 uResolution;
out vec2 vUv;

void main() {
    vec2 pos = aRect.xy + aCorner * aRect.zw;
    vUv = aUv.xy + aCorner * aUv.zw;
    vec2 clip = (pos / uResolution) * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform float uAlpha;
out vec4 outColor;

void main() {
    vec4 color = texture(uTexture, vUv);
    color.a *= uAlpha;
    if (color.a <= 0.001) discard;
    outColor = color;
}
`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`WebGL shader compile failed: ${info}`);
    }
    return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`WebGL program link failed: ${info}`);
    }
    return program;
}

interface SpriteRegion {
    image: HTMLCanvasElement;
    sx: number;
    sy: number;
    sw: number;
    sh: number;
}

function regionOf(sprite: HTMLCanvasElement | SpriteRegion): SpriteRegion {
    return sprite.image !== undefined
        ? sprite
        : {image: sprite, sx: 0, sy: 0, sw: sprite.width, sh: sprite.height};
}

function uvRect(region: SpriteRegion, iw: number, ih: number): [number, number, number, number] {
    const insetU = 0.5 / iw;
    const insetV = 0.5 / ih;

    return [
        region.sx / iw + insetU,
        region.sy / ih + insetV,
        Math.max(0, (region.sw - 1) / iw),
        Math.max(0, (region.sh - 1) / ih),
    ];
}

function oklchToRgb(color: string): [number, number, number, number] {
    const match = String(color).match(/oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\s*\)/i);
    if (!match) return [1, 1, 1, 1];

    const L = Number(match[1]);
    const C = Number(match[2]);
    const H = Number(match[3]) * Math.PI / 180;
    const alpha = match[4] == null ? 1 : Number(match[4]);

    const a = C * Math.cos(H);
    const b = C * Math.sin(H);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    const rLin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    const toSrgb = (v: number): number => {
        const x = Math.max(0, v);
        return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    };

    return [toSrgb(rLin), toSrgb(gLin), toSrgb(bLin), alpha];
}

class InstanceGroup {

    capacity: number;
    rects: Float32Array<ArrayBuffer>;
    uvs: Float32Array<ArrayBuffer>;
    slotCell: Int32Array<ArrayBuffer>;
    count: number;
    alpha: number;
    gpuRectBuffer: WebGLBuffer | null;
    gpuUvBuffer: WebGLBuffer | null;
    gpuVao: WebGLVertexArrayObject | null;
    gpuCapacity: number;
    gpuDirty: boolean;

    constructor() {
        this.capacity = 0;
        this.rects = new Float32Array(0);
        this.uvs = new Float32Array(0);
        this.slotCell = new Int32Array(0);
        this.count = 0;
        this.alpha = 1;
        this.gpuRectBuffer = null;
        this.gpuUvBuffer = null;
        this.gpuVao = null;
        this.gpuCapacity = 0;
        this.gpuDirty = true;
    }

    ensureCapacity(n: number): void {
        if (n <= this.capacity) return;
        let cap = Math.max(64, this.capacity || 64);
        while (cap < n) cap *= 2;

        const rects = new Float32Array(cap * 4);
        const uvs = new Float32Array(cap * 4);
        const slotCell = new Int32Array(cap).fill(-1);
        rects.set(this.rects.subarray(0, this.count * 4));
        uvs.set(this.uvs.subarray(0, this.count * 4));
        slotCell.set(this.slotCell.subarray(0, this.count));

        this.rects = rects;
        this.uvs = uvs;
        this.slotCell = slotCell;
        this.capacity = cap;
        this.gpuDirty = true;
    }

    writeSlot(slot: number, x: number, y: number, w: number, h: number, u0: number, v0: number, u1: number, v1: number): void {
        const o = slot * 4;
        this.rects[o] = x;
        this.rects[o + 1] = y;
        this.rects[o + 2] = w;
        this.rects[o + 3] = h;
        this.uvs[o] = u0;
        this.uvs[o + 1] = v0;
        this.uvs[o + 2] = u1;
        this.uvs[o + 3] = v1;
        this.gpuDirty = true;
    }

    push(x: number, y: number, w: number, h: number, u0: number, v0: number, u1: number, v1: number, cellIndex = -1): number {
        this.ensureCapacity(this.count + 1);
        const slot = this.count;
        this.writeSlot(slot, x, y, w, h, u0, v0, u1, v1);
        this.slotCell[slot] = cellIndex;
        this.count++;
        this.gpuDirty = true;
        return slot;
    }

    removeSlot(slot: number): number {
        const last = this.count - 1;
        let movedCell = -1;
        if (slot !== last) {
            const o = slot * 4, lo = last * 4;
            this.rects.copyWithin(o, lo, lo + 4);
            this.uvs.copyWithin(o, lo, lo + 4);
            movedCell = this.slotCell[last];
            this.slotCell[slot] = movedCell;
        }
        this.count--;
        this.gpuDirty = true;
        return movedCell;
    }

    reset(): void {
        if (this.count) this.gpuDirty = true;
        this.count = 0;
    }
}

export class WebGLBoardRenderer {

    canvas: HTMLCanvasElement;
    cols: number;
    rows: number;
    gl: WebGL2RenderingContext;
    program: WebGLProgram;
    aCorner: number;
    aRect: number;
    aUv: number;
    uResolution: WebGLUniformLocation | null;
    uTexture: WebGLUniformLocation | null;
    uAlpha: WebGLUniformLocation | null;
    vao: WebGLVertexArrayObject | null;
    cornerBuffer: WebGLBuffer | null;
    rectBuffer: WebGLBuffer | null;
    uvBuffer: WebGLBuffer | null;
    _textures: WeakMap<HTMLCanvasElement, WebGLTexture>;
    _allTextures: Set<WebGLTexture>;
    _size: number;
    _width: number;
    _height: number;
    _persistentGroups: Map<string, InstanceGroup>;
    _cellColor: Int16Array<ArrayBuffer>;
    _cellGroup: (InstanceGroup | null)[];
    _cellSlot: Int32Array<ArrayBuffer>;
    _boardFingerprint: null | string;
    _boardRows: number;
    _boardCols: number;
    _boardVersion: number;
    _rangeGroups: Map<string, InstanceGroup>;
    _gridGroup: null | InstanceGroup;
    _gridTexture: WebGLTexture | null;
    _gridSize: number;
    _gridRows: number;
    _gridCols: number;
    _gridSprite: HTMLCanvasElement | null;
    _transientGroups: Map<string, InstanceGroup>;
    _alphaGroups: Map<string, InstanceGroup>;
    _regionCache: WeakMap<HTMLCanvasElement, { region: SpriteRegion; uv: [number, number, number, number] }>;
    _frameOpen: boolean;
    _boardAddedThisFrame: boolean;
    _gridAddedThisFrame: boolean;
    _activeBoardGroups: Map<string, InstanceGroup>;

    constructor(canvas: HTMLCanvasElement, {cols = 10, rows = 20}: { cols?: number; rows?: number } = {}) {
        this.canvas = canvas;
        this.cols = cols;
        this.rows = rows;
        this.gl = canvas.getContext("webgl2", {
            alpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: false,
            powerPreference: "high-performance",
        });
        if (!this.gl) throw new Error("WebGL2 is not available.");

        const gl = this.gl;
        this.program = createProgram(gl);
        this.aCorner = gl.getAttribLocation(this.program, "aCorner");
        this.aRect = gl.getAttribLocation(this.program, "aRect");
        this.aUv = gl.getAttribLocation(this.program, "aUv");
        this.uResolution = gl.getUniformLocation(this.program, "uResolution");
        this.uTexture = gl.getUniformLocation(this.program, "uTexture");
        this.uAlpha = gl.getUniformLocation(this.program, "uAlpha");

        this.vao = gl.createVertexArray();
        this.cornerBuffer = gl.createBuffer();
        this.rectBuffer = gl.createBuffer();
        this.uvBuffer = gl.createBuffer();
        this._textures = new WeakMap();
        this._allTextures = new Set();
        this._size = 0;
        this._width = 0;
        this._height = 0;
        this._persistentGroups = new Map(); // texture -> InstanceGroup, board cells
        this._cellColor = new Int16Array(0); // last color index rendered per cell, -1 = empty
        this._cellGroup = []; // cellIndex -> InstanceGroup currently holding it (or null)
        this._cellSlot = new Int32Array(0); // cellIndex -> slot within its group
        this._boardFingerprint = null;
        this._boardRows = 0;
        this._boardCols = 0;
        this._boardVersion = -1;
        this._rangeGroups = new Map();
        this._gridGroup = null;
        this._gridTexture = null;
        this._gridSize = 0;
        this._gridRows = 0;
        this._gridCols = 0;
        this._gridSprite = null;
        this._transientGroups = new Map();
        this._alphaGroups = new Map();
        this._regionCache = new WeakMap();

        this._frameOpen = false;
        this._boardAddedThisFrame = false;
        this._gridAddedThisFrame = false;
        this._activeBoardGroups = this._persistentGroups;

        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(this.aCorner);
        gl.vertexAttribPointer(this.aCorner, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }

    resize(width: number, height: number): void {
        if (this.canvas.width === width && this.canvas.height === height) return;
        this.canvas.width = width;
        this.canvas.height = height;
        this._width = width;
        this._height = height;
    }

    _texture(sprite: HTMLCanvasElement): WebGLTexture {
        let texture = this._textures.get(sprite);
        if (texture) return texture;
        const gl = this.gl;
        texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sprite);
        gl.bindTexture(gl.TEXTURE_2D, null);
        this._textures.set(sprite, texture);
        this._allTextures.add(texture);
        return texture;
    }

    invalidateGrid(): void {
        this._gridGroup = null;
        this._gridTexture = null;
        this._gridSize = 0;
        this._gridRows = 0;
        this._gridCols = 0;
        this._gridSprite = null;
        this._gridAddedThisFrame = false;
    }

    begin(width: number, height: number, clear = true): void {
        const gl = this.gl;
        this.resize(width, height);
        gl.viewport(0, 0, width, height);
        gl.useProgram(this.program);
        gl.uniform2f(this.uResolution, width, height);
        gl.uniform1i(this.uTexture, 0);
        gl.bindVertexArray(this.vao);
        if (clear) {
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            for (const group of this._transientGroups.values()) group.reset();
            this._alphaGroups.clear();
            this._boardAddedThisFrame = false;
            this._gridAddedThisFrame = false;
            this._frameOpen = true;
        }
    }

    _addRegionAt(region: SpriteRegion, x: number, y: number, alpha: number): void {
        const texture = this._texture(region.image);
        let group = this._transientGroups.get(texture);
        if (!group) {
            group = new InstanceGroup();
            this._transientGroups.set(texture, group);
        }
        const iw = region.image.width, ih = region.image.height;
        group.push(x, y, region.sw, region.sh, ...uvRect(region, iw, ih));
        group.alpha = alpha;
    }

    addSprite(sprite: HTMLCanvasElement | SpriteRegion | null, x: number, y: number, alpha = 1): void {
        if (!sprite) return;
        this._addRegionAt(regionOf(sprite), x, y, alpha);
    }

    addCell(x: number, y: number, size: number, sprite: HTMLCanvasElement | SpriteRegion | null, alpha = 1): void {
        if (!sprite) return;
        const region = regionOf(sprite);
        const offsetX = (region.sw - size) * 0.5;
        const offsetY = (region.sh - size) * 0.5;
        this._addRegionAt(region, x * size - offsetX, y * size - offsetY, alpha);
    }

    _cachedRegion(sprite: HTMLCanvasElement | SpriteRegion): {
        region: SpriteRegion;
        uv: [number, number, number, number]
    } {
        let entry = this._regionCache.get(sprite);
        if (!entry) {
            const region = regionOf(sprite);
            const iw = region.image.width, ih = region.image.height;
            entry = {region, uv: uvRect(region, iw, ih)};
            this._regionCache.set(sprite, entry);
        }
        return entry;
    }

    addSpriteAlpha(sprite: HTMLCanvasElement | SpriteRegion | null, x: number, y: number, alpha = 1): void {
        if (!sprite) return;
        const {region, uv} = this._cachedRegion(sprite);
        const texture = this._texture(region.image);
        let byAlpha = this._alphaGroups.get(texture);
        if (!byAlpha) {
            byAlpha = new Map();
            this._alphaGroups.set(texture, byAlpha);
        }
        let group = byAlpha.get(alpha);
        if (!group) {
            group = new InstanceGroup();
            group.alpha = alpha;
            byAlpha.set(alpha, group);
        }
        group.push(x, y, region.sw, region.sh, uv[0], uv[1], uv[2], uv[3]);
    }

    addCellAlpha(x: number, y: number, size: number, sprite: HTMLCanvasElement | SpriteRegion | null, alpha = 1): void {
        if (!sprite) return;
        const region = regionOf(sprite);
        const offsetX = (region.sw - size) * 0.5;
        const offsetY = (region.sh - size) * 0.5;
        this.addSpriteAlpha(sprite, x * size - offsetX, y * size - offsetY, alpha);
    }

    addGrid(board, size, spriteCache) {
        const sprite = spriteCache.getGridCell(size);
        if (!sprite) return;

        const upToDate = this._gridGroup
            && this._gridSprite === sprite
            && this._gridSize === size
            && this._gridRows === board.rows
            && this._gridCols === board.cols;

        if (!upToDate) {
            const region = regionOf(sprite);
            const texture = this._texture(region.image);
            const iw = region.image.width, ih = region.image.height;
            const [u0, v0, u1, v1] = uvRect(region, iw, ih);
            const group = new InstanceGroup();
            for (let y = 0; y < board.rows; y++) {
                for (let x = 0; x < board.cols; x++) {
                    group.push(x * size, y * size, region.sw, region.sh, u0, v0, u1, v1);
                }
            }
            this._gridGroup = group;
            this._gridTexture = texture;
            this._gridSize = size;
            this._gridRows = board.rows;
            this._gridCols = board.cols;
            this._gridSprite = sprite;
        }

        this._gridAddedThisFrame = true;
    }

    _spriteForCell(colorIndex, x, y, size, spriteCache, palette, {heightSaturation, glow, outline, rows}) {
        if (!colorIndex) return null;
        const color = palette[colorIndex];
        const level = heightSaturation ? Math.max(0, Math.min(20, (rows - 1) - y)) : 0;
        if (outline) {
            return glow
                ? spriteCache.getOutlineGlow(color, size, level, y)
                : spriteCache.getOutline(color, size, level);
        }
        return glow
            ? spriteCache.getGlow(color, size, level, y)
            : spriteCache.getRegion(color, size, level);
    }

    _updateBoardCell(cellIndex, x, y, sprite, size) {
        const prevGroup = this._cellGroup[cellIndex];
        const prevSlot = this._cellSlot[cellIndex];

        if (prevGroup) {
            const movedCell = prevGroup.removeSlot(prevSlot);
            if (movedCell >= 0) this._cellSlot[movedCell] = prevSlot;
        }

        if (!sprite) {
            this._cellGroup[cellIndex] = null;
            this._cellSlot[cellIndex] = -1;
            return;
        }

        const region = regionOf(sprite);
        const texture = this._texture(region.image);
        let group = this._persistentGroups.get(texture);
        if (!group) {
            group = new InstanceGroup();
            this._persistentGroups.set(texture, group);
        }

        const offsetX = (region.sw - size) * 0.5;
        const offsetY = (region.sh - size) * 0.5;
        const iw = region.image.width, ih = region.image.height;
        const slot = group.push(
            x * size - offsetX, y * size - offsetY, region.sw, region.sh,
            ...uvRect(region, iw, ih),
            cellIndex
        );
        this._cellGroup[cellIndex] = group;
        this._cellSlot[cellIndex] = slot;
    }

    _rebuildBoardFull(board, size, spriteCache, palette, cfg) {
        const cellCount = board.rows * board.cols;
        if (this._cellColor.length !== cellCount) {
            this._cellColor = new Int16Array(cellCount).fill(-1);
            this._cellGroup = new Array(cellCount).fill(null);
            this._cellSlot = new Int32Array(cellCount).fill(-1);
        }
        for (const group of this._persistentGroups.values()) group.reset();
        this._cellGroup.fill(null);
        this._cellSlot.fill(-1);

        const colors = board.colors;
        const cols = board.cols;
        for (let i = 0, len = colors.length; i < len; i++) {
            const colorIndex = colors[i];
            if (!colorIndex) continue;
            const y = (i / cols) | 0;
            const x = i - y * cols;
            const sprite = this._spriteForCell(colorIndex, x, y, size, spriteCache, palette, cfg);
            this._updateBoardCell(i, x, y, sprite, size);
        }
        this._cellColor.set(colors);
        this._boardRows = board.rows;
        this._boardCols = board.cols;
        this._boardVersion = board.version ?? -1;
    }

    _syncBoardFull(board, size, spriteCache, palette, cfg) {
        const fingerprint = size + "|" + board.rows + "|" + board.cols + "|" + cfg.heightSaturation
            + "|" + cfg.glow + "|" + cfg.outline + "|" + palette;

        if (this._boardFingerprint === fingerprint
            && this._boardVersion === (board.version ?? -1)
            && this._cellColor.length === board.rows * board.cols) {
            this._activeBoardGroups = this._persistentGroups;
            this._boardAddedThisFrame = true;
            return;
        }

        if (this._boardFingerprint !== fingerprint || this._cellColor.length !== board.rows * board.cols) {
            this._rebuildBoardFull(board, size, spriteCache, palette, cfg);
            this._boardFingerprint = fingerprint;
            this._boardVersion = board.version ?? -1;
            this._activeBoardGroups = this._persistentGroups;
            this._boardAddedThisFrame = true;
            return;
        }

        const colors = board.colors;
        const cellColor = this._cellColor;
        const cols = board.cols;
        for (let i = 0, len = colors.length; i < len; i++) {
            const c = colors[i];
            if (c === cellColor[i]) continue;
            const y = (i / cols) | 0;
            const x = i - y * cols;
            const sprite = this._spriteForCell(c, x, y, size, spriteCache, palette, cfg);
            this._updateBoardCell(i, x, y, sprite, size);
            cellColor[i] = c;
        }

        this._boardVersion = board.version ?? -1;
        this._activeBoardGroups = this._persistentGroups;
        this._boardAddedThisFrame = true;
    }

    _syncBoardRange(board, size, spriteCache, palette, cfg, minRow, maxRow, skipRows) {
        for (const group of this._rangeGroups.values()) group.reset();

        const firstRow = Math.max(0, minRow | 0);
        const lastRow = Math.min(board.rows - 1, maxRow | 0);
        for (let y = firstRow; y <= lastRow; y++) {
            if (skipRows?.has(y)) continue;
            for (let x = 0; x < board.cols; x++) {
                const colorIndex = board.colors[y * board.cols + x];
                if (!colorIndex) continue;
                const sprite = this._spriteForCell(colorIndex, x, y, size, spriteCache, palette, cfg);
                if (!sprite) continue;
                const region = regionOf(sprite);
                const texture = this._texture(region.image);
                let group = this._rangeGroups.get(texture);
                if (!group) {
                    group = new InstanceGroup();
                    this._rangeGroups.set(texture, group);
                }
                const offsetX = (region.sw - size) * 0.5;
                const offsetY = (region.sh - size) * 0.5;
                const iw = region.image.width, ih = region.image.height;
                group.push(
                    x * size - offsetX, y * size - offsetY, region.sw, region.sh,
                    ...uvRect(region, iw, ih)
                );
            }
        }

        this._activeBoardGroups = this._rangeGroups;
        this._boardAddedThisFrame = true;
    }

    addBoard(board, size, spriteCache, palette, {
        grid = true,
        heightSaturation = true,
        glow = true,
        outline = false,
        minRow = 0,
        maxRow = board.rows - 1,
        skipRows = null,
    } = {}) {
        this._size = size;
        const cfg = {heightSaturation, glow, outline, rows: board.rows};
        const isFullRange = minRow === 0 && maxRow === board.rows - 1 && !skipRows;

        if (isFullRange) {
            this._syncBoardFull(board, size, spriteCache, palette, cfg);
        } else {
            this._syncBoardRange(board, size, spriteCache, palette, cfg, minRow, maxRow, skipRows);
        }
    }

    flush() {
        if (!this._frameOpen) return;
        this._frameOpen = false;

        const gl = this.gl;
        gl.bindVertexArray(this.vao);
        gl.activeTexture(gl.TEXTURE0);

        if (this._gridAddedThisFrame && this._gridGroup && this._gridGroup.count) {
            this._drawGroup(this._gridTexture, this._gridGroup);
        }
        if (this._boardAddedThisFrame) {
            for (const [texture, group] of this._activeBoardGroups) {
                if (group.count) this._drawGroup(texture, group);
            }
        }
        for (const [texture, group] of this._transientGroups) {
            if (group.count) this._drawGroup(texture, group);
        }
        for (const [texture, byAlpha] of this._alphaGroups) {
            for (const group of byAlpha.values()) {
                if (group.count) this._drawGroup(texture, group);
            }
        }

        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindVertexArray(null);
    }

    _drawGroup(texture, group) {
        const gl = this.gl;
        const count = group.count;
        if (!count) return;

        if (!group.gpuRectBuffer) group.gpuRectBuffer = gl.createBuffer();
        if (!group.gpuUvBuffer) group.gpuUvBuffer = gl.createBuffer();

        if (!group.gpuVao) {
            group.gpuVao = gl.createVertexArray();
            gl.bindVertexArray(group.gpuVao);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
            gl.enableVertexAttribArray(this.aCorner);
            gl.vertexAttribPointer(this.aCorner, 2, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, group.gpuRectBuffer);
            gl.enableVertexAttribArray(this.aRect);
            gl.vertexAttribPointer(this.aRect, 4, gl.FLOAT, false, 0, 0);
            gl.vertexAttribDivisor(this.aRect, 1);

            gl.bindBuffer(gl.ARRAY_BUFFER, group.gpuUvBuffer);
            gl.enableVertexAttribArray(this.aUv);
            gl.vertexAttribPointer(this.aUv, 4, gl.FLOAT, false, 0, 0);
            gl.vertexAttribDivisor(this.aUv, 1);

            gl.bindVertexArray(null);
        }

        if (group.gpuDirty) {
            const required = Math.max(1, group.capacity);
            if (group.gpuCapacity < required) {
                const byteSize = required * 4 * Float32Array.BYTES_PER_ELEMENT;
                gl.bindBuffer(gl.ARRAY_BUFFER, group.gpuRectBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, byteSize, gl.DYNAMIC_DRAW);
                gl.bindBuffer(gl.ARRAY_BUFFER, group.gpuUvBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, byteSize, gl.DYNAMIC_DRAW);
                group.gpuCapacity = required;
            }

            const used = count * 4;
            gl.bindBuffer(gl.ARRAY_BUFFER, group.gpuRectBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, group.rects.subarray(0, used));
            gl.bindBuffer(gl.ARRAY_BUFFER, group.gpuUvBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, group.uvs.subarray(0, used));
            group.gpuDirty = false;
        }

        gl.bindVertexArray(group.gpuVao);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1f(this.uAlpha, group.alpha);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }

    clear() {
        const gl = this.gl;
        this._frameOpen = false;
        this._boardAddedThisFrame = false;
        this._gridAddedThisFrame = false;
        for (const group of this._transientGroups.values()) group.reset();
        this._alphaGroups.clear();
        gl.bindVertexArray(null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // Deprecated alias kept for callers that haven't moved to flush() yet.
    draw() {
        this.flush();
    }

    finish() {
        this.gl.finish();
    }

    destroy() {
        const gl = this.gl;
        for (const texture of this._allTextures) gl.deleteTexture(texture);
        gl.deleteBuffer(this.cornerBuffer);
        const groups = new Set();
        for (const group of this._persistentGroups.values()) groups.add(group);
        for (const group of this._rangeGroups.values()) groups.add(group);
        if (this._gridGroup) groups.add(this._gridGroup);
        for (const group of this._transientGroups.values()) groups.add(group);
        for (const byAlpha of this._alphaGroups.values()) for (const group of byAlpha.values()) groups.add(group);
        for (const group of groups) {
            if (group.gpuRectBuffer) gl.deleteBuffer(group.gpuRectBuffer);
            if (group.gpuUvBuffer) gl.deleteBuffer(group.gpuUvBuffer);
            if (group.gpuVao) gl.deleteVertexArray(group.gpuVao);
        }
        gl.deleteBuffer(this.rectBuffer);
        gl.deleteBuffer(this.uvBuffer);
        gl.deleteVertexArray(this.vao);
        gl.deleteProgram(this.program);
    }
}
