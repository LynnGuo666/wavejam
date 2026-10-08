"use client";

import { useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

interface HandControlProps {
  minBpm: number;
  maxBpm: number;
  onBpm: (bpm: number) => void;
  onHandLost?: () => void;
  onActiveChange?: (active: boolean) => void;
}

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// 拍点检测参数
const VELOCITY_THRESHOLD = 0.15; // 归一化坐标/秒，低于此速度视为抖动
const REFRACTORY_MS = 240; // 拍点不应期（上限 ~250 BPM）
const MIN_INTERVAL_MS = 300; // 200 BPM
const MAX_INTERVAL_MS = 2000; // 30 BPM
const WINDOW_SIZE = 4; // 用最近 4 个拍间隔取中位数
const REVERSAL_COS = -0.3; // 速度向量夹角 > ~108° 视为反弹拐点

export default function HandControl({ minBpm, maxBpm, onBpm, onHandLost, onActiveChange }: HandControlProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"off" | "loading" | "running" | "error">("off");
  const [handSeen, setHandSeen] = useState(false);
  const [beatFlash, setBeatFlash] = useState(false);
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);
  const runningRef = useRef(false);
  // 手势跟踪状态
  const histRef = useRef<{ t: number; x: number; y: number }[]>([]);
  const lastIctusRef = useRef(0);
  const intervalsRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      runningRef.current = false;
    };
  }, []);

  function flashBeat() {
    setBeatFlash(true);
    setTimeout(() => setBeatFlash(false), 120);
  }

  /** 指挥拍点（ictus）检测：手腕运动方向急剧反转的拐点 = 一拍（与挥动方向无关） */
  function detectIctus(x: number, y: number, t: number) {
    const hist = histRef.current;
    hist.push({ t, x, y });
    while (hist.length > 2 && t - hist[0].t > 1000) hist.shift();
    if (hist.length < 3) return;

    // 相邻两段的 2D 速度向量
    const n = hist.length;
    const dt1 = (hist[n - 2].t - hist[n - 3].t) / 1000;
    const dt2 = (hist[n - 1].t - hist[n - 2].t) / 1000;
    if (dt1 <= 0 || dt2 <= 0) return;
    const v1x = (hist[n - 2].x - hist[n - 3].x) / dt1;
    const v1y = (hist[n - 2].y - hist[n - 3].y) / dt1;
    const v2x = (hist[n - 1].x - hist[n - 2].x) / dt2;
    const v2y = (hist[n - 1].y - hist[n - 2].y) / dt2;
    const s1 = Math.hypot(v1x, v1y);
    const s2 = Math.hypot(v2x, v2y);
    if (s1 < VELOCITY_THRESHOLD || s2 < VELOCITY_THRESHOLD * 0.4) return;

    // 方向反转：两段速度向量夹角足够大 = 拍点
    const cos = (v1x * v2x + v1y * v2y) / (s1 * s2);
    if (cos > REVERSAL_COS) return;
    if (t - lastIctusRef.current < REFRACTORY_MS) return;

    const last = lastIctusRef.current;
    lastIctusRef.current = t;
    flashBeat();
    if (last === 0) return; // 第一拍只作参照

    const interval = t - last;
    if (interval < MIN_INTERVAL_MS || interval > MAX_INTERVAL_MS) {
      intervalsRef.current = []; // 间隔异常，重新积累
      return;
    }
    const intervals = intervalsRef.current;
    intervals.push(interval);
    if (intervals.length > WINDOW_SIZE) intervals.shift();
    if (intervals.length < 2) return;

    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const bpm = Math.min(maxBpm, Math.max(minBpm, 60000 / median));
    setDetectedBpm(Math.round(bpm));
    onBpm(bpm);
  }

  async function start() {
    if (status === "loading" || status === "running") return;
    setStatus("loading");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
      });
      const video = videoRef.current;
      if (!video) throw new Error("no video element");
      video.srcObject = stream;
      await video.play();

      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      const landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
      });

      setStatus("running");
      runningRef.current = true;

      const loop = () => {
        if (!runningRef.current) return;
        const now = performance.now();
        if (video.readyState >= 2) {
          const result = landmarker.detectForVideo(video, now);
          const hand = result.landmarks?.[0];
          if (hand) {
            if (!handSeen) {
              setHandSeen(true);
              onActiveChange?.(true);
              histRef.current = [];
              intervalsRef.current = [];
              lastIctusRef.current = 0;
            }
            detectIctus(hand[0].x, hand[0].y, now); // 手腕
          } else if (handSeen) {
            setHandSeen(false);
            setDetectedBpm(null);
            onActiveChange?.(false);
            onHandLost?.();
          }
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    } catch (e) {
      console.error("hand control failed", e);
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full aspect-[4/3] overflow-hidden rounded-xl bg-zinc-900 border border-zinc-800">
        <video
          ref={videoRef}
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover -scale-x-100"
        />
        {/* 拍点闪烁反馈 */}
        {status === "running" && (
          <div
            className={`absolute inset-0 border-4 rounded-xl transition-opacity duration-150 ${
              beatFlash ? "border-emerald-400 opacity-100" : "border-emerald-400 opacity-0"
            }`}
          />
        )}
        {status !== "running" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              onClick={start}
              className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
            >
              {status === "loading" ? "模型加载中…" : status === "error" ? "摄像头不可用" : "开启手势指挥"}
            </button>
          </div>
        )}
        {status === "running" && (
          <>
            <div
              className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs ${
                handSeen ? "bg-emerald-500/90 text-black" : "bg-zinc-800/80 text-zinc-300"
              }`}
            >
              {handSeen ? "🪄 指挥中" : "伸出手，上下挥"}
            </div>
            {detectedBpm !== null && handSeen && (
              <div className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs text-emerald-400 tabular-nums">
                {detectedBpm} BPM
              </div>
            )}
          </>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        像指挥家一样挥动手腕——支持真实指挥图案（下-内-外-上），每次方向反转记一拍，挥多快伴奏就多快（{minBpm}–{maxBpm} BPM），手放下回归原速
      </p>
    </div>
  );
}
