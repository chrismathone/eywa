"use client";

import { Palette } from "@/components/icons/eywa-icon-compat";
import { usePrefs, type TimetableColorMode } from "@/components/workspace/use-prefs";

// 시간표 셀 색 강도 개인 토글(vivid/mid/pastel) — 상단 툴바. localStorage(eywa-prefs) 영속, URL 무관(개인 설정).
// 기본뷰 셀 색만 바꾼다(class-cell/hapban-cell이 useTimetableColorMode로 소비). 반 지정색은 모드 무관 존중.
const OPTIONS: { key: TimetableColorMode; label: string; title: string }[] = [
  { key: "vivid", label: "쨍하게", title: "시트처럼 또렷한 채움(기본)" },
  { key: "mid", label: "중간", title: "은은한 채움" },
  { key: "pastel", label: "옅게", title: "옛 파스텔(가장 연함)" },
];

export function TimetableColorToggle() {
  const mode = usePrefs((s) => s.timetableColor);
  const setMode = usePrefs((s) => s.setTimetableColor);
  return (
    <div className="flex items-center gap-1">
      <span className="micro mr-1 inline-flex items-center gap-1">
        <Palette size={11} strokeWidth={2} aria-hidden />색
      </span>
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => setMode(o.key)}
          title={o.title}
          aria-pressed={mode === o.key}
          className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs transition ${
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
