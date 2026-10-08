"use client";

import { memo, useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

interface HandControlProps {
  minBpm: number;
  maxBpm: number;
  /** 当前参考速度，用于把半速/倍速挥动折叠到最近的合理速度 */
  refBpm: number;
  onBpm: (bpm: number) => void;
  onIctus?: () => void;
  onHandLost?: () => void;
  onActiveChange?: (active: boolean) => void;
}

// WASM 版本必须与 npm 包一致，否则 JS/WASM 接口不匹配会直接加载失败
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// 拍点检测参数
const SMOOTH_ALPHA = 0.55; // 位置 EMA 平滑系数（越大越跟手）
const AMP_RATIO = 0.25; // 回弹幅度阈值 = 手掌尺寸 × 该比例（与离镜头远近无关）
const AMP_MIN = 0.02;
const AMP_MAX = 0.08;
const MIN_INTERVAL_MS = 280; // ~214 BPM
const MAX_INTERVAL_MS = 2000; // 30 BPM
const WINDOW_SIZE = 4; // 最近 4 个拍间隔，去掉最大最小后取均值
const TEMPO_JUMP = 0.35; // 新间隔偏离中位数超过 35% 视为换速，立即重新积累
const LOST_GRACE_MS = 500; // 手短暂丢失不算放下
const GPU_TIMEOUT_MS = 6000;
const TRAIL_MS = 900;
const MARK_MS = 700;

type Status = "off" | "loading" | "running" | "denied" | "error";

interface Pt {
  t: number;
  x: number;
  y: number;
}

function HandControl(props: HandControlProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>("off");
  const [handSeen, setHandSeen] = useState(false);
  const [beatCount, setBeatCount] = useState(0);
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);

  // 回调与参数走 ref，避免检测循环闭包拿到旧值
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  async function start() {
    if (status === "loading" || status === "running") return;
    setStatus("loading");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      });
    } catch (e) {
      console.error("camera failed", e);
      setStatus((e as DOMException)?.name === "NotAllowedError" ? "denied" : "error");
      return;
    }

    try {
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      const make = (delegate: "GPU" | "CPU") =>
        HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minTrackingConfidence: 0.4,
        });
      // 部分机器 GPU 初始化会一直挂起而不是报错，超时后降级到 CPU
      const landmarker = await withTimeout(make("GPU"), GPU_TIMEOUT_MS).catch((e) => {
        console.warn("GPU delegate unavailable, falling back to CPU", e);
        return make("CPU");
      });

      runLoop(video, landmarker, stream);
      setStatus("running");
    } catch (e) {
      console.error("hand landmarker failed", e);
      stream.getTracks().forEach((t) => t.stop());
      setStatus("error");
    }
  }

  function runLoop(video: HTMLVideoElement, landmarker: HandLandmarker, stream: MediaStream) {
    let alive = true;
    let lastVideoTime = -1;
    let lastTs = 0;

    // 跟踪状态（全部是循环内局部变量，不受 React 渲染影响）
    let seen = false;
    let lastSeenAt = 0;
    let smooth: Pt | null = null;
    const trail: Pt[] = [];
    const marks: Pt[] = [];
    // 下拍检测：手往下落到最低点再回弹 = 一拍（ictus）
    let phase: "down" | "up" = "down";
    let extreme: Pt | null = null;
    let lastIctus = 0;
    let intervals: number[] = [];
    let beats = 0;

    const resetTracking = () => {
      smooth = null;
      trail.length = 0;
      phase = "down";
      extreme = null;
      lastIctus = 0;
      intervals = [];
    };

    const emitIctus = (p: Pt) => {
      marks.push(p);
      beats++;
      setBeatCount(beats);
      propsRef.current.onIctus?.();

      const last = lastIctus;
      lastIctus = p.t;
      if (last === 0) return;
      const interval = p.t - last;
      if (interval < MIN_INTERVAL_MS) return;
      if (interval > MAX_INTERVAL_MS) {
        intervals = [];
        return;
      }
      if (intervals.length > 0) {
        const med = median(intervals);
        if (Math.abs(interval - med) / med > TEMPO_JUMP) intervals = [];
      }
      intervals.push(interval);
      if (intervals.length > WINDOW_SIZE) intervals.shift();
      if (intervals.length < 2) return;

      const { minBpm, maxBpm, refBpm, onBpm } = propsRef.current;
      const bpm = foldBpm(60000 / trimmedMean(intervals), refBpm, minBpm, maxBpm);
      setDetectedBpm(Math.round(bpm));
      onBpm(bpm);
    };

    const track = (raw: Pt, handSize: number) => {
      const s: Pt = smooth
        ? {
            t: raw.t,
            x: smooth.x + SMOOTH_ALPHA * (raw.x - smooth.x),
            y: smooth.y + SMOOTH_ALPHA * (raw.y - smooth.y),
          }
        : raw;
      smooth = s;
      trail.push(s);

      const amp = Math.min(AMP_MAX, Math.max(AMP_MIN, handSize * AMP_RATIO));
      // 图像坐标 y 向下为正：下落 = y 增大
      if (!extreme) {
        extreme = s;
      } else if (phase === "down") {
        if (s.y >= extreme.y) extreme = s;
        else if (extreme.y - s.y > amp) {
          if (extreme.t - lastIctus >= MIN_INTERVAL_MS * 0.8 || lastIctus === 0) emitIctus(extreme);
          phase = "up";
          extreme = s;
        }
      } else {
        if (s.y <= extreme.y) extreme = s;
        else if (s.y - extreme.y > amp) {
          phase = "down";
          extreme = s;
        }
      }
    };

    const draw = (now: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      while (trail.length && now - trail[0].t > TRAIL_MS) trail.shift();
      while (marks.length && now - marks[0].t > MARK_MS) marks.shift();

      // video 用 object-cover 镜像显示，这里做同样的映射
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      const scale = Math.max(w / vw, h / vh);
      const ox = (w - vw * scale) / 2;
      const oy = (h - vh * scale) / 2;
      const map = (p: Pt) => [w - (ox + p.x * vw * scale), oy + p.y * vh * scale] as const;

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 1; i < trail.length; i++) {
        const a = 1 - (now - trail[i].t) / TRAIL_MS;
        const [x0, y0] = map(trail[i - 1]);
        const [x1, y1] = map(trail[i]);
        ctx.strokeStyle = `rgba(255,181,71,${a * 0.9})`;
        ctx.lineWidth = 2 + a * 5;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      for (const m of marks) {
        const k = (now - m.t) / MARK_MS;
        const [x, y] = map(m);
        ctx.strokeStyle = `rgba(255,93,143,${1 - k})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, 8 + k * 26, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (trail.length) {
        const [x, y] = map(trail[trail.length - 1]);
        ctx.fillStyle = "#ffb547";
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const step = () => {
      if (!alive) return;
      const now = performance.now();
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        // detectForVideo 要求时间戳严格递增
        const ts = Math.max(now, lastTs + 1);
        lastTs = ts;
        const hand = landmarker.detectForVideo(video, ts).landmarks?.[0];
        if (hand) {
          lastSeenAt = now;
          if (!seen) {
            seen = true;
            resetTracking();
            setHandSeen(true);
            propsRef.current.onActiveChange?.(true);
          }
          // 掌心（手腕 + 四个指根均值）比单个手腕点稳定得多
          const ids = [0, 5, 9, 13, 17];
          const x = ids.reduce((a, i) => a + hand[i].x, 0) / ids.length;
          const y = ids.reduce((a, i) => a + hand[i].y, 0) / ids.length;
          const handSize = Math.hypot(hand[9].x - hand[0].x, hand[9].y - hand[0].y);
          track({ t: now, x, y }, handSize);
        } else if (seen && now - lastSeenAt > LOST_GRACE_MS) {
          seen = false;
          resetTracking();
          setHandSeen(false);
          setDetectedBpm(null);
          propsRef.current.onActiveChange?.(false);
          propsRef.current.onHandLost?.();
        }
      }
      draw(now);
      raf = requestAnimationFrame(step);
    };
    let raf = requestAnimationFrame(step);

    cleanupRef.current = () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      landmarker.close();
    };
  }

  function stop() {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (handSeen) {
      propsRef.current.onActiveChange?.(false);
      propsRef.current.onHandLost?.();
    }
    setHandSeen(false);
    setDetectedBpm(null);
    setStatus("off");
  }

  const running = status === "running";

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-ink-deep ring-1 ring-line">
      <video
        ref={videoRef}
        muted
        playsInline
        className={`absolute inset-0 h-full w-full -scale-x-100 object-cover transition-opacity duration-700 ${
          running ? "opacity-60" : "opacity-0"
        }`}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {!running && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <BatonGlyph />
          <button
            onClick={start}
            disabled={status === "loading"}
            className="rounded-full bg-amber px-5 py-2 text-sm font-semibold text-ink-deep transition hover:brightness-110 disabled:opacity-60"
          >
            {status === "loading" ? "正在打开摄像头…" : "打开摄像头指挥"}
          </button>
          <p className="max-w-[16rem] text-xs leading-relaxed text-mute">
            {status === "denied"
              ? "摄像头权限被拒绝。在浏览器地址栏允许摄像头后再试一次。"
              : status === "error"
                ? "手势模型没能加载，检查网络后再试一次。没有摄像头也可以用下方的点按测速。"
                : "手掌对着镜头上下挥，每次落到最低点就是一拍。"}
          </p>
        </div>
      )}

      {running && (
        <>
          <div className="absolute inset-x-3 top-3 flex items-center justify-between text-xs">
            <span
              className={`rounded-full px-2.5 py-1 font-medium backdrop-blur ${
                handSeen ? "bg-amber text-ink-deep" : "bg-ink-deep/70 text-ivory"
              }`}
            >
              {handSeen ? "跟随中" : "举起一只手"}
            </span>
            <button
              onClick={stop}
              className="rounded-full bg-ink-deep/70 px-2.5 py-1 text-mute backdrop-blur transition hover:text-ivory"
            >
              关闭摄像头
            </button>
          </div>
          <div className="absolute inset-x-3 bottom-3 flex items-end justify-between">
            <span className="flex gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-2 w-2 rounded-full transition-colors duration-150 ${
                    handSeen && beatCount > 0 && (beatCount - 1) % 4 === i ? "bg-rose" : "bg-ivory/25"
                  }`}
                />
              ))}
            </span>
            <span className="rounded-md bg-ink-deep/70 px-2 py-1 font-serif text-sm tabular-nums text-amber backdrop-blur">
              {handSeen
                ? detectedBpm !== null
                  ? `♩ = ${detectedBpm}`
                  : "再挥两拍…"
                : "手放下 = 回到原速"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default memo(HandControl);

function BatonGlyph() {
  // 4/4 指挥图示：1 下 → 2 左 → 3 右 → 4 上，每个落点是一拍
  const pts = [
    [60, 74],
    [30, 62],
    [92, 62],
    [62, 18],
  ];
  return (
    <svg viewBox="0 0 120 90" className="w-36 text-amber" fill="none" aria-hidden>
      <path
        d="M62 18 C61 40 60 62 60 74 C56 62 40 56 30 62 C46 70 78 70 92 62 C86 48 70 30 62 18"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2 4"
      />
      {pts.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="4" fill="currentColor" />
          <text x={x} y={y + 14} fontSize="9" textAnchor="middle" fill="currentColor" fillOpacity="0.8">
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      }
    );
  });
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

/** 半速/倍速挥动折叠到离参考速度最近、且在允许范围内的速度 */
function foldBpm(bpm: number, ref: number, min: number, max: number) {
  const candidates = [bpm / 2, bpm, bpm * 2].filter((b) => b >= min * 0.9 && b <= max * 1.1);
  const best = candidates.length
    ? candidates.reduce((a, b) => (Math.abs(Math.log(b / ref)) < Math.abs(Math.log(a / ref)) ? b : a))
    : bpm;
  return Math.min(max, Math.max(min, best));
}
