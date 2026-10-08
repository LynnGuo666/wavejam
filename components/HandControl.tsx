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

export default function HandControl({ minBpm, maxBpm, onBpm, onHandLost, onActiveChange }: HandControlProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"off" | "loading" | "running" | "error">("off");
  const [handSeen, setHandSeen] = useState(false);
  const smoothRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    return () => {
      runningRef.current = false;
    };
  }, []);

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
            }
            // 手腕纵坐标：y 越小手越高 → BPM 越快
            const y = hand[0].y;
            const norm = Math.min(1, Math.max(0, (0.85 - y) / 0.55));
            const target = minBpm + norm * (maxBpm - minBpm);
            const prev = smoothRef.current ?? target;
            const smoothed = prev + (target - prev) * 0.25;
            smoothRef.current = smoothed;
            onBpm(smoothed);
          } else if (handSeen) {
            setHandSeen(false);
            onActiveChange?.(false);
            smoothRef.current = null;
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
        {status !== "running" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              onClick={start}
              className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
            >
              {status === "loading" ? "模型加载中…" : status === "error" ? "摄像头不可用" : "开启挥手控速"}
            </button>
          </div>
        )}
        {status === "running" && (
          <div
            className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs ${
              handSeen ? "bg-emerald-500/90 text-black" : "bg-zinc-800/80 text-zinc-300"
            }`}
          >
            {handSeen ? "✋ 已识别 · 手抬高加速" : "挥挥手试试"}
          </div>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        手越高节奏越快（{minBpm}–{maxBpm} BPM），手放下恢复原速
      </p>
    </div>
  );
}
