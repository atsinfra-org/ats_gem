// Converts public/india.svg (Simplemaps) into a compact TypeScript geometry module.
// Usage: npm run geo:india
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(root, "public/india.svg");
const OUTPUT = resolve(root, "lib/geo/india.ts");

// Douglas–Peucker tolerance in SVG units. The map renders at ≤0.6px per unit, so this is sub-pixel.
const TOLERANCE = 0.5;
// Rings smaller than this (units²) are invisible specks, except for island territories we must keep.
const MIN_RING_AREA = 1;
const KEEP_ALL_RINGS = new Set(["LD", "AN", "PY", "DH", "GA"]);

// Simplemaps uses older ISO ids for a few states; map them to the codes the app uses.
const CODE_OVERRIDES = { INUT: "UK", INCT: "CG", INTG: "TS", INOR: "OD" };

const svg = readFileSync(SOURCE, "utf8");

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const codeOf = (id) => CODE_OVERRIDES[id] ?? id.replace(/^IN/, "");

function parseRings(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g);
  const rings = [];
  let ring = null;
  let x = 0, y = 0, sx = 0, sy = 0, cmd = "", i = 0;
  const num = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd === "z" || cmd === "Z") {
        x = sx;
        y = sy;
        ring = null;
        continue;
      }
    }
    switch (cmd) {
      case "M": case "m": {
        const nx = num(), ny = num();
        x = cmd === "M" ? nx : x + nx;
        y = cmd === "M" ? ny : y + ny;
        sx = x; sy = y;
        ring = [[x, y]];
        rings.push(ring);
        cmd = cmd === "M" ? "L" : "l";
        break;
      }
      case "L": x = num(); y = num(); ring.push([x, y]); break;
      case "l": x += num(); y += num(); ring.push([x, y]); break;
      case "H": x = num(); ring.push([x, y]); break;
      case "h": x += num(); ring.push([x, y]); break;
      case "V": y = num(); ring.push([x, y]); break;
      case "v": y += num(); ring.push([x, y]); break;
      default: throw new Error(`Unsupported path command "${cmd}"`);
    }
  }
  return rings;
}

function perpendicularDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(px - ax, py - ay);
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  let maxDist = 0, index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (dist > maxDist) { maxDist = dist; index = i; }
  }
  if (maxDist <= tolerance) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, index + 1), tolerance);
  const right = simplify(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

const ringArea = (ring) =>
  Math.abs(ring.reduce((sum, [x, y], i) => {
    const [nx, ny] = ring[(i + 1) % ring.length];
    return sum + x * ny - nx * y;
  }, 0)) / 2;

const fmt = (n) => {
  const s = (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
  return s.replace(/^(-?)0\./, "$1.");
};

function encode(rings) {
  return rings
    .map((ring) => {
      const pts = ring.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
      let out = `M${fmt(pts[0][0])} ${fmt(pts[0][1])}l`;
      const steps = [];
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0];
        const dy = pts[i][1] - pts[i - 1][1];
        if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue;
        steps.push(`${fmt(dx)} ${fmt(dy)}`);
      }
      out += steps.join(" ").replace(/ -/g, "-");
      return `${out}z`;
    })
    .join("");
}

const labelPoints = new Map(
  [...svg.matchAll(/<circle\b[^>]*>/g)]
    .map((m) => attrs(m[0]))
    .filter((a) => a.id?.startsWith("IN"))
    .map((a) => [codeOf(a.id), [parseFloat(a.cx), parseFloat(a.cy)]])
);

let bounds = [Infinity, Infinity, -Infinity, -Infinity];
let sourceChars = 0;

const states = [...svg.matchAll(/<path\b[^>]*>/g)].map((m) => {
  const a = attrs(m[0]);
  const code = codeOf(a.id);
  sourceChars += a.d.length;
  const rings = parseRings(a.d)
    .map((ring) => {
      const closed = simplify([...ring, ring[0]], TOLERANCE).slice(0, -1);
      return closed.length >= 3 ? closed : ring;
    })
    .filter((ring) => KEEP_ALL_RINGS.has(code) || ringArea(ring) >= MIN_RING_AREA);

  const xs = rings.flat().map((p) => p[0]);
  const ys = rings.flat().map((p) => p[1]);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  bounds = [Math.min(bounds[0], box[0]), Math.min(bounds[1], box[1]), Math.max(bounds[2], box[2]), Math.max(bounds[3], box[3])];

  const [labelX, labelY] = labelPoints.get(code) ?? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  return {
    code,
    d: encode(rings),
    labelX: Math.round(labelX * 10) / 10,
    labelY: Math.round(labelY * 10) / 10,
    area: Math.round((box[2] - box[0]) * (box[3] - box[1])),
  };
});

const pad = 10;
const viewBox = [
  Math.floor(bounds[0] - pad),
  Math.floor(bounds[1] - pad),
  Math.ceil(bounds[2] - bounds[0] + pad * 2),
  Math.ceil(bounds[3] - bounds[1] + pad * 2),
].join(" ");

const body = `// Generated by scripts/build-india-geo.mjs from public/india.svg — do not edit by hand.
// Map geometry © Simplemaps.com, free for commercial use: https://simplemaps.com/resources/svg-license

export interface StateGeometry {
  code: string;
  d: string;
  labelX: number;
  labelY: number;
  /** Bounding-box area in SVG units², used to decide which states are large enough for an inline label. */
  area: number;
}

export const INDIA_VIEWBOX = "${viewBox}";

export const indiaStates: StateGeometry[] = [
${states.map((s) => `  { code: "${s.code}", labelX: ${s.labelX}, labelY: ${s.labelY}, area: ${s.area}, d: "${s.d}" },`).join("\n")}
];
`;

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, body);

const outChars = states.reduce((sum, s) => sum + s.d.length, 0);
console.log(`${states.length} states · path data ${sourceChars.toLocaleString()} → ${outChars.toLocaleString()} chars · viewBox ${viewBox}`);
