"use client";

import { memo, useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { Conductor, type Pt } from "@/lib/conductor";

interface HandControlProps {
  minBpm: number;
  maxBpm: number;
  /** 当前实际播放速度，手刚出现时以它为起点 */
  currentBpm: number;
  onBpm: (bpm: number) => void;
  /** 力度 0..1（挥得大 = 强） */
  onDynamics?: (level: number) => void;
  onIctus?: () => void;
  onHandLost?: () => void;
  onActiveChange?: (active: boolean) => void;
}

// WASM 版本必须与 npm 包一致，否则 JS/WASM 接口不匹配会直接加载失败
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const LOST_GRACE_MS = 500; // 手短暂丢失不算放下
const GPU_TIMEOUT_MS = 6000;
const TRAIL_MS = 900;
const MARK_MS = 700;

type Status = "off" | "loading" | "running" | "denied" | "error";

function HandControl(props: HandControlProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>("off");
  const [handSeen, setHandSeen] = useState(false);
  const [beatCount, setBeatCount] = useState(0);
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);
  /** 定标时的播放速度；null = 还在定标 */
  const [calibBpm, setCalibBpm] = useState<number | null>(null);
  const [swingsSinceSeen, setSwingsSinceSeen] = useState(0);
  const [rebounding, setRebounding] = useState(false);

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
    const trail: Pt[] = [];
    const marks: Pt[] = [];
    let beats = 0;
    let swings = 0;
    let reboundTimer: ReturnType<typeof setTimeout> | undefined;

    const conductor = new Conductor(() => propsRef.current, {
      onIctus: (p) => {
        marks.push(p);
        beats++;
        setBeatCount(beats);
        swings++;
        setSwingsSinceSeen(swings);
        propsRef.current.onIctus?.();
      },
      onTempo: (bpm, source) => {
        setDetectedBpm(Math.round(bpm));
        propsRef.current.onBpm(bpm);
        if (source === "rebound") {
          // 回弹预判触发：短暂提示“看到你抬手变速了”
          setRebounding(true);
          clearTimeout(reboundTimer);
          reboundTimer = setTimeout(() => setRebounding(false), 600);
        }
      },
      onCalibrated: () => {
        const bpm = propsRef.current.currentBpm;
        setCalibBpm(bpm);
        setDetectedBpm(Math.round(bpm));
      },
      onDynamics: (level) => propsRef.current.onDynamics?.(level),
    });

    const resetTracking = () => {
      conductor.reset();
      trail.length = 0;
      swings = 0;
      setSwingsSinceSeen(0);
      setCalibBpm(null);
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
          trail.push(conductor.push({ t: now, x, y }, handSize));
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
      clearTimeout(reboundTimer);
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
  const ratio = calibBpm && detectedBpm ? detectedBpm / calibBpm : 1;

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
                : "手掌对着镜头，按你舒服的快慢上下挥。先挥 3 下定基准，之后挥得比基准快就加速、慢就放慢；挥大声音强，挥小声音弱。"}
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
            {/* 定标中：3 个点逐个点亮；定标后：每挥一下闪一次 */}
            <span className="flex gap-1.5" aria-hidden>
              {calibBpm === null ? (
                [0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className={`h-2 w-2 rounded-full transition-colors duration-150 ${
                      handSeen && swingsSinceSeen > i ? "bg-amber" : "bg-ivory/25"
                    }`}
                  />
                ))
              ) : (
                <span key={beatCount} className="swing-dot h-2 w-2 rounded-full bg-rose" />
              )}
            </span>
            <span className="rounded-md bg-ink-deep/70 px-2 py-1 font-serif text-sm tabular-nums text-amber backdrop-blur">
              {!handSeen
                ? "手放下 = 回到原速"
                : calibBpm === null
                  ? "按舒服的快慢挥 3 下…"
                  : `${rebounding ? "抬手变速 " : ""}挥速 ×${ratio.toFixed(2)}`}
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
