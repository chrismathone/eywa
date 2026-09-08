"use client";

import { CalendarDays } from "@/components/icons/eywa-icon-compat";
import {
  EFFECTIVE_DATE_MAX_DAYS,
  effectiveDateLabel,
  isImmediate,
  nextMondayAfter,
  normalizeEffectiveDate,
} from "@/features/timetable/import/effective-date";
import { shiftDays } from "@/features/timetable/lib/week";

/**
 * 가져오기 **적용일** 선택 — 두 가져오기 다이얼로그(영어 통합 · 파일/시트 반이동)가 공유한다.
 *
 * 원장 2026-08-28: 반 배치는 보통 "다음 주 월요일부터" 바뀌는데 종전엔 **누른 그날**만 가능했다.
 * 그래서 프리셋의 기본 두 칸이 `오늘`과 `다음 주 월요일`이다(직접 고르는 건 그 옆 날짜 칸).
 *
 * ⚠️ 검증은 여기서 끝나지 않는다 — 같은 순수 규칙([`effective-date.ts`](../../../../features/timetable/import/effective-date.ts))을
 *    서버 액션이 다시 통과시킨다. 이 컴포넌트가 하는 일은 **고르기 쉽게** 만드는 것뿐이다([[#77]]).
 */
export function EffectiveDateField({
  value,
  onChange,
  today,
  disabled = false,
}: {
  /** 선택된 적용일(YYYY-MM-DD). */
  value: string;
  onChange: (next: string) => void;
  today: string;
  disabled?: boolean;
}) {
  const nextMon = nextMondayAfter(today);
  const check = normalizeEffectiveDate(value, today);
  const invalid = "error" in check ? check.error : null;
  const immediate = isImmediate(value, today);

  const chip = (active: boolean) =>
    `rounded-pill border px-2 py-0.5 text-xs font-medium transition disabled:opacity-40 ${
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
    }`;

  return (
    <div className="border-line bg-bg-soft mt-3 rounded-lg border p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-text-dim flex items-center gap-1 text-xs font-bold">
          <CalendarDays size={13} aria-hidden="true" /> 적용일
        </span>
        <button type="button" disabled={disabled} onClick={() => onChange(today)} className={chip(value === today)}>
          오늘
        </button>
        <button type="button" disabled={disabled} onClick={() => onChange(nextMon)} className={chip(value === nextMon)}>
          다음 주 월요일
        </button>
        <input
          type="date"
          value={value}
          min={today}
          max={shiftDays(today, EFFECTIVE_DATE_MAX_DAYS)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label="적용일 직접 선택"
          className="border-line bg-card text-foreground num rounded-lg border px-2 py-0.5 text-xs disabled:opacity-40"
        />
      </div>
      {invalid ? (
        <p className="text-danger mt-1.5 text-xs">{invalid}</p>
      ) : (
        <p className="text-text-faint mt-1.5 text-xs">
          {immediate ? (
            <>지금 바로 적용됩니다.</>
          ) : (
            <>
              <b className="text-text-dim">{effectiveDateLabel(value)}</b>부터 적용됩니다 — 그 전날까지는 지금 배치가
              그대로 유지되고, 시간표에서 그 주로 넘기면 바뀐 배치가 보입니다.
            </>
          )}
        </p>
      )}
    </div>
  );
}
