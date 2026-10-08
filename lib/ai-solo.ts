/**
 * AI 即兴对奏：Magenta MusicRNN 在浏览器本地运行。
 * 用户按 A-K 弹几个音 → 停顿后 AI 续写两小节旋律回应，
 * 音高吸附到当前调的五声音阶，节奏跟随当前 BPM。
 *
 * Magenta 通过 CDN 的预构建 UMD 包按需加载（与 soundfont/mediapipe 一致），
 * 避免把 tfjs 打进 bundle。
 */

export interface AiNote {
  pitch: number;
  startTime: number;
  endTime: number;
}

export type AiStatus = "idle" | "loading" | "ready" | "listening" | "thinking" | "error";

const SCRIPT_URL = "https://cdn.jsdelivr.net/npm/@magenta/music@1.23.1/dist/magentamusic.js";
const CHECKPOINT =
  "https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/basic_rnn";
const STEPS_PER_QUARTER = 4;
const CONTINUE_STEPS = 32; // 两小节
const TEMPERATURE = 1.1;
/** 停顿超过该时长视为乐句结束，触发 AI 回应 */
const PHRASE_GAP_MS = 1400;

interface MmSeqNote {
  pitch?: number;
  quantizedStartStep?: number;
  quantizedEndStep?: number;
}

interface MmQuantizedSequence {
  notes?: MmSeqNote[];
  totalQuantizedSteps: number;
}

interface MmMusicRNN {
  initialize(): Promise<void>;
  continueSequence(
    seq: MmQuantizedSequence,
    steps: number,
    temperature: number
  ): Promise<MmQuantizedSequence>;
}

interface Mm {
  MusicRNN: new (checkpoint: string) => MmMusicRNN;
  sequences: {
    quantizeNoteSequence(seq: unknown, stepsPerQuarter: number): MmQuantizedSequence;
  };
}

declare global {
  interface Window {
    mm?: Mm;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

interface PhraseContext {
  bpm: number;
  keyRoot: number;
  scale: number[];
}

/** 把音高吸附到最近的调内五声音阶音 */
function snapToScale(pitch: number, keyRoot: number, scale: number[]): number {
  let best = pitch;
  let bestDist = Infinity;
  for (let p = pitch - 6; p <= pitch + 6; p++) {
    if (!scale.includes((p - keyRoot + 120) % 12)) continue;
    const d = Math.abs(p - pitch);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

export class AiSolo {
  onStatus?: (s: AiStatus) => void;
  onPhrase?: (notes: AiNote[]) => void;

  private mm: Mm | null = null;
  private rnn: MmMusicRNN | null = null;
  private loadingPromise: Promise<boolean> | null = null;
  private phrase: { midi: number; time: number }[] = [];
  private phraseStart = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generating = false;
  private ctx: PhraseContext | null = null;

  /** 加载脚本和模型（首次开启时调用，约几秒） */
  ensureLoaded(): Promise<boolean> {
    if (this.rnn) return Promise.resolve(true);
    if (this.loadingPromise) return this.loadingPromise;
    this.onStatus?.("loading");
    this.loadingPromise = (async () => {
      try {
        if (!window.mm) await loadScript(SCRIPT_URL);
        this.mm = window.mm!;
        this.rnn = new this.mm.MusicRNN(CHECKPOINT);
        await this.rnn.initialize();
        this.onStatus?.("ready");
        return true;
      } catch (e) {
        console.error("AI solo model failed to load", e);
        this.loadingPromise = null;
        this.onStatus?.("error");
        return false;
      }
    })();
    return this.loadingPromise;
  }

  /** 记录用户弹的一个音；停顿后自动触发 AI 续写 */
  addNote(midi: number, ctx: PhraseContext) {
    if (!this.rnn || !this.mm) return;
    const now = performance.now() / 1000;
    if (this.phrase.length === 0) this.phraseStart = now;
    this.phrase.push({ midi, time: now - this.phraseStart });
    if (this.phrase.length > 16) this.phrase.shift();
    this.ctx = ctx;
    this.onStatus?.("listening");

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.generate(), PHRASE_GAP_MS);
  }

  private async generate() {
    if (!this.rnn || !this.mm || !this.ctx || this.generating) return;
    // 至少两个音才有"问答"的意义
    if (this.phrase.length < 2) return;
    const { bpm, keyRoot, scale } = this.ctx;
    const phrase = [...this.phrase];
    this.phrase = [];
    this.generating = true;
    this.onStatus?.("thinking");

    try {
      const totalTime = phrase[phrase.length - 1].time + 0.25;
      const seq = {
        notes: phrase.map((n) => ({
          pitch: n.midi,
          startTime: n.time,
          endTime: n.time + 0.2,
          velocity: 90,
        })),
        totalTime,
        tempos: [{ qpm: bpm }],
      };
      const quantized = this.mm.sequences.quantizeNoteSequence(seq, STEPS_PER_QUARTER);
      const continued = await this.rnn.continueSequence(
        quantized,
        CONTINUE_STEPS,
        TEMPERATURE
      );
      const stepSec = 60 / bpm / STEPS_PER_QUARTER;
      const originSteps = quantized.totalQuantizedSteps;
      const notes: AiNote[] = (continued.notes ?? [])
        .filter((n) => (n.quantizedStartStep ?? 0) >= originSteps)
        .map((n) => ({
          pitch: snapToScale(n.pitch ?? 60, keyRoot, scale),
          startTime: (n.quantizedStartStep ?? 0) * stepSec,
          endTime: (n.quantizedEndStep ?? 0) * stepSec,
        }))
        .filter((n) => n.endTime > n.startTime);
      if (notes.length > 0) this.onPhrase?.(notes);
      this.onStatus?.("ready");
    } catch (e) {
      console.error("AI solo generation failed", e);
      this.onStatus?.("error");
    } finally {
      this.generating = false;
    }
  }
}
