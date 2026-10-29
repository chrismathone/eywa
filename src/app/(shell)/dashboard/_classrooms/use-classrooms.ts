"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { subscribeRecordSaved } from "@/lib/realtime/record-channel";
import { refreshDelay } from "@/features/dashboard/overview/realtime";
import { refreshClassroomPreview } from "@/features/dashboard/classroom-preview/actions";
import type { ClassroomSnapshot } from "@/features/dashboard/classroom-preview/model";


export function useClassrooms(initial: ClassroomSnapshot) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["classroom-preview", initial.scope],
    queryFn: refreshClassroomPreview,
    initialData: initial,
    initialDataUpdatedAt: initial.at,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    retry: 1,
  });
  // 표마다 걸던 DB 변경 구독(6개 · 그중 classrooms는 실시간 발행에 없어 매번 실패)을 뗐다 — 대시보드 운영실과 같은 이유(DB 메모리 · 2026-10-29).
  // 바닥은 30초 갱신 · 같은 브라우저 저장 신호 · 화면 복귀.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstSignal = 0;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      firstSignal ||= Date.now();
      clearTimeout(timer);
      timer = setTimeout(() => {
        firstSignal = 0;
        void client.invalidateQueries({ queryKey: ["classroom-preview", initial.scope] }, { cancelRefetch: false });
      }, refreshDelay(firstSignal, Date.now()));
    };
    const unsubscribe = subscribeRecordSaved(refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [client, initial.scope]);
  return query;
}

const VIEW_KEY = "eywa-classroom-preview-view";
let memoryView: "2d" | "3d" = "3d";
function readView(): "2d" | "3d" {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    return value === "2d" || value === "3d" ? value : memoryView;
  } catch { return memoryView; }
}
function subscribeView(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(VIEW_KEY, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(VIEW_KEY, callback);
  };
}
export function useClassroomView() {
  // Hydration must not briefly load WebGL before a saved 2D preference is read.
  const view = useSyncExternalStore(subscribeView, readView, () => "2d" as const);
  const changeView = (next: "2d" | "3d") => {
    memoryView = next;
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* Storage may be disabled. */ }
    window.dispatchEvent(new Event(VIEW_KEY));
  };
  return [view, changeView] as const;
}
