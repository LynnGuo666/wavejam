"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { JamEngine, type TrackInfo } from "@/lib/engine";
import { SONGS } from "@/lib/songs";
import { Conductor, type ConductorRange } from "@/lib/conductor";
import HandControl from "@/components/HandControl";
import Stage, { StageBus } from "@/components/Stage";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SOLO_KEYS = ["a", "s", "d", "f", "g", "h", "j", "k"];

/** 音乐上成立的变速挡位（相对原速的比例） */
const DETENT_RATIOS = [0.5, 0.75, 0.875, 1, 1.125, 1.25, 1.5, 1.6, 2];
const SNAP_TOLERANCE = 2.5; // BPM 在挡位 ±2.5 内自动吸附
const TAP_IDLE_MS = 3000; // 停按超过 3s 视为重新开始，下次重新定标

export default function Home() {
  const [engine] = useState(() => new JamEngine());
  const [bus] = useState(() => new StageBus());

  useEffect(() => {
    (window as unknown as { __engine: JamEngine }).__engine = engine;
  }, [engine]);

  const [songId, setSongId] = useState(SONGS[0].id);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "playing" | "paused">("idle");
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [bpm, setBpm] = useState(120);
  const [baseBpm, setBaseBpm] = useState(120);
  const [beat, setBeat] = useState(0);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [handActive, setHandActive] = useState(false);
  const [dynamics, setDynamicsLevel] = useState<number | null>(null);
  const [keyLabel, setKeyLabel] = useState("");
  const [soloFlash, setSoloFlash] = useState<number | null>(null);
  // 点按测速与挥手共用 Conductor：前 3 下定标，之后按相对倍率变速，同样防跳变
  const tapRangeRef = useRef<ConductorRange>({ minBpm: 60, maxBpm: 200, currentBpm: 120 });
  const tapBpmRef = useRef<(bpm: number) => void>(() => {});
  const tapperRef = useRef<Conductor | null>(null);
  const lastTapRef = useRef(0);
  const [tapCount, setTapCount] = useState(0);
  const [tapCalibrated, setTapCalibrated] = useState(false);

  const refreshTracks = useCallback(() => setTracks([...engine.tracks]), [engine]);

  const load = useCallback(
    async (sid?: string) => {
      const song = SONGS.find((s) => s.id === (sid ?? songId))!;
      setStatus("loading");
      engine.setHandlers({
        onBeat: (b) => {
          bus.emitBeat(b);
          setBeat(b);
        },
        onNote: (id) => bus.emitNote(id),
        onTrackReady: () => refreshTracks(),
        onTrackApplied: () => refreshTracks(),
        onBpmChange: (v) => setBpm(v),
        onEnded: () => {
          setStatus("ready");
          refreshTracks();
        },
      });
      await engine.load(song.file);
      setBaseBpm(engine.baseBpm);
      setBeatsPerBar(engine.beatsPerBar);
      setBpm(engine.baseBpm);
      setKeyLabel(`${NOTE_NAMES[engine.keyRoot]} ${engine.keyMinor ? "小调" : "大调"}`);
      refreshTracks();
      setStatus("ready");
      await engine.play();
      setStatus("playing");
    },
    [engine, bus, songId, refreshTracks]
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

  useEffect(() => {
    tapBpmRef.current = changeBpm;
    tapRangeRef.current = {
      minBpm: Math.round(baseBpm * 0.6),
      maxBpm: Math.round(baseBpm * 1.6),
      currentBpm: bpm,
    };
  });

  const tapTempo = useCallback(() => {
    const now = performance.now();
    if (!tapperRef.current) {
      tapperRef.current = new Conductor(() => tapRangeRef.current, {
        onTempo: (v) => tapBpmRef.current(v),
        onCalibrated: () => setTapCalibrated(true),
      });
    }
    const tapper = tapperRef.current;
    const fresh = now - lastTapRef.current > TAP_IDLE_MS;
    if (fresh) {
      tapper.reset();
      setTapCalibrated(false);
    }
    lastTapRef.current = now;
    setTapCount((c) => (fresh ? 1 : c + 1));
    tapper.tap(now);
  }, []);

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
        if (!e.repeat) tapTempo();
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "p") {
        togglePlay();
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

  const returnToBase = useCallback(() => {
    engine.returnToBase();
    engine.setDynamics(1, 2);
    setDynamicsLevel(null);
  }, [engine]);

  const changeDynamics = useCallback(
    (level: number) => {
      engine.setDynamics(level);
      setDynamicsLevel(level);
    },
    [engine]
  );

  const minBpm = Math.round(baseBpm * 0.5);
  const maxBpm = Math.round(baseBpm * 2);
  const handMinBpm = Math.round(baseBpm * 0.6);
  const handMaxBpm = Math.round(baseBpm * 1.6);
  const bpmRatio = baseBpm > 0 ? bpm / baseBpm : 1;
  const playing = status === "playing";
  const song = SONGS.find((s) => s.id === songId)!;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-serif text-4xl font-bold tracking-tight sm:text-5xl">
            WaveJam <span className="text-2xl font-normal text-mute sm:text-3xl">挥手即兴</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm text-mute">
            你挥手，乐队跟着你的速度演奏。点舞台上的乐器让它加入或退场，用键盘即兴一段 solo。
          </p>
        </div>
        <nav aria-label="选择歌曲" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex gap-2">
            {SONGS.map((s) => {
              const on = s.id === songId;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => selectSong(s.id)}
                    aria-pressed={on}
                    className={`flex flex-col whitespace-nowrap rounded-xl px-3 py-2 text-left transition ${
                      on ? "bg-ivory text-ink-deep" : "bg-panel/60 text-ivory hover:bg-panel"
                    }`}
                  >
                    <span className="text-sm font-semibold leading-tight">{s.title}</span>
                    <span className={`text-[11px] leading-tight ${on ? "text-ink-deep/60" : "text-mute"}`}>
                      {s.artist}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <section className="order-2 flex min-w-0 flex-col gap-5 lg:order-1">
          {tracks.length > 0 ? (
            <Stage tracks={tracks} playing={playing} bus={bus} onToggle={toggleTrack} />
          ) : (
            <div className="relative flex aspect-[4/5] flex-col sm:aspect-[16/10] items-center justify-center gap-5 overflow-hidden rounded-2xl bg-ink ring-1 ring-line">
              <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,rgba(255,93,143,0.07)_0_2px,transparent_2px_28px)]" />
              <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-amber/10 to-transparent" />
              <p className="relative font-serif text-2xl sm:text-3xl">{song.title}</p>
              {status === "loading" ? (
                <p className="relative text-sm text-mute">乐手正在入场…</p>
              ) : (
                <button
                  onClick={() => load()}
                  className="relative rounded-full bg-amber px-8 py-3 text-base font-bold text-ink-deep transition hover:brightness-110"
                >
                  开始演奏
                </button>
              )}
            </div>
          )}

          {tracks.length > 0 && (
            <div className="rounded-2xl bg-ink p-4 ring-1 ring-line sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-serif text-lg">即兴 solo</h2>
                <span className="text-xs text-mute">
                  {keyLabel}五声音阶，自动对齐到十六分音符，怎么弹都在调上
                </span>
              </div>
              <div className="mt-4 grid grid-cols-8 gap-1.5 sm:gap-2">
                {SOLO_KEYS.map((k, i) => (
                  <motion.button
                    key={k}
                    onClick={() => playSolo(i)}
                    animate={
                      soloFlash === i
                        ? { y: 4, backgroundColor: "#ff5d8f", color: "#0c0d26" }
                        : { y: 0, backgroundColor: "#f3eee3", color: "#0c0d26" }
                    }
                    transition={{ duration: 0.12 }}
                    className="flex h-24 flex-col items-center justify-end rounded-b-lg rounded-t-sm pb-2 shadow-[inset_0_-6px_0_rgba(12,13,38,0.15)] sm:h-28"
                  >
                    <span className="font-serif text-lg font-bold">{soloNoteName(i)}</span>
                    <kbd className="mt-0.5 font-sans text-[10px] uppercase opacity-50">{k}</kbd>
                  </motion.button>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="order-1 flex flex-col gap-5 lg:order-2">
          <HandControl
            minBpm={handMinBpm}
            maxBpm={handMaxBpm}
            currentBpm={bpm}
            onBpm={changeBpm}
            onDynamics={changeDynamics}
            onHandLost={returnToBase}
            onActiveChange={setHandActive}
          />

          <div className="rounded-2xl bg-ink p-5 ring-1 ring-line">
            <div className="flex items-end justify-between gap-3">
              <div className="flex items-baseline gap-2 font-serif">
                <span className="text-3xl text-amber">♩</span>
                <span className="text-2xl text-mute">=</span>
                <motion.span
                  key={playing ? beat : -1}
                  initial={{ scale: beat === 0 && playing ? 1.12 : 1.04 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.2 }}
                  className="inline-block origin-bottom-left text-6xl font-bold tabular-nums"
                >
                  {bpm}
                </motion.span>
              </div>
              <div className="pb-2 text-right">
                <p className="font-serif text-lg italic text-amber">
                  {tempoTerm(bpm)}
                  {dynamics !== null && handActive && (
                    <span className="ml-2 font-bold text-rose" title="力度：挥得越大越强">
                      {dynamicMark(dynamics)}
                    </span>
                  )}
                </p>
                <p className="text-xs tabular-nums text-mute">
                  {bpmRatio.toFixed(2)}× 原速 {baseBpm}
                </p>
              </div>
            </div>

            <div className="mt-4 flex gap-1.5" aria-hidden>
              {Array.from({ length: beatsPerBar }, (_, i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-full transition-colors duration-100 ${
                    playing && beat === i ? (i === 0 ? "bg-rose" : "bg-amber") : "bg-line"
                  }`}
                />
              ))}
            </div>

            <input
              type="range"
              aria-label="速度"
              min={minBpm}
              max={maxBpm}
              value={bpm}
              onChange={(e) => changeBpm(Number(e.target.value))}
              className="tempo mt-6 w-full"
            />
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-ink-deep p-1 text-sm">
              {[
                { r: 0.5, label: "½× 慢" },
                { r: 1, label: "原速" },
                { r: 2, label: "2× 快" },
              ].map(({ r, label }) => {
                const on = Math.abs(bpmRatio - r) < 0.02;
                return (
                  <button
                    key={r}
                    onClick={() => changeBpm(baseBpm * r)}
                    className={`rounded-lg py-1.5 font-medium transition ${
                      on ? "bg-panel text-amber" : "text-mute hover:text-ivory"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={togglePlay}
                disabled={status === "idle" || status === "loading"}
                className="rounded-xl bg-amber py-2.5 font-semibold text-ink-deep transition hover:brightness-110 disabled:opacity-30"
              >
                {playing ? "暂停" : "播放"}
              </button>
              <button
                onClick={tapTempo}
                className="flex flex-col items-center justify-center rounded-xl py-1.5 font-semibold text-ivory ring-1 ring-line transition hover:bg-panel active:bg-panel"
              >
                <span>点按测速</span>
                <span className="text-[10px] font-normal text-mute">
                  {tapCalibrated
                    ? "按快加速，按慢减速"
                    : tapCount > 0
                      ? `定基准 ${Math.min(tapCount, 3)}/3`
                      : "空格，先按 3 下定基准"}
                </span>
              </button>
            </div>
          </div>

          <dl className="hidden grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 px-1 text-xs text-mute lg:grid">
            <dt><kbd className="rounded bg-panel px-1.5 py-0.5 text-ivory">空格</kbd></dt>
            <dd>点按测速：先按 3 下定基准，之后按快加速、按慢减速</dd>
            <dt><kbd className="rounded bg-panel px-1.5 py-0.5 text-ivory">P</kbd></dt>
            <dd>播放 / 暂停</dd>
            <dt><kbd className="rounded bg-panel px-1.5 py-0.5 text-ivory">1–9</kbd></dt>
            <dd>乐器加入 / 退场，下个小节生效</dd>
            <dt><kbd className="rounded bg-panel px-1.5 py-0.5 text-ivory">A–K</kbd></dt>
            <dd>弹 solo</dd>
          </dl>
          {handActive && <span className="sr-only">手势控速中</span>}
        </aside>
      </div>
    </main>
  );
}

/** 力度记号：跟随指挥图示大小 */
function dynamicMark(level: number) {
  if (level < 0.2) return "pp";
  if (level < 0.4) return "p";
  if (level < 0.6) return "mp";
  if (level < 0.8) return "mf";
  return "f";
}

/** 按速度给出意大利文速度术语，像乐谱上的速度记号 */
function tempoTerm(bpm: number) {
  if (bpm < 60) return "Largo";
  if (bpm < 76) return "Adagio";
  if (bpm < 108) return "Andante";
  if (bpm < 120) return "Moderato";
  if (bpm < 156) return "Allegro";
  if (bpm < 176) return "Vivace";
  return "Presto";
}
