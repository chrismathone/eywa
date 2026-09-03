"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useInFrame } from "@/components/workspace/use-in-frame";

/**
 * 🧪 **개발 전용** — 컨트롤 라벨 크기 3안(16 / 18 / 20px)을 실행 중에 바꿔 보는 비교 스위치.
 *
 * 원장 2026-09-03(라벨 크기 질문에): *"3개 시안 모두 보고 결정"*. 값은 전부 globals.css `--control-*` 변수라
 * `<html>`에 인라인으로 덮으면 앱의 모든 버튼·칩·탭·드롭다운·기간 네비가 한꺼번에 따라온다.
 * 창(iframe)은 문서가 따로라 localStorage `storage` 이벤트로 같은 값을 받는다(같은 origin).
 *
 * 🔴 결정이 나면 이 파일과 layout의 마운트 3곳을 **지우고** globals.css 기본값을 그 값으로 고정한다 —
 *    프로덕션 빌드에선 아무것도 그리지 않고 아무 변수도 안 덮는다(`NODE_ENV !== "development"` 즉시 return).
 * ⚠️ 계정 귀속 설정이 아니다(검토용 임시 스위치) — `users.ui_prefs`에 넣지 말 것.
 */
const KEY = "eywa-dev-control-scale";
const EVT = "eywa-dev-control-scale-change";
type Scale = "sm" | "md" | "lg";
/** 기본 라벨 px → 높이 = 라벨 ÷ 0.9(반올림), sm = −2 / lg = +4. md(18)는 globals.css 기본값과 같다. */
const LABEL: Record<Scale, number> = { sm: 16, md: 18, lg: 20 };
const DEV = process.env.NODE_ENV === "development";

function readScale(): Scale {
  try {
    const v = localStorage.getItem(KEY);
    return v === "sm" || v === "lg" ? v : "md";
  } catch {
    return "md";
  }
}
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVT, cb);
  };
}
const getServer = (): Scale => "md";

function applyScale(scale: Scale) {
  const root = document.documentElement.style;
  const vars = ["--control-label", "--control-h", "--control-label-sm", "--control-h-sm", "--control-label-lg", "--control-h-lg"];
  if (scale === "md") {
    for (const v of vars) root.removeProperty(v);
    return;
  }
  const base = LABEL[scale];
  const h = (label: number) => Math.round(label / 0.9);
  root.setProperty("--control-label", `${base}px`);
  root.setProperty("--control-h", `${h(base)}px`);
  root.setProperty("--control-label-sm", `${base - 2}px`);
  root.setProperty("--control-h-sm", `${h(base - 2)}px`);
  root.setProperty("--control-label-lg", `${base + 4}px`);
  root.setProperty("--control-h-lg", `${h(base + 4)}px`);
}

export function ControlScalePreview() {
  const inFrame = useInFrame();
  const scale = useSyncExternalStore(subscribe, readScale, getServer);
  useEffect(() => {
    if (!DEV) return;
    applyScale(scale);
  }, [scale]);
  if (!DEV || inFrame) return null;
  const pick = (s: Scale) => {
    try {
      localStorage.setItem(KEY, s);
    } catch {
      /* 저장 불가면 이 문서만 바뀐다. */
    }
    window.dispatchEvent(new Event(EVT));
  };
  return (
    <div
      role="group"
      aria-label="개발용 — 컨트롤 라벨 크기 비교"
      className="bg-foreground text-background fixed bottom-3 left-3 z-[70] flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold shadow-lg"
    >
      <span className="opacity-70">라벨</span>
      {(["sm", "md", "lg"] as const).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => pick(s)}
          aria-pressed={scale === s}
          className={`num rounded-md px-1.5 py-0.5 transition ${scale === s ? "bg-background text-foreground" : "hover:bg-background/20"}`}
        >
          {LABEL[s]}
        </button>
      ))}
    </div>
  );
}
