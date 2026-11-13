"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraState = "idle" | "opening" | "ready" | "paused" | "denied" | "unavailable";
const stopTracks = (stream: MediaStream | null) => stream?.getTracks().forEach(track => track.stop());

/** A single stream survives student changes. Late permission replies cannot resurrect a closed camera. */
export function usePhotoCamera(active: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const [state, setState] = useState<CameraState>("idle");
  const stop = useCallback(() => {
    generation.current++;
    stopTracks(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);
  const start = useCallback(async () => {
    stop();
    const token = generation.current;
    setState("opening");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      });
      if (!mounted.current || token !== generation.current || document.visibilityState === "hidden") {
        stopTracks(stream);
        return;
      }
      streamRef.current = stream;
      stream.getVideoTracks().forEach(track => track.addEventListener("ended", () => {
        if (token !== generation.current) return;
        stop();
        setState("paused");
      }, { once: true }));
      const video = videoRef.current;
      if (!video) { stop(); return; }
      video.srcObject = stream;
      await video.play();
      if (token === generation.current && mounted.current) setState("ready");
    } catch (error) {
      if (token !== generation.current || !mounted.current) return;
      stop();
      setState(error instanceof Error && error.name === "NotAllowedError" ? "denied" : "unavailable");
    }
  }, [stop]);
  useEffect(() => {
    mounted.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize opening/permission state with the external camera
    if (active) void start();
    const pause = () => {
      if (document.visibilityState !== "hidden") return;
      stop();
      setState("paused");
    };
    document.addEventListener("visibilitychange", pause);
    return () => { mounted.current = false; stop(); document.removeEventListener("visibilitychange", pause); };
  }, [active, start, stop]);
  return { videoRef, state, start };
}

export async function capturePhoto(video: HTMLVideoElement, name: string): Promise<File> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height || video.readyState < 2) throw new Error("camera-not-ready");
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("camera-canvas-unavailable");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob?.size) throw new Error("camera-encode-failed");
    return new File([blob], name, { type: "image/jpeg" });
  } finally { canvas.width = 0; canvas.height = 0; }
}
