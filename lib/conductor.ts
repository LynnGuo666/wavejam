/**
 * 指挥手势解析（纯逻辑，不依赖 DOM / React，便于离线测试）
 *
 * 按真实指挥的读法：
 * - 拍点（ictus）：手落到最低点再回弹的那一刻，拍间隔决定速度
 * - 回弹（rebound）：拍后上抬的快慢预告下一拍何时到来——抬得快 = 要加速，抬得慢 = 要放慢。
 *   乐手看的就是这个，所以拍后手一抬过半高就提前调整速度，不必等下一拍落下。
 *   计时用“落拍弹跳宽度”：下落穿过半高 → 触底 → 上抬穿过半高。两个穿越点都在手速最快处，
 *   插值后到亚帧精度，也不受拍点落在哪一帧的影响（顶点是平的、拍点受帧率量化，都不准）
 * - 图示大小：挥得大 = 强（f），挥得小 = 弱（p）
 */

export interface Pt {
  t: number;
  x: number;
  y: number;
}

export interface ConductorRange {
  minBpm: number;
  maxBpm: number;
  /** 当前实际播放速度：手刚出现时以它为起点，避免第一下就跳变 */
  currentBpm: number;
  /** 挥一下管几拍：1 = 每拍一挥；2 = 两拍一挥；4 = 一小节一挥（省力） */
  beatsPerGesture: number;
}

export interface ConductorHandlers {
  onIctus?: (p: Pt) => void;
  onTempo?: (bpm: number, source: "beat" | "rebound") => void;
  /** 力度 0..1（0 = pp，1 = f） */
  onDynamics?: (level: number) => void;
}

const SMOOTH_ALPHA = 0.55; // 位置 EMA 平滑系数（越大越跟手）
const AMP_RATIO = 0.25; // 回弹幅度阈值 = 手掌尺寸 × 该比例（与离镜头远近无关）
const AMP_MIN = 0.02;
const AMP_MAX = 0.08;
// 以下是“两次挥动之间”的物理间隔，不是拍间隔
const MIN_INTERVAL_MS = 280; // 手再快也挥不过这个
const MAX_INTERVAL_MS = 2000; // 每拍一挥时的上限；几拍一挥时按拍数放宽（最多 4s）
const maxInterval = (k: number) => Math.min(4000, MAX_INTERVAL_MS * k);
const WINDOW_SIZE = 4;
const TEMPO_JUMP = 0.25; // 新间隔偏离中位数超过 25% 视为换速，立即重新积累
const RECENT_WEIGHT = 0.35; // 最新一拍在速度估计里的权重，越大越跟手
// 回弹预测
const REBOUND_RATIO_INIT = 0.35; // 弹跳宽度 / 拍间隔 的初值（每个人挥法不同，逐拍学习）
const REBOUND_LEARN = 0.3;
const REBOUND_TRIGGER = 0.1; // 预测速度与当前偏差超过 10% 才提前调整
const REBOUND_MIN_SAMPLES = 3; // 学到至少 3 下的挥法比例后才开始预测
const REBOUND_BLEND = 0.6; // 提前调整时向预测值靠近的比例
// 力度：一拍的垂直幅度 / 手掌尺寸
const DYN_SOFT = 0.4; // 小于此为 pp
const DYN_FULL = 1.6; // 大于此为 f
const DYN_SMOOTH = 0.5;
const DYN_MAX_STEP = 0.2; // 力度每拍最多变 0.2（约一个力度记号）
// 防跳变：速度只能渐变，不能突变
const TEMPO_MAX_STEP = 0.08; // 每次更新最多变 8%
const REBOUND_MAX_STEP = 0.04; // 回弹预判只是提前“推一把”，每次最多 4%
const TEMPO_OUTLIER = 0.2; // 偏离当前超过 20% 视为可疑：拍点需连续两下同向确认，回弹预测直接忽略

export class Conductor {
  private smooth: Pt | null = null;
  private phase: "down" | "up" = "down";
  private extreme: Pt | null = null;
  private lastIctus: Pt | null = null;
  private intervals: number[] = [];
  private bpm: number | null = null;
  private pendingDir: -1 | 0 | 1 = 0; // 等待确认的大幅变速方向
  private reboundRatio = REBOUND_RATIO_INIT;
  private reboundSamples = 0;
  private reboundDur: number | null = null; // 本拍的弹跳宽度，待下一拍落下后用来学习比例
  private halfLevel: number | null = null; // 上一拍“半高”的 y 值
  private downCross: number | null = null; // 本拍下落穿过半高的时刻
  private dynamics: number | null = null;
  private gestureBeats = 1;

  constructor(
    private getRange: () => ConductorRange,
    private handlers: ConductorHandlers = {}
  ) {}

  /** 平滑后的最新位置（用于画轨迹） */
  get position() {
    return this.smooth;
  }

  get currentBpm() {
    return this.bpm;
  }

  reset() {
    this.smooth = null;
    this.phase = "down";
    this.extreme = null;
    this.lastIctus = null;
    this.intervals = [];
    this.bpm = null;
    this.reboundDur = null;
    this.halfLevel = null;
    this.downCross = null;
    this.dynamics = null;
    this.reboundSamples = 0;
    this.pendingDir = 0;
  }

  push(raw: Pt, handSize: number): Pt {
    const prev = this.smooth;
    const s: Pt = prev
      ? {
          t: raw.t,
          x: prev.x + SMOOTH_ALPHA * (raw.x - prev.x),
          y: prev.y + SMOOTH_ALPHA * (raw.y - prev.y),
        }
      : raw;
    this.smooth = s;

    const amp = Math.min(AMP_MAX, Math.max(AMP_MIN, handSize * AMP_RATIO));
    const ext = this.extreme;
    // 图像坐标 y 向下为正：下落 = y 增大
    if (!ext) {
      this.extreme = s;
    } else if (this.phase === "down") {
      const L = this.halfLevel;
      if (prev && L !== null && this.downCross === null && prev.y < L && s.y >= L) {
        this.downCross = crossTime(prev, s, L);
      }
      if (s.y >= ext.y) this.extreme = s;
      else if (ext.y - s.y > amp) {
        const last = this.lastIctus;
        if (!last || ext.t - last.t >= MIN_INTERVAL_MS * 0.8) this.ictus(ext);
        this.phase = "up";
        this.extreme = s;
      }
    } else {
      const L = this.halfLevel;
      if (prev && L !== null && this.downCross !== null && prev.y > L && s.y <= L) {
        this.rebound(crossTime(prev, s, L) - this.downCross);
        this.halfLevel = null;
      }
      if (s.y <= ext.y) this.extreme = s;
      else if (s.y - ext.y > amp) {
        this.apex(ext, handSize);
        this.phase = "down";
        this.extreme = s;
      }
    }
    return s;
  }

  /** 拍点：用实测拍间隔更新速度，并学习“回弹时长 / 拍间隔”比例 */
  private ictus(p: Pt) {
    this.handlers.onIctus?.(p);
    const last = this.lastIctus;
    this.lastIctus = p;
    if (!last) return;

    const interval = p.t - last.t;
    const rebound = this.reboundDur;
    this.reboundDur = null;
    const k = this.getRange().beatsPerGesture;
    if (k !== this.gestureBeats) {
      // 换了挥法，旧的间隔和回弹比例都不再适用
      this.gestureBeats = k;
      this.intervals = [];
      this.reboundSamples = 0;
    }
    // 间隔异常（漏检、多检或突然换速）：这一下的回弹不可信，清空已学的挥法比例重新学，期间不做回弹预测
    const anomalous =
      interval < MIN_INTERVAL_MS ||
      interval > maxInterval(k) ||
      (this.intervals.length > 0 && Math.abs(interval - median(this.intervals)) / median(this.intervals) > TEMPO_JUMP);
    if (anomalous) {
      this.intervals = [];
      this.reboundSamples = 0;
      if (interval < MIN_INTERVAL_MS || interval > maxInterval(k)) return;
    } else if (rebound !== null) {
      const r = clamp(rebound / interval, 0.1, 0.8);
      this.reboundRatio = this.reboundSamples === 0 ? r : this.reboundRatio + REBOUND_LEARN * (r - this.reboundRatio);
      this.reboundSamples++;
    }
    this.intervals.push(interval);
    if (this.intervals.length > WINDOW_SIZE) this.intervals.shift();
    if (this.intervals.length < 2) return;

    const est = RECENT_WEIGHT * interval + (1 - RECENT_WEIGHT) * trimmedMean(this.intervals);
    this.emitTempo((60000 * k) / est, "beat");
  }

  /** 回弹顶点：记录这一拍的幅度，更新力度 */
  private apex(p: Pt, handSize: number) {
    const last = this.lastIctus;
    if (!last || p.t <= last.t) return;
    const amp = last.y - p.y;
    this.halfLevel = p.y + amp / 2;
    this.downCross = null;
    const level = clamp((amp / Math.max(handSize, 1e-3) - DYN_SOFT) / (DYN_FULL - DYN_SOFT), 0, 1);
    this.dynamics =
      this.dynamics === null
        ? level
        : this.dynamics + clamp(DYN_SMOOTH * (level - this.dynamics), -DYN_MAX_STEP, DYN_MAX_STEP);
    this.handlers.onDynamics?.(this.dynamics);
  }

  /** 拍后手抬过半高：弹跳越窄（抬得越快），预示下一拍越早到 */
  private rebound(dur: number) {
    if (dur <= 0) return;
    this.reboundDur = dur;
    // 还没建立稳定速度时不预测
    if (this.bpm === null || this.reboundSamples < REBOUND_MIN_SAMPLES) return;
    const predictedInterval = dur / this.reboundRatio;
    const k = this.gestureBeats;
    if (predictedInterval < MIN_INTERVAL_MS || predictedInterval > maxInterval(k)) return;
    const predicted = (60000 * k) / predictedInterval;
    if (Math.abs(predicted - this.bpm) / this.bpm < REBOUND_TRIGGER) return;
    this.emitTempo(this.bpm + REBOUND_BLEND * (predicted - this.bpm), "rebound");
  }

  private emitTempo(raw: number, source: "beat" | "rebound") {
    const { minBpm, maxBpm, currentBpm } = this.getRange();
    // 手刚出现还没建立速度时，以当前播放速度为基准
    const base = this.bpm ?? currentBpm;
    // 不做半速/倍速折叠：挥法由 beatsPerGesture 明确指定；漏检/多检造成的翻倍或减半交给下面的离群确认
    let bpm = clamp(raw, minBpm, maxBpm);

    const change = bpm / base - 1;
    if (Math.abs(change) > TEMPO_OUTLIER) {
      if (source === "rebound") return;
      const dir = change > 0 ? 1 : -1;
      if (this.pendingDir !== dir) {
        // 单独一下大幅偏离多半是误检，等下一下同向再信
        this.pendingDir = dir;
        return;
      }
      // 已确认的持续变速：保留方向，后续同向更新不必再等
    } else {
      this.pendingDir = 0;
    }
    const step = source === "rebound" ? REBOUND_MAX_STEP : TEMPO_MAX_STEP;
    bpm = clamp(bpm, base * (1 - step), base * (1 + step));
    bpm = clamp(bpm, minBpm, maxBpm);
    this.bpm = bpm;
    this.handlers.onTempo?.(bpm, source);
  }

}

/** 线性插值出亚帧精度的穿越时刻 */
function crossTime(a: Pt, b: Pt, level: number) {
  const k = (level - a.y) / (b.y - a.y || 1e-6);
  return a.t + clamp(k, 0, 1) * (b.t - a.t);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** 去掉最大最小值后取均值：比中位数更不受帧率量化影响 */
function trimmedMean(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >= 4 ? s.slice(1, -1) : s;
  return k.reduce((a, b) => a + b, 0) / k.length;
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
