"use client";

import { memo, useEffect, useRef } from "react";
import type { TrackInfo } from "@/lib/engine";

const PALETTE = [
  "#ffb547", "#ff5d8f", "#7cc8ff", "#b69cff", "#5fe0b7",
  "#ff8a5c", "#f7e07a", "#ff9ed2", "#8fb3ff", "#c4f07a",
];

/**
 * 音符/节拍事件总线：高频事件直接驱动 DOM 动画，不经过 React 渲染
 * （每个音符一次 setState 会让整页每秒重渲染上百次）
 */
export class StageBus {
  private noteFns = new Set<(id: number) => void>();
  private beatFns = new Set<(beat: number) => void>();
  emitNote(id: number) {
    this.noteFns.forEach((f) => f(id));
  }
  emitBeat(beat: number) {
    this.beatFns.forEach((f) => f(beat));
  }
  onNote(f: (id: number) => void) {
    this.noteFns.add(f);
    return () => void this.noteFns.delete(f);
  }
  onBeat(f: (beat: number) => void) {
    this.beatFns.add(f);
    return () => void this.beatFns.delete(f);
  }
}

type Family =
  | "drums" | "vocal" | "keys" | "guitar" | "bass"
  | "strings" | "brass" | "reed" | "flute" | "synth" | "generic";

function familyOf(t: TrackInfo): Family {
  if (t.isDrums) return "drums";
  if (t.isVocal) return "vocal";
  const n = t.instrument.toLowerCase();
  if (/bass/.test(n)) return "bass";
  if (/piano|organ|harpsichord|clav|celesta|accordion|keyboard/.test(n)) return "keys";
  if (/guitar|banjo|mandolin|shamisen|sitar|koto/.test(n)) return "guitar";
  if (/violin|viola|cello|contrabass|strings|harp|ensemble|pizzicato/.test(n)) return "strings";
  if (/trumpet|trombone|tuba|horn|brass/.test(n)) return "brass";
  if (/sax|clarinet|oboe|bassoon|english horn/.test(n)) return "reed";
  if (/flute|piccolo|recorder|whistle|ocarina|pan/.test(n)) return "flute";
  if (/synth|lead|pad|fx/.test(n)) return "synth";
  return "generic";
}

const SVG_PROPS = {
  viewBox: "0 0 64 64",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 3,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function InstrumentIcon({ family }: { family: Family }) {
  switch (family) {
    case "drums":
      return (
        <svg {...SVG_PROPS}>
          <circle cx="32" cy="44" r="11" />
          <circle cx="32" cy="44" r="4" />
          <circle cx="18" cy="30" r="6" />
          <circle cx="46" cy="30" r="6" />
          <path d="M8 16h14" />
          <path d="M15 16v8" />
          <path d="M42 14h14" />
          <path d="M49 14v9" />
        </svg>
      );
    case "vocal":
      return (
        <svg {...SVG_PROPS}>
          <circle cx="32" cy="17" r="8" />
          <path d="M25 14h14M25 20h14" strokeWidth={2} />
          <path d="M32 25v21" />
          <path d="M32 46q0 6-7 6h-3M32 46q0 6 7 6h3" />
        </svg>
      );
    case "keys":
      return (
        <svg {...SVG_PROPS}>
          <rect x="6" y="24" width="52" height="18" rx="3" />
          <path d="M16 24v18M26 24v18M36 24v18M46 24v18" />
          <path d="M16 24v9M26 24v9M46 24v9M55 24v9" strokeWidth={5} />
        </svg>
      );
    case "guitar":
      return (
        <svg {...SVG_PROPS}>
          <circle cx="24" cy="44" r="11" />
          <circle cx="34" cy="36" r="8" />
          <path d="M38 31L54 8" />
          <path d="M51 5l6 6" />
          <circle cx="28" cy="41" r="3" />
        </svg>
      );
    case "bass":
      return (
        <svg {...SVG_PROPS}>
          <circle cx="22" cy="46" r="10" />
          <circle cx="31" cy="38" r="7" />
          <path d="M35 33L58 4" />
          <circle cx="26" cy="43" r="3" />
          <path d="M55 8l4-1M52 12l4-1" strokeWidth={2} />
        </svg>
      );
    case "strings":
      return (
        <svg {...SVG_PROPS}>
          <ellipse cx="27" cy="41" rx="10" ry="13" />
          <path d="M33 30L45 10" />
          <path d="M43 7l5 3" />
          <path d="M14 52L54 18" strokeWidth={2} />
        </svg>
      );
    case "brass":
      return (
        <svg {...SVG_PROPS}>
          <path d="M8 34h26" />
          <path d="M8 30v8" />
          <path d="M34 26l20-8v32l-20-10" />
          <path d="M20 34v-7M27 34v-7" strokeWidth={2.5} />
        </svg>
      );
    case "reed":
      return (
        <svg {...SVG_PROPS}>
          <path d="M18 8l6 5" />
          <path d="M24 13v19q0 14 13 14q11 0 11-11" />
          <path d="M48 29q7 0 7-7" />
          <circle cx="27" cy="20" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="27" cy="26" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="28" cy="32" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "flute":
      return (
        <svg {...SVG_PROPS}>
          <path d="M10 46L54 22" />
          <circle cx="22" cy="39.5" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="30" cy="35.1" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="38" cy="30.7" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="46" cy="26.4" r="1.3" fill="currentColor" stroke="none" />
          <path d="M12 44l-4 6" strokeWidth={2} />
        </svg>
      );
    case "synth":
      return (
        <svg {...SVG_PROPS}>
          <rect x="8" y="16" width="48" height="30" rx="4" />
          <circle cx="17" cy="25" r="2.5" />
          <circle cx="27" cy="25" r="2.5" />
          <circle cx="37" cy="25" r="2.5" />
          <circle cx="47" cy="25" r="2.5" />
          <path d="M14 34h36M14 40h36" strokeWidth={2} />
        </svg>
      );
    default:
      return (
        <svg {...SVG_PROPS}>
          <circle cx="22" cy="46" r="5" />
          <circle cx="46" cy="40" r="5" />
          <path d="M27 46V20M51 40V14" />
          <path d="M27 20l24-6" />
        </svg>
      );
  }
}

interface Slot {
  x: number;
  y: number;
  s: number;
}

/** 多排弧形站位：鼓在后排正中，主唱在最前排正中，其余按排展开；排间错位避免标签叠在一起 */
function layoutTracks(tracks: TrackInfo[]): Slot[] {
  const slots: Slot[] = tracks.map(() => ({ x: 50, y: 60, s: 1 }));
  const drumsIdx = tracks.findIndex((t) => t.isDrums);
  const vocalIdx = tracks.findIndex((t) => t.isVocal);
  if (drumsIdx >= 0) slots[drumsIdx] = { x: 50, y: 24, s: 0.95 };
  if (vocalIdx >= 0) slots[vocalIdx] = { x: 50, y: 86, s: 1.05 };

  const mids = tracks.map((_, i) => i).filter((i) => i !== drumsIdx && i !== vocalIdx);
  if (mids.length === 0) return slots;

  const PER_ROW = 6;
  const rows = Math.ceil(mids.length / PER_ROW);
  const perRow = Math.ceil(mids.length / rows);
  const yTop = rows === 1 ? 62 : 48;
  const yBottom = vocalIdx >= 0 ? 70 : 78;
  mids.forEach((idx, k) => {
    const r = Math.floor(k / perRow);
    const inRow = Math.min(perRow, mids.length - r * perRow);
    const c = k - r * perRow;
    const depth = rows === 1 ? 1 : r / (rows - 1); // 0 = 后排, 1 = 前排
    const spread = 30 + 8 * depth; // 前排更宽
    const stagger = rows > 1 && r % 2 === 1 ? 0.5 : 0;
    const u = inRow === 1 ? 0 : ((c + stagger) / (inRow - 1 + stagger * 2)) * 2 - 1; // -1..1
    slots[idx] = {
      x: 50 + spread * u,
      y: yTop + (yBottom - yTop) * depth - 5 * (1 - u * u) * 0.5,
      s: 0.78 + 0.22 * depth,
    };
  });
  return slots;
}

const SPOTLIGHTS = [
  { left: "8%", color: "255,181,71", duration: 7 },
  { left: "36%", color: "182,156,255", duration: 9 },
  { left: "62%", color: "255,93,143", duration: 8 },
];

interface StageProps {
  tracks: TrackInfo[];
  playing: boolean;
  bus: StageBus;
  onToggle: (id: number) => void;
}

interface InstrumentEls {
  bob: HTMLSpanElement | null;
  icon: HTMLSpanElement | null;
  ripple: HTMLSpanElement | null;
}

function Stage({ tracks, playing, bus, onToggle }: StageProps) {
  const slots = layoutTracks(tracks);
  const elsRef = useRef(new Map<number, InstrumentEls>());
  const stateRef = useRef({ tracks, playing });
  useEffect(() => {
    stateRef.current = { tracks, playing };
  });

  useEffect(() => {
    const els = elsRef.current;
    const offNote = bus.onNote((id) => {
      const e = els.get(id);
      e?.icon?.animate([{ transform: "scale(1.14)" }, { transform: "scale(1)" }], {
        duration: 220,
        easing: "ease-out",
      });
      e?.ripple?.animate(
        [
          { opacity: 0.55, transform: "scale(0.7)" },
          { opacity: 0, transform: "scale(1.5)" },
        ],
        { duration: 450, easing: "ease-out" }
      );
    });
    const offBeat = bus.onBeat(() => {
      const { tracks, playing } = stateRef.current;
      if (!playing) return;
      for (const t of tracks) {
        if (t.muted || !t.ready) continue;
        els.get(t.id)?.bob?.animate([{ transform: "translateY(-3px)" }, { transform: "translateY(0)" }], {
          duration: 180,
          easing: "ease-out",
        });
      }
    });
    return () => {
      offNote();
      offBeat();
    };
  }, [bus]);

  const setEl = (id: number, key: keyof InstrumentEls) => (el: HTMLSpanElement | null) => {
    const map = elsRef.current;
    const entry = map.get(id) ?? { bob: null, icon: null, ripple: null };
    entry[key] = el;
    map.set(id, entry);
  };

  return (
    <div className="relative aspect-[4/5] select-none sm:aspect-[16/10] overflow-hidden rounded-2xl bg-ink ring-1 ring-line">
      {/* 幕布 */}
      <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,rgba(255,93,143,0.05)_0_2px,transparent_2px_28px),radial-gradient(ellipse_at_50%_0%,rgba(42,31,92,0.9),transparent_65%)]" />
      {/* 台口 */}
      <div className="absolute inset-x-0 top-[38%] h-px bg-gradient-to-r from-transparent via-amber/50 to-transparent" />
      {/* 透视地板 */}
      <div className="absolute inset-x-0 bottom-0 top-[38%] [perspective:400px]">
        <div className="absolute inset-0 origin-top [transform:rotateX(60deg)] bg-[repeating-linear-gradient(90deg,rgba(255,181,71,0.09)_0_1px,transparent_1px_44px),repeating-linear-gradient(0deg,rgba(255,181,71,0.06)_0_1px,transparent_1px_22px),linear-gradient(to_bottom,rgba(255,181,71,0.08),transparent)]" />
      </div>
      {/* 聚光灯：纯 transform 的 CSS 动画，交给合成线程 */}
      {SPOTLIGHTS.map((s, i) => (
        <div
          key={i}
          className="spotlight pointer-events-none absolute top-0 h-[72%] w-[36%]"
          style={{
            left: s.left,
            animationDuration: `${s.duration}s`,
            background: `linear-gradient(to bottom, rgba(${s.color},0.22), rgba(${s.color},0.04) 55%, transparent 75%)`,
            clipPath: "polygon(46% 0, 54% 0, 100% 100%, 0 100%)",
          }}
        />
      ))}

      {/* 乐器 */}
      {tracks.map((t, i) => {
        const slot = slots[i];
        const color = PALETTE[i % PALETTE.length];
        const active = !t.muted && t.ready;
        const pending = t.pendingMuted !== undefined;
        const size = 56 * slot.s;
        return (
          <button
            key={t.id}
            onClick={() => onToggle(t.id)}
            aria-pressed={!t.muted}
            className="group absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-xl p-1 transition-[left,top] duration-500"
            style={{ left: `${slot.x}%`, top: `${slot.y}%`, zIndex: Math.round(slot.y) }}
          >
            <span className="relative flex items-center justify-center">
              {/* 脚下光晕（径向渐变代替 blur 滤镜） */}
              <span
                className="absolute -bottom-2 h-5 w-20 rounded-[50%] transition-opacity duration-500"
                style={{
                  background: `radial-gradient(closest-side, ${color}, transparent)`,
                  opacity: active ? 0.5 : 0.08,
                }}
              />
              {/* 发声涟漪 */}
              <span
                ref={setEl(t.id, "ripple")}
                className="absolute h-16 w-16 rounded-full border-2 opacity-0"
                style={{ borderColor: color }}
              />
              {pending && (
                <span className="absolute h-[4.5rem] w-[4.5rem] animate-pulse rounded-full border-2 border-dashed border-amber" />
              )}
              <span ref={setEl(t.id, "bob")} className="block">
                <span
                  ref={setEl(t.id, "icon")}
                  className={`block h-[calc(var(--size)*0.7)] w-[calc(var(--size)*0.7)] transition-[opacity,filter] duration-500 sm:h-(--size) sm:w-(--size) group-hover:brightness-125 ${
                    t.muted ? "opacity-30 grayscale" : ""
                  }`}
                  style={{ color, ["--size" as string]: `${size}px` }}
                >
                  <InstrumentIcon family={familyOf(t)} />
                </span>
              </span>
            </span>
            <span
              className={`max-w-[4.5rem] truncate rounded-full bg-ink-deep/80 px-1.5 py-0.5 text-[9px] sm:max-w-[7.5rem] sm:px-2 sm:text-[11px] font-semibold ${
                t.muted ? "text-mute" : "text-ivory"
              }`}
            >
              {t.name}
            </span>
            <span className="hidden h-3 text-[10px] leading-3 text-mute sm:block">
              {pending ? "下个小节生效" : !t.ready ? "加载中" : t.muted ? "点击加入" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default memo(Stage);
