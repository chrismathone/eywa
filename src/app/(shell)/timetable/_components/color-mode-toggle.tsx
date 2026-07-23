"use client";

import { useEffect, useRef } from "react";

import { Palette } from "@/components/icons/eywa-icon-compat";
import { usePrefs, type TimetableColorMode } from "@/components/workspace/use-prefs";
import { saveTimetableViewPrefs } from "@/features/timetable/server/view-prefs-actions";

// 시간표 셀 색 강도 개인 토글(vivid/mid/pastel) — 상단 툴바.
// 기본뷰 셀 색만 바꾼다(class-cell/hapban-cell이 useTimetableColorMode로 소비). 반 지정색은 모드 무관 존중.
//
// ⚠️ 저장은 **계정**(0146a users.ui_prefs). 원장 지시 2026-07-23 — 기기(localStorage)가 아니라 계정에
// 귀속돼야 다른 PC에서도 같은 뷰다. 다만 셀이 읽는 **런타임 소스는 여전히 workspace prefs 스토어**다:
// 셀 색은 클릭 즉시 바뀌어야 하는데 서버 왕복을 기다리면 눈에 띄게 굼뜨다. 그래서
//   ① 클릭 = 스토어 즉시 반영(화면) + 계정 저장(영속)
//   ② 첫 렌더 = 서버가 내려준 계정값을 스토어에 주입(아래 TimetableColorPrefSync)
// 로 나눴다. localStorage 값은 계정값이 없을 때만 살아남는 그림자다.
const OPTIONS: { key: TimetableColorMode; label: string; title: string }[] = [
  { key: "vivid", label: "쨍하게", title: "시트처럼 또렷한 채움(기본)" },
  { key: "mid", label: "중간", title: "은은한 채움" },
  { key: "pastel", label: "옅게", title: "옛 파스텔(가장 연함)" },
];

/**
 * 계정에 저장된 색 강도를 스토어에 주입한다(서버 → 클라 단방향).
 *
 * ⚠️ React state가 아니라 zustand 스토어라 effect에서 set해도 `set-state-in-effect`(#25)에 걸리지
 * 않는다 — `useApplyOsMotionDefault`가 쓰는 것과 같은 패턴이다.
 * ⚠️ 계정값이 **없으면(null) 손대지 않는다** — 기존 기기 설정(localStorage)을 지우지 않기 위해서다.
 */
export function TimetableColorPrefSync({ mode }: { mode: TimetableColorMode | null }) {
  useEffect(() => {
    if (!mode) return;
    if (usePrefs.getState().timetableColor !== mode) usePrefs.getState().setTimetableColor(mode);
  }, [mode]);
  return null;
}

export function TimetableColorToggle({ saved }: { saved: TimetableColorMode | null }) {
  const mode = usePrefs((s) => s.timetableColor);
  const setMode = usePrefs((s) => s.setTimetableColor);
  // 같은 값을 두 번 저장하지 않게(연타·재렌더) 마지막으로 보낸 값을 기억한다.
  const sentRef = useRef<TimetableColorMode | null>(saved);

  const pick = (next: TimetableColorMode) => {
    setMode(next); // ① 화면은 즉시
    if (sentRef.current === next) return;
    sentRef.current = next;
    void saveTimetableViewPrefs({ colorMode: next }); // ② 계정에 영속(실패해도 화면은 안 막는다)
  };

  return (
    <div className="flex items-center gap-1">
      <span className="micro mr-1 inline-flex items-center gap-1">
        <Palette size={11} strokeWidth={1.8} aria-hidden />색
      </span>
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => pick(o.key)}
          title={o.title}
          aria-pressed={mode === o.key}
          className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs transition ${
            mode === o.key
              ? "border-primary bg-primary text-primary-foreground font-medium"
              : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
