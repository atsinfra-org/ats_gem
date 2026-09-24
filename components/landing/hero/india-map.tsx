"use client";

import * as React from "react";
import { INDIA_VIEWBOX, indiaStates, type StateGeometry } from "@/lib/geo/india";
import type { StateSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";

const levels = [
  { min: 0, mix: 13 },
  { min: 500, mix: 26 },
  { min: 2000, mix: 44 },
  { min: 4000, mix: 66 },
  { min: 7000, mix: 90 },
];

function levelOf(live: number) {
  let level = 0;
  levels.forEach((l, i) => {
    if (live >= l.min) level = i;
  });
  return level;
}

function fillFor(level: number) {
  return `color-mix(in srgb, var(--color-primary) ${levels[level].mix}%, transparent)`;
}

interface MarkerSpec {
  /** Coastal markers get a label and a hit area extending out to sea; inland ones get a small dot-only hit area. */
  label?: { dx: number; anchor: "start" | "end" };
  at?: [number, number];
}

const MARKERS: Record<string, MarkerSpec> = {
  CH: {},
  DL: {},
  SK: {},
  GA: { label: { dx: -12, anchor: "end" } },
  DH: { label: { dx: -12, anchor: "end" } },
  PY: { label: { dx: 12, anchor: "start" } },
  LD: { label: { dx: -12, anchor: "end" }, at: [230, 865] },
  AN: { label: { dx: 22, anchor: "start" } },
};

const LABEL_MIN_AREA = 8000;
const INLAND_HIT_RADIUS = 9;
const LABEL_WIDTH = 24;

interface Shape extends StateGeometry {
  stat: StateSnapshot;
  x: number;
  y: number;
  level: number;
  marker?: MarkerSpec;
}

const arrowDirection: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

function nearestInDirection(shapes: Shape[], from: Shape, [dx, dy]: [number, number]) {
  let best: Shape | undefined;
  let bestScore = Infinity;
  for (const s of shapes) {
    if (s.code === from.code) continue;
    const vx = s.x - from.x;
    const vy = s.y - from.y;
    const along = vx * dx + vy * dy;
    if (along <= 0) continue;
    const across = Math.abs(vx * dy - vy * dx);
    if (across > along * 2) continue;
    const score = along + across * 1.5;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

export function IndiaMap({
  states,
  selected,
  onSelect,
  onHoverEnd,
  onOpen,
}: {
  states: StateSnapshot[];
  selected: string | null;
  /** `pinned` is true for keyboard and touch selections, which should persist after the pointer leaves. */
  onSelect: (code: string, pinned: boolean) => void;
  onHoverEnd: () => void;
  onOpen: (state: StateSnapshot) => void;
}) {
  const nodes = React.useRef(new Map<string, SVGGElement>());
  const lastPointer = React.useRef("mouse");
  const [tabStop, setTabStop] = React.useState("MH");

  const shapes = React.useMemo(() => {
    const byCode = new Map(states.map((s) => [s.code, s]));
    return indiaStates
      .flatMap((g): Shape[] => {
        const stat = byCode.get(g.code);
        if (!stat) return [];
        const marker = MARKERS[g.code];
        const [x, y] = marker?.at ?? [g.labelX, g.labelY];
        return [{ ...g, stat, x, y, marker, level: levelOf(stat.live) }];
      })
      .sort((a, b) => Number(Boolean(a.marker)) - Number(Boolean(b.marker)));
  }, [states]);

  const active = shapes.find((s) => s.code === selected);

  return (
    <div>
      <svg
        viewBox={INDIA_VIEWBOX}
        className="block h-auto w-full"
        role="group"
        aria-label="Live tenders by state. Use arrow keys to move between states, Enter to open."
        onPointerLeave={(e) => {
          if (e.pointerType !== "touch") onHoverEnd();
        }}
      >
        {shapes.map((s) => {
          const dimmed = selected !== null && selected !== s.code;
          return (
            <g
              key={s.code}
              ref={(el) => {
                if (el) nodes.current.set(s.code, el);
                else nodes.current.delete(s.code);
              }}
              role="button"
              tabIndex={tabStop === s.code ? 0 : -1}
              aria-label={`${s.stat.name}: ${s.stat.live.toLocaleString("en-IN")} live tenders, ₹${s.stat.closingWeekCr} crore closing this week`}
              className="cursor-pointer outline-none transition-opacity duration-200"
              style={{ opacity: dimmed ? 0.4 : 1 }}
              onPointerDown={(e) => {
                lastPointer.current = e.pointerType;
              }}
              onPointerEnter={(e) => {
                if (e.pointerType !== "touch") onSelect(s.code, false);
              }}
              onFocus={(e) => {
                setTabStop(s.code);
                // Pointer focus is handled by hover/tap; only keyboard focus should select here.
                if (e.currentTarget.matches(":focus-visible")) onSelect(s.code, true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(s.stat);
                  return;
                }
                const direction = arrowDirection[e.key];
                if (!direction) return;
                e.preventDefault();
                const next = nearestInDirection(shapes, s, direction);
                if (next) {
                  setTabStop(next.code);
                  nodes.current.get(next.code)?.focus();
                }
              }}
              onClick={() => {
                if (lastPointer.current === "touch" && selected !== s.code) {
                  onSelect(s.code, true);
                  return;
                }
                onOpen(s.stat);
              }}
            >
              <path
                d={s.d}
                className="stroke-ink transition-[fill] duration-200"
                style={{ fill: fillFor(s.level) }}
                strokeWidth={1}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {s.marker ? (
                <>
                  {s.marker.label ? (
                    <rect
                      x={s.marker.label.anchor === "end" ? s.x + s.marker.label.dx - LABEL_WIDTH : s.x - 8}
                      y={s.y - 11}
                      width={Math.abs(s.marker.label.dx) + LABEL_WIDTH + 8}
                      height={22}
                      fill="transparent"
                    />
                  ) : (
                    <circle cx={s.x} cy={s.y} r={INLAND_HIT_RADIUS} fill="transparent" />
                  )}
                  <circle
                    cx={s.x}
                    cy={s.y}
                    r={5.5}
                    style={{ fill: fillFor(Math.max(s.level, 2)) }}
                    stroke="rgba(255,255,255,0.85)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                  {s.marker.label && (
                    <text
                      x={s.x + s.marker.label.dx}
                      y={s.y}
                      textAnchor={s.marker.label.anchor}
                      dominantBaseline="central"
                      fontSize={18}
                      className="pointer-events-none hidden select-none fill-white/75 font-mono sm:inline"
                    >
                      {s.code}
                    </text>
                  )}
                </>
              ) : s.area >= LABEL_MIN_AREA ? (
                <text
                  x={s.x}
                  y={s.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={20}
                  className={cn(
                    "pointer-events-none hidden select-none font-mono sm:inline",
                    s.level >= 3 ? "fill-white" : "fill-white/75"
                  )}
                >
                  {s.code}
                </text>
              ) : null}
            </g>
          );
        })}

        {active && (
          <g pointerEvents="none">
            <path
              d={active.d}
              fill="none"
              stroke="#fff"
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {active.marker && (
              <circle
                cx={active.x}
                cy={active.y}
                r={9}
                fill="none"
                stroke="#fff"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        )}
      </svg>

      <div className="mt-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-white/55">
        <span>Live tenders</span>
        <span className="ml-1">&lt;500</span>
        <span className="flex gap-1">
          {levels.map((_, i) => (
            <span key={i} className="h-2.5 w-4 rounded-[2px]" style={{ backgroundColor: fillFor(i) }} />
          ))}
        </span>
        <span>7k+</span>
      </div>
    </div>
  );
}
