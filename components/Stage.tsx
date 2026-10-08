"use client";

import { motion } from "motion/react";
import type { TrackInfo } from "@/lib/engine";

const PALETTE = [
  "#f43f5e", "#f59e0b", "#10b981", "#0ea5e9", "#8b5cf6",
  "#ec4899", "#84cc16", "#06b6d4", "#f97316", "#6366f1",
];

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

/** 弧形站位：鼓在后排正中，主唱前排正中，其余沿弧线展开，中间靠前 */
function layoutTracks(tracks: TrackInfo[]): Slot[] {
  const slots: Slot[] = tracks.map(() => ({ x: 50, y: 45, s: 1 }));
  const drumsIdx = tracks.findIndex((t) => t.isDrums);
  const vocalIdx = tracks.findIndex((t) => t.isVocal);
  if (drumsIdx >= 0) slots[drumsIdx] = { x: 50, y: 22, s: 1 };
  if (vocalIdx >= 0) slots[vocalIdx] = { x: 50, y: 68, s: 1.1 };

  const mids = tracks
    .map((_, i) => i)
    .filter((i) => i !== drumsIdx && i !== vocalIdx);
  if (mids.length === 0) return slots;

  // 有主唱时跳过弧线正中槽位，避免重叠
  const slotCount = vocalIdx >= 0 ? mids.length + 1 : mids.length;
  const angles: number[] = [];
  for (let i = 0; i < slotCount; i++) {
    const a = -66 + (132 * i) / Math.max(slotCount - 1, 1);
    if (vocalIdx >= 0 && Math.abs(a) < 132 / slotCount / 2 && slotCount > 1) continue;
    angles.push(a);
  }
  mids.forEach((idx, k) => {
    const a = ((angles[k] ?? 0) * Math.PI) / 180;
    const depth = Math.cos(a);
    slots[idx] = {
      x: 50 + 37 * Math.sin(a),
      y: 30 + 34 * depth,
      s: 0.72 + 0.38 * depth,
    };
  });
  return slots;
}

const SPOTLIGHTS = [
  { left: "12%", color: "16,185,129", duration: 5.2 },
  { left: "38%", color: "139,92,246", duration: 6.4 },
  { left: "64%", color: "245,158,11", duration: 5.8 },
];

interface StageProps {
  tracks: TrackInfo[];
  beat: number;
  playing: boolean;
  pulses: Record<number, number>;
  onToggle: (id: number) => void;
}

export default function Stage({ tracks, beat, playing, pulses, onToggle }: StageProps) {
  const slots = layoutTracks(tracks);

  return (
    <div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 select-none">
      {/* 背景墙 */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(39,39,42,0.9),transparent_60%)]" />
      {/* 地平线 */}
      <div className="absolute inset-x-0 top-[38%] h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
      {/* 透视地板 */}
      <div className="absolute inset-x-0 bottom-0 top-[38%] [perspective:400px]">
        <div className="absolute inset-0 origin-top [transform:rotateX(60deg)] bg-[repeating-linear-gradient(90deg,rgba(16,185,129,0.10)_0_1px,transparent_1px_44px),repeating-linear-gradient(0deg,rgba(16,185,129,0.07)_0_1px,transparent_1px_22px),linear-gradient(to_bottom,rgba(16,185,129,0.10),transparent)]" />
      </div>
      {/* 聚光灯：常亮摆动 + 随节拍呼吸 */}
      <motion.div
        key={playing ? beat : -1}
        initial={{ opacity: 0.9 }}
        animate={{ opacity: playing ? 0.45 : 0.45 }}
        transition={{ duration: 0.3 }}
        className="absolute inset-0"
      >
        {SPOTLIGHTS.map((s, i) => (
          <motion.div
            key={i}
            animate={{ rotate: [-3, 3, -3] }}
            transition={{ duration: s.duration, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-0 h-[72%] w-[36%] mix-blend-screen"
            style={{
              left: s.left,
              transformOrigin: "top center",
              background: `linear-gradient(to bottom, rgba(${s.color},0.35), rgba(${s.color},0.06) 55%, transparent 75%)`,
              clipPath: "polygon(46% 0, 54% 0, 100% 100%, 0 100%)",
            }}
          />
        ))}
      </motion.div>

      {/* 乐器 */}
      {tracks.map((t, i) => {
        const slot = slots[i];
        const color = PALETTE[i % PALETTE.length];
        const pulse = pulses[t.id] ?? 0;
        const active = !t.muted && t.ready;
        const pending = t.pendingMuted !== undefined;
        return (
          <motion.button
            key={t.id}
            layout
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => onToggle(t.id)}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
            style={{ left: `${slot.x}%`, top: `${slot.y}%`, zIndex: Math.round(slot.y) }}
          >
            <span className="relative flex items-center justify-center">
              {/* 脚下光晕 */}
              <span
                className="absolute -bottom-1 h-3 w-16 rounded-[50%] blur-md transition-opacity duration-500"
                style={{ background: color, opacity: active ? 0.45 : 0.08 }}
              />
              {/* 发声涟漪 */}
              {active && pulse > 0 && (
                <motion.span
                  key={pulse}
                  initial={{ opacity: 0.55, scale: 0.7 }}
                  animate={{ opacity: 0, scale: 1.5 }}
                  transition={{ duration: 0.45, ease: "easeOut" }}
                  className="absolute h-16 w-16 rounded-full border-2"
                  style={{ borderColor: color }}
                />
              )}
              {/* 排队提示圈 */}
              {pending && (
                <span className="absolute h-[4.5rem] w-[4.5rem] animate-pulse rounded-full border-2 border-dashed border-amber-400" />
              )}
              {/* 乐器本体：节拍起伏 + 发声弹跳 */}
              <motion.span
                key={playing && active ? beat : -1}
                initial={{ y: active && playing ? -2 : 0 }}
                animate={{ y: 0 }}
                transition={{ duration: 0.18 }}
                className="block"
              >
                <motion.span
                  key={pulse}
                  initial={{ scale: pulse > 0 ? 1.14 : 1 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className={`block transition-[opacity,filter] duration-500 ${
                    t.muted ? "opacity-30 grayscale" : ""
                  }`}
                  style={{ color, width: 56 * slot.s, height: 56 * slot.s }}
                >
                  <InstrumentIcon family={familyOf(t)} />
                </motion.span>
              </motion.span>
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm ${
                t.muted ? "text-zinc-500" : "text-zinc-100"
              }`}
              style={{ background: "rgba(9,9,11,0.65)" }}
            >
              {t.name}
            </span>
            <span className="text-[9px] text-zinc-500" style={{ background: "rgba(9,9,11,0.4)" }}>
              {pending
                ? "⏳ 下个小节生效"
                : !t.ready
                  ? "音色加载中…"
                  : t.muted
                    ? t.isVocal
                      ? "🎤 留给你唱 · 点击开麦"
                      : "已静音 · 点击加入"
                    : "演奏中"}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
