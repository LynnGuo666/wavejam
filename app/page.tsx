"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { JamEngine, type TrackInfo } from "@/lib/engine";
import { SONGS } from "@/lib/songs";
import HandControl from "@/components/HandControl";

const TRACK_COLORS = [
  "bg-rose-500", "bg-amber-500", "bg-emerald-500", "bg-sky-500",
  "bg-violet-500", "bg-pink-500", "bg-lime-500", "bg-cyan-500",
  "bg-orange-500", "bg-indigo-500",
];

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SOLO_KEYS = ["a", "s", "d", "f", "g", "h", "j", "k"];

/** 音乐上成立的变速挡位（相对原速的比例） */
const DETENT_RATIOS = [0.5, 0.75, 0.875, 1, 1.125, 1.25, 1.5, 1.6, 2];
const SNAP_TOLERANCE = 2.5; // BPM 在挡位 ±2.5 内自动吸附

export default function Home() {
  const engineRef = useRef<JamEngine | null>(null);
  if (!engineRef.current) engineRef.current = new JamEngine();
  const engine = engineRef.current;

  useEffect(() => {
    (window as unknown as { __engine: JamEngine }).__engine = engine;
  }, [engine]);

  const [songId, setSongId] = useState(SONGS[0].id);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "playing" | "paused">("idle");
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [bpm, setBpm] = useState(120);
  const [baseBpm, setBaseBpm] = useState(120);
  const [beat, setBeat] = useState(0);
  const [handActive, setHandActive] = useState(false);
  const [keyLabel, setKeyLabel] = useState("");
  const [soloFlash, setSoloFlash] = useState<number | null>(null);
  const tapTimesRef = useRef<number[]>([]);

  const refreshTracks = useCallback(() => setTracks([...engine.tracks]), [engine]);

  const load = useCallback(
    async (sid?: string) => {
      const song = SONGS.find((s) => s.id === (sid ?? songId))!;
      setStatus("loading");
      engine.onBeat = (b) => setBeat(b);
      engine.onTrackReady = () => refreshTracks();
      engine.onTrackApplied = () => refreshTracks();
      engine.onBpmChange = (v) => setBpm(v);
      await engine.load(song.file);
      setBaseBpm(engine.baseBpm);
      setBpm(engine.baseBpm);
      setKeyLabel(`${NOTE_NAMES[engine.keyRoot]} ${engine.keyMinor ? "小调" : "大调"}`);
      refreshTracks();
      setStatus("ready");
      await engine.play();
      setStatus("playing");
    },
    [engine, songId, refreshTracks]
  );

  const selectSong = useCallback(
    (sid: string) => {
      if (sid === songId || status === "loading") return;
      setSongId(sid);
      if (status !== "idle") load(sid);
    },
    [songId, status, load]
  );

  const togglePlay = useCallback(async () => {
    if (status === "playing") {
      engine.pause();
      setStatus("paused");
    } else if (status === "paused" || status === "ready") {
      await engine.play();
      setStatus("playing");
    }
  }, [engine, status]);

  const changeBpm = useCallback(
    (v: number) => {
      // 磁性挡位：靠近音乐性比例（1×、3/4、2× 等）时自动吸附
      let snapped = v;
      for (const r of DETENT_RATIOS) {
        const detent = baseBpm * r;
        if (Math.abs(v - detent) <= SNAP_TOLERANCE) {
          snapped = detent;
          break;
        }
      }
      engine.setBpm(snapped);
      setBpm(Math.round(snapped));
    },
    [engine, baseBpm]
  );

  const tapTempo = useCallback(() => {
    const now = performance.now();
    const taps = tapTimesRef.current.filter((t) => now - t < 2500);
    taps.push(now);
    tapTimesRef.current = taps;
    if (taps.length >= 2) {
      const intervals = taps.slice(1).map((t, i) => t - taps[i]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const newBpm = Math.min(220, Math.max(40, 60000 / avg));
      changeBpm(newBpm);
    }
  }, [changeBpm]);

  const toggleTrack = useCallback(
    (id: number) => {
      engine.toggleTrack(id);
      refreshTracks();
    },
    [engine, refreshTracks]
  );

  const playSolo = useCallback(
    (degree: number) => {
      engine.playSolo(degree);
      setSoloFlash(degree);
      setTimeout(() => setSoloFlash(null), 180);
    },
    [engine]
  );

  const soloNoteName = useCallback(
    (degree: number) => {
      const scale = engine.scale;
      const pc = scale[degree % scale.length];
      return NOTE_NAMES[(engine.keyRoot + pc) % 12];
    },
    [engine]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "t") {
        tapTempo();
        return;
      }
      const soloIdx = SOLO_KEYS.indexOf(key);
      if (soloIdx >= 0 && status === "playing") {
        playSolo(soloIdx);
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= tracks.length) toggleTrack(tracks[n - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, tapTempo, toggleTrack, playSolo, tracks, status]);

  const minBpm = Math.round(baseBpm * 0.5);
  const maxBpm = Math.round(baseBpm * 2);
  const handMinBpm = Math.round(baseBpm * 0.6);
  const handMaxBpm = Math.round(baseBpm * 1.6);
  const bpmRatio = baseBpm > 0 ? bpm / baseBpm : 1;
  const playing = status === "playing";

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-6 text-zinc-100">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-emerald-400">
            全民K歌 · 即兴模式 · Demo
          </p>
          <h1 className="text-3xl font-bold">挥手即兴 WaveJam</h1>
          <p className="mt-1 text-sm text-zinc-400">
            不再跟伴奏 —— 伴奏跟着你。挥手控速，点击指挥声部进出。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {SONGS.map((s) => (
            <button
              key={s.id}
              onClick={() => selectSong(s.id)}
              className={`rounded-full px-3 py-1 text-sm transition ${
                s.id === songId
                  ? "bg-emerald-500 text-black font-semibold"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <section className="flex flex-col gap-4">
          <HandControl
            minBpm={handMinBpm}
            maxBpm={handMaxBpm}
            onBpm={(v) => changeBpm(v)}
            onHandLost={() => engine.returnToBase()}
            onActiveChange={setHandActive}
          />

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-baseline justify-between">
              <motion.div
                key={playing ? beat : -1}
                initial={{ scale: 1.25 }}
                animate={{ scale: 1 }}
                className="text-5xl font-black tabular-nums text-emerald-400"
              >
                {bpm}
              </motion.div>
              <span className="text-sm text-zinc-400">
                BPM · {bpmRatio.toFixed(2)}×（原速 {baseBpm}）
              </span>
            </div>
            <input
              type="range"
              min={minBpm}
              max={maxBpm}
              value={bpm}
              onChange={(e) => changeBpm(Number(e.target.value))}
              className="mt-3 w-full accent-emerald-500"
            />
            <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                <span
                  key={r}
                  className={Math.abs(bpmRatio - r) < 0.02 ? "text-emerald-400 font-bold" : ""}
                >
                  {r}×
                </span>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => changeBpm(baseBpm * 0.5)}
                className="flex-1 rounded-lg border border-zinc-700 py-1.5 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800"
              >
                ½× 慢速氛围
              </button>
              <button
                onClick={() => changeBpm(baseBpm)}
                className="flex-1 rounded-lg border border-zinc-700 py-1.5 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800"
              >
                1× 原速
              </button>
              <button
                onClick={() => changeBpm(baseBpm * 2)}
                className="flex-1 rounded-lg border border-zinc-700 py-1.5 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800"
              >
                2× 双倍速
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={togglePlay}
                disabled={status === "idle" || status === "loading"}
                className="flex-1 rounded-lg bg-emerald-500 py-2 font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-30"
              >
                {playing ? "暂停" : "播放"}（空格）
              </button>
              <button
                onClick={tapTempo}
                className="flex-1 rounded-lg border border-zinc-700 py-2 font-semibold text-zinc-200 transition hover:bg-zinc-800"
              >
                点按测速（T）
              </button>
            </div>
            <div className="mt-3 flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <motion.div
                  key={i}
                  animate={
                    playing && beat === i
                      ? { backgroundColor: "#10b981", scale: 1.3 }
                      : { backgroundColor: "#3f3f46", scale: 1 }
                  }
                  className="h-2 flex-1 rounded-full"
                />
              ))}
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          {status === "idle" && (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-700">
              <button
                onClick={() => load()}
                className="rounded-full bg-emerald-500 px-8 py-4 text-lg font-bold text-black transition hover:bg-emerald-400"
              >
                ▶ 加载并开始演奏
              </button>
            </div>
          )}
          {status === "loading" && (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-zinc-800 text-zinc-400">
              正在加载 MIDI 与音色…
            </div>
          )}
          {tracks.length > 0 && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <AnimatePresence>
                {tracks.map((t, i) => (
                  <motion.button
                    key={t.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => toggleTrack(t.id)}
                    className={`relative overflow-hidden rounded-xl border p-4 text-left transition ${
                      t.pendingMuted !== undefined
                        ? "border-amber-400 bg-zinc-800 animate-pulse"
                        : t.muted
                          ? "border-zinc-800 bg-zinc-900 opacity-40"
                          : "border-zinc-700 bg-zinc-800"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`inline-block h-3 w-3 rounded-full ${TRACK_COLORS[i % TRACK_COLORS.length]}`}
                      />
                      <span className="text-xs text-zinc-500">{i + 1}</span>
                    </div>
                    <div className="mt-2 font-semibold">{t.name}</div>
                    <div className="text-xs text-zinc-400">
                      {t.isDrums ? "鼓组" : t.instrument}
                      {t.isVocal && " · 留给你唱 🎤"}
                    </div>
                    {!t.muted && playing && (
                      <motion.div
                        key={beat}
                        initial={{ opacity: 0.35 }}
                        animate={{ opacity: 0 }}
                        className={`pointer-events-none absolute inset-0 ${TRACK_COLORS[i % TRACK_COLORS.length]}`}
                      />
                    )}
                    <div className="mt-2 text-xs text-zinc-500">
                      {t.pendingMuted !== undefined
                        ? "⏳ 下个小节生效"
                        : t.ready
                          ? t.muted
                            ? "已静音 · 点击加入"
                            : "演奏中 · 点击静音"
                          : "音色加载中…"}
                    </div>
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          )}
          {tracks.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="font-semibold">🎸 即兴 Solo 键盘</h2>
                <span className="text-xs text-zinc-400">
                  {keyLabel}五声音阶 · 音符自动卡进 16 分音符，怎么弹都在调上
                </span>
              </div>
              <div className="mt-3 grid grid-cols-8 gap-2">
                {SOLO_KEYS.map((k, i) => (
                  <motion.button
                    key={k}
                    onClick={() => playSolo(i)}
                    animate={
                      soloFlash === i
                        ? { scale: 0.92, backgroundColor: "#10b981" }
                        : { scale: 1, backgroundColor: "#27272a" }
                    }
                    transition={{ duration: 0.15 }}
                    className="flex flex-col items-center rounded-lg py-3 text-zinc-100 hover:bg-zinc-700"
                  >
                    <span className="font-bold">{soloNoteName(i)}</span>
                    <span className="mt-1 text-[10px] uppercase text-zinc-500">{k}</span>
                  </motion.button>
                ))}
              </div>
            </div>
          )}
          {tracks.length > 0 && (
            <p className="text-xs text-zinc-500">
              快捷键：空格 播放/暂停 · T 点按测速 · 数字 1-{tracks.length} 开关声部（下个小节生效）· A-K Solo
              {handActive && " · ✋ 手势控速中"}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
