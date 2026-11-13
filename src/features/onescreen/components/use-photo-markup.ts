"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { exportPhotoMarkup, hitPhotoMark, movePhotoMark, paintPhoto, photoEditOf, photoPoint, type PhotoMark } from "../photo-markup";

export function usePhotoMarkup(file: File, onApply: (file: File) => void) {
  const [initial] = useState(() => photoEditOf(file));
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [marks, setMarks] = useState<PhotoMark[]>(initial.marks);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const canvasElement = useRef<HTMLCanvasElement | null>(null);
  const stageElement = useRef<HTMLDivElement | null>(null);
  const [canvasVersion, setCanvasVersion] = useState(0);
  const [stageVersion, setStageVersion] = useState(0);
  const canvasRef = useCallback((node: HTMLCanvasElement | null) => { canvasElement.current = node; setCanvasVersion(v => v + 1); }, []);
  const stageRef = useCallback((node: HTMLDivElement | null) => { stageElement.current = node; setStageVersion(v => v + 1); }, []);
  const alive = useRef(true);
  const working = useRef(false);
  const drag = useRef<{ pointer: number; id?: string; dx: number; dy: number; x: number; y: number; left: number; top: number } | null>(null);
  useEffect(() => {
    alive.current = true;
    const url = URL.createObjectURL(initial.source);
    const img = new Image();
    const timer = window.setTimeout(() => { if (alive.current) setError(true); }, 15_000);
    img.onload = () => {
      window.clearTimeout(timer);
      if (!alive.current) return;
      if (!img.naturalWidth || !img.naturalHeight) { setError(true); return; }
      setError(false); setImage(img);
    };
    img.onerror = () => { window.clearTimeout(timer); if (alive.current) setError(true); };
    img.src = url;
    return () => { alive.current = false; window.clearTimeout(timer); img.onload = null; img.onerror = null; img.src = ""; URL.revokeObjectURL(url); };
  }, [initial.source]);
  useEffect(() => {
    const stage = stageElement.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => setViewport({ w: stage.clientWidth, h: stage.clientHeight }));
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stageVersion]);
  const width = image?.naturalWidth ?? 1;
  const height = image?.naturalHeight ?? 1;
  const scale = Math.min(viewport.w / width, viewport.h / height, 1);
  const display = { width: Math.max(1, width * scale * zoom), height: Math.max(1, height * scale * zoom) };
  useEffect(() => {
    const canvas = canvasElement.current;
    if (!canvas || !image) return;
    const ratio = Math.min(1, 1100 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = canvas.getContext("2d");
    if (ctx) paintPhoto(ctx, image, canvas.width, canvas.height, marks, selected ?? undefined);
  }, [canvasVersion, image, marks, selected]);
  const current = marks.find(mark => mark.id === selected);
  const change = (patch: Partial<PhotoMark>) => setMarks(prev => prev.map(mark => mark.id === selected ? { ...mark, ...patch } : mark));
  const add = (kind: PhotoMark["kind"], text: string) => {
    if (!text.trim() || marks.length >= 24) return;
    const mark: PhotoMark = { id: crypto.randomUUID(), kind, text: text.trim().slice(0, 120), x: 0.5, y: 0.5, size: kind === "sticker" ? 0.18 : 0.065, color: "#ffffff" };
    setMarks(prev => [...prev, mark]); setSelected(mark.id);
  };
  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (busy || event.button !== 0 || drag.current) return;
    const canvas = event.currentTarget;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const point = photoPoint(event.clientX, event.clientY, canvas.getBoundingClientRect());
    const hit = hitPhotoMark(ctx, marks, point.x, point.y, canvas.width, canvas.height);
    if (hit || zoom === 1) setSelected(hit?.mark.id ?? null);
    drag.current = { pointer: event.pointerId, id: hit?.mark.id, dx: hit ? point.x - hit.box.x / canvas.width : 0, dy: hit ? point.y - hit.box.y / canvas.height : 0,
      x: event.clientX, y: event.clientY, left: stageElement.current?.scrollLeft ?? 0, top: stageElement.current?.scrollTop ?? 0 };
    canvas.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    if (active.id) {
      const point = photoPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
      setMarks(prev => prev.map(mark => mark.id === active.id ? movePhotoMark(mark, point.x - active.dx, point.y - active.dy) : mark));
    } else if (stageElement.current) {
      stageElement.current.scrollLeft = active.left - (event.clientX - active.x);
      stageElement.current.scrollTop = active.top - (event.clientY - active.y);
    }
  };
  const apply = async () => {
    if (!image || working.current) return;
    working.current = true; setBusy(true); setError(false);
    try {
      const result = marks.length ? await exportPhotoMarkup(image, initial.source, marks) : initial.source;
      if (alive.current) onApply(result);
    } catch { if (alive.current) setError(true); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };
  return { canvasRef, stageRef, image, marks, current, selected, setSelected, change, add, zoom, setZoom, display, busy, error, apply,
    nudge: (id: string, dx: number, dy: number) => setMarks(prev => prev.map(mark => mark.id === id ? movePhotoMark(mark, mark.x + dx, mark.y + dy) : mark)),
    remove: () => { setMarks(prev => prev.filter(mark => mark.id !== selected)); setSelected(null); },
    pointerDown, pointerMove, pointerEnd: (event: PointerEvent<HTMLCanvasElement>) => { if (drag.current?.pointer === event.pointerId) drag.current = null; } };
}
export type PhotoMarkupController = ReturnType<typeof usePhotoMarkup>;
