import * as Tone from "tone";
import { Midi } from "@tonejs/midi";
import Soundfont, { type Instrument } from "soundfont-player";

export interface TrackInfo {
  id: number;
  name: string;
  instrument: string;
  isDrums: boolean;
  isVocal: boolean;
  muted: boolean;
  /** 已排队等待下个小节生效的目标状态 */
  pendingMuted?: boolean;
  ready: boolean;
  noteCount: number;
}

interface Voice {
  trigger(midi: number, time: number, duration: number, velocity: number): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

const VOCAL_RE = /vox|vocal|lead|melody|voice|ooh|aah/i;
const FADE = 0.15;

const SOUNDFONT_ALIASES: Record<string, string> = {
  clavi: "clavinet",
};

function gmToSoundfontName(name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return SOUNDFONT_ALIASES[normalized] ?? normalized;
}

// MIDI.js 预渲染音色的 key 是降号音名（Db4、Bb3…）
const SF_NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
function midiToSfName(m: number) {
  return `${SF_NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
}

function prettifyInstrument(name: string): string {
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

class SynthVoice implements Voice {
  private synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle8" },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.8 },
  });
  private gain = new Tone.Gain(1);

  constructor() {
    this.synth.chain(this.gain, Tone.getDestination());
  }

  trigger(midi: number, time: number, duration: number, velocity: number) {
    this.synth.triggerAttackRelease(
      Tone.Frequency(midi, "midi").toFrequency(),
      Math.max(duration, 0.05),
      time,
      velocity
    );
  }

  setMuted(muted: boolean) {
    this.gain.gain.rampTo(muted ? 0 : 1, FADE);
  }

  dispose() {
    this.synth.dispose();
    this.gain.dispose();
  }
}

class SoundfontVoice implements Voice {
  private ctx: AudioContext;
  private gainNode: GainNode;
  private instrument: Instrument | null = null;
  private fallback: SynthVoice;
  muted = false;
  onReady?: (ok: boolean) => void;

  constructor(ctx: AudioContext, gmName: string, notes?: string[]) {
    this.ctx = ctx;
    this.gainNode = ctx.createGain();
    this.gainNode.connect(ctx.destination);
    this.fallback = new SynthVoice();
    Soundfont.instrument(ctx, gmToSoundfontName(gmName), {
      soundfont: "FluidR3_GM",
      destination: this.gainNode,
      notes,
    })
      .then((inst) => {
        this.instrument = inst;
        this.fallback.dispose();
        this.onReady?.(true);
      })
      .catch(() => {
        this.onReady?.(false);
      });
  }

  trigger(midi: number, time: number, duration: number, velocity: number) {
    if (this.instrument) {
      this.instrument.play(midi, time, { duration: Math.max(duration, 0.1), gain: velocity * 2 });
    } else {
      this.fallback.trigger(midi, time, duration, velocity);
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.gainNode.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, FADE / 3);
    this.fallback.setMuted(muted);
  }

  dispose() {
    this.gainNode.disconnect();
    this.fallback.dispose();
  }
}

class DrumVoice implements Voice {
  private kick = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 6 });
  private snare = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.17, sustain: 0 } });
  private hat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.02 }, harmonicity: 5.1 });
  private gain = new Tone.Gain(1);
  private lastKick = 0;
  private lastSnare = 0;
  private lastHat = 0;

  constructor() {
    for (const s of [this.kick, this.snare, this.hat]) s.connect(this.gain);
    this.hat.volume.value = -18;
    this.gain.toDestination();
  }

  // 同一音源重复触发的时刻必须严格递增，否则 Tone 会抛错
  private strict(last: number, time: number) {
    return time > last ? time : last + 0.005;
  }

  trigger(midi: number, time: number, _duration: number, velocity: number) {
    if (midi === 35 || midi === 36) {
      this.lastKick = this.strict(this.lastKick, time);
      this.kick.triggerAttackRelease("C1", 0.2, this.lastKick, velocity);
    } else if (midi === 38 || midi === 39 || midi === 40) {
      this.lastSnare = this.strict(this.lastSnare, time);
      this.snare.triggerAttackRelease(0.15, this.lastSnare, velocity);
    } else {
      this.lastHat = this.strict(this.lastHat, time);
      this.hat.triggerAttackRelease("G5", 0.05, this.lastHat, velocity * 0.7);
    }
  }

  setMuted(muted: boolean) {
    this.gain.gain.rampTo(muted ? 0 : 1, FADE);
  }

  dispose() {
    for (const s of [this.kick, this.snare, this.hat, this.gain]) s.dispose();
  }
}

/** 五声音阶 Solo 音色：FM 合成 + 跟随 BPM 的乒乓延迟 */
class LeadVoice {
  private synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 2,
    modulationIndex: 8,
    envelope: { attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.6 },
  });
  private delay = new Tone.PingPongDelay("8n.", 0.25);

  constructor() {
    this.delay.wet.value = 0.18;
    this.synth.volume.value = -6;
    this.synth.chain(this.delay, Tone.getDestination());
  }

  trigger(midi: number, time: number) {
    this.synth.triggerAttackRelease(Tone.Frequency(midi, "midi").toFrequency(), "8n", time, 0.8);
  }

  dispose() {
    this.synth.dispose();
    this.delay.dispose();
  }
}

const KEY_PC: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6,
  Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

// Krumhansl-Schmuckler 调性模板
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** 直方图与 24 个调性模板求相关，取最优 */
function estimateKey(hist: number[]): { root: number; minor: boolean } {
  const mean = hist.reduce((a, b) => a + b, 0) / 12;
  let best = { score: -Infinity, root: 0, minor: false };
  for (let root = 0; root < 12; root++) {
    for (const [profile, minor] of [[KS_MAJOR, false], [KS_MINOR, true]] as const) {
      const pMean = profile.reduce((a, b) => a + b, 0) / 12;
      let num = 0, dh = 0, dp = 0;
      for (let i = 0; i < 12; i++) {
        const h = hist[(i + root) % 12] - mean;
        const p = profile[i] - pMean;
        num += h * p;
        dh += h * h;
        dp += p * p;
      }
      const score = num / (Math.sqrt(dh * dp) || 1);
      if (score > best.score) best = { score, root, minor };
    }
  }
  return best;
}

export type EngineState = "idle" | "loading" | "ready" | "playing" | "paused";

export class JamEngine {
  tracks: TrackInfo[] = [];
  baseBpm = 120;
  bpm = 120;
  state: EngineState = "idle";
  keyRoot = 0;
  keyMinor = false;
  scale: number[] = [0, 2, 4, 7, 9];
  onBeat?: (beat: number) => void;
  /** 某轨实际发声时触发（已节流，用于 UI 演奏动画）；静音轨不触发 */
  onNote?: (id: number) => void;
  onTrackReady?: (id: number, ok: boolean) => void;
  onTrackApplied?: (id: number) => void;
  onBpmChange?: (bpm: number) => void;

  setHandlers(h: Pick<JamEngine, "onBeat" | "onNote" | "onTrackReady" | "onTrackApplied" | "onBpmChange">) {
    Object.assign(this, h);
  }

  private voices: Voice[] = [];
  private parts: Tone.Part[] = [];
  private midi: Midi | null = null;
  private lead: LeadVoice | null = null;
  private noteUiLast = new Map<number, number>();

  async load(url: string) {
    this.disposeSong();
    this.state = "loading";
    const buffer = await (await fetch(url)).arrayBuffer();
    const midi = new Midi(buffer);
    this.midi = midi;
    this.baseBpm = Math.round(midi.header.tempos[0]?.bpm ?? 120);
    this.bpm = this.baseBpm;
    this.detectKey(midi);

    const ctx = Tone.getContext().rawContext as AudioContext;
    let id = 0;
    const nameCount = new Map<string, number>();
    for (const track of midi.tracks) {
      if (track.notes.length === 0) continue;
      const isDrums = track.channel === 9;
      const baseName =
        track.name?.trim() ||
        (isDrums ? "Drums" : prettifyInstrument(track.instrument.name));
      const count = (nameCount.get(baseName) ?? 0) + 1;
      nameCount.set(baseName, count);
      const name = count > 1 ? `${baseName} ${count}` : baseName;
      const vocalSource = `${track.name ?? ""} ${track.instrument.name}`;
      const isVocal = !isDrums && VOCAL_RE.test(vocalSource);
      const info: TrackInfo = {
        id,
        name,
        instrument: isDrums ? "drums" : track.instrument.name,
        isDrums,
        isVocal,
        muted: isVocal,
        ready: isDrums,
        noteCount: track.notes.length,
      };

      let voice: Voice;
      if (isDrums) {
        voice = new DrumVoice();
      } else {
        const usedNotes = [...new Set(track.notes.map((n) => midiToSfName(n.midi)))];
        const sf = new SoundfontVoice(ctx, track.instrument.name, usedNotes);
        sf.onReady = (ok) => {
          info.ready = true;
          this.onTrackReady?.(info.id, ok);
        };
        voice = sf;
      }
      voice.setMuted(info.muted);

      const trackId = id;
      const events = track.notes.map((n) => [`${n.ticks}i`, n] as [string, typeof n]);
      const part = new Tone.Part((time, note) => {
        const secondsPerTick = 60 / (Tone.getTransport().bpm.value * midi.header.ppq);
        voice.trigger(note.midi, time, note.durationTicks * secondsPerTick, note.velocity);
        // 静音轨不调度 UI 回调；同轨 90ms 内只通知一次
        if (info.muted) return;
        const last = this.noteUiLast.get(trackId) ?? -1;
        if (time - last < 0.09) return;
        this.noteUiLast.set(trackId, time);
        Tone.getDraw().schedule(() => this.onNote?.(trackId), time);
      }, events);
      part.start(0);

      this.tracks.push(info);
      this.voices.push(voice);
      this.parts.push(part);
      id++;
    }

    const transport = Tone.getTransport();
    transport.bpm.value = this.bpm;
    transport.loop = true;
    transport.loopStart = 0;
    transport.loopEnd = `${midi.durationTicks}i`;
    let beat = 0;
    transport.scheduleRepeat((time) => {
      const b = beat++;
      Tone.getDraw().schedule(() => this.onBeat?.(b % 4), time);
    }, "4n");

    this.state = "ready";
  }

  /** 调性检测：优先读 MIDI key signature，缺失时用音符直方图估计 */
  private detectKey(midi: Midi) {
    const ks = midi.header.keySignatures?.[0] as
      | { key?: string; scale?: string }
      | undefined;
    if (ks?.key && KEY_PC[ks.key] !== undefined) {
      this.keyRoot = KEY_PC[ks.key];
      this.keyMinor = ks.scale === "minor";
    } else {
      const hist = new Array(12).fill(0);
      for (const t of midi.tracks) for (const n of t.notes) hist[n.midi % 12] += n.durationTicks;
      const est = estimateKey(hist);
      this.keyRoot = est.root;
      this.keyMinor = est.minor;
    }
    this.scale = this.keyMinor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  }

  async play() {
    await Tone.start();
    Tone.getTransport().start();
    this.state = "playing";
  }

  pause() {
    Tone.getTransport().pause();
    this.state = "paused";
  }

  setBpm(bpm: number) {
    this.bpm = Math.round(bpm);
    Tone.getTransport().bpm.rampTo(this.bpm, 0.4);
    this.onBpmChange?.(this.bpm);
  }

  /** 手放下后，用 ~1.5s 滑回原速 */
  returnToBase() {
    this.bpm = this.baseBpm;
    Tone.getTransport().bpm.rampTo(this.baseBpm, 1.5);
    this.onBpmChange?.(this.baseBpm);
  }

  /**
   * 小节对齐的声部开关（Launch Quantization）：
   * 播放中点击不立即生效，排队到下个小节边界淡入/淡出，保证节奏不错位
   */
  toggleTrack(id: number) {
    const info = this.tracks.find((t) => t.id === id);
    if (!info) return;
    const target = !(info.pendingMuted ?? info.muted);
    if (this.state !== "playing") {
      info.muted = target;
      info.pendingMuted = undefined;
      this.voices[id]?.setMuted(target);
      return;
    }
    if (info.pendingMuted !== undefined) {
      // 小节边界前改主意，直接改目标状态
      info.pendingMuted = target;
      return;
    }
    info.pendingMuted = target;
    Tone.getTransport().scheduleOnce(() => {
      info.muted = target;
      info.pendingMuted = undefined;
      this.voices[id]?.setMuted(target);
      this.onTrackApplied?.(id);
    }, "@1m");
  }

  /**
   * 五声音阶 Solo：degree 映射到当前调的五声音阶，
   * 音符量化到下一个 16 分音符触发 —— 怎么按都协和、永远在拍上
   */
  playSolo(degree: number) {
    if (!this.lead) this.lead = new LeadVoice();
    const oct = Math.floor(degree / this.scale.length);
    const pc = this.scale[degree % this.scale.length];
    let midiNote = 60 + this.keyRoot + pc + 12 * oct;
    while (midiNote > 84) midiNote -= 12;
    while (midiNote < 48) midiNote += 12;
    if (this.state === "playing") {
      Tone.getTransport().scheduleOnce((time) => {
        this.lead?.trigger(midiNote, time);
      }, "@16n");
    } else {
      this.lead.trigger(midiNote, Tone.now());
    }
  }

  private disposeSong() {
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    for (const p of this.parts) p.dispose();
    for (const v of this.voices) v.dispose();
    this.lead?.dispose();
    this.lead = null;
    this.parts = [];
    this.voices = [];
    this.tracks = [];
    this.noteUiLast.clear();
    this.state = "idle";
  }
}
