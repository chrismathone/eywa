import { pct } from "../report";
import { displayLessons } from "../curriculum";
import { EyIcon } from "@/components/icons/eywa-icons";
import { DeltaChip } from "./delta-chip";
import { TestMaxInput } from "./test-max-input";
import type { Tests } from "../types";
import type { OneScreenStudent, TestScore } from "../types";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

function clamp(n: number, max: number) {
  return Math.max(0, Math.min(max, n));
}

function ScoreBlock({
  kicker,
  range,
  test,
  onChange,
  allowMax,
  onMax,
}: {
  kicker: string;
  range: string;
  test: TestScore;
  onChange: (v: number | null) => void;
  allowMax?: boolean; // 학원설정: 강사 문항수 변경 허용
  onMax?: (v: number) => void;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const empty = test.score == null;
  const setVal = (raw: string | number) => {
    if (raw === "") return onChange(null);
    const n = typeof raw === "number" ? raw : parseInt(raw, 10);
    if (Number.isNaN(n)) return;
    onChange(clamp(n, test.max)); // 맞은 개수는 문항수를 넘을 수 없다
  };
  return (
    <div className="border-line rounded-md border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        {/* 보고서 카드로 합쳐지며 열이 좁아졌다(2026-08-05) — 라벨이 "확인테스 / 트"로 쪼개지므로 줄바꿈 금지.
            길어서 밀리는 건 옆의 범위 텍스트(truncate)가 흡수한다. */}
        <span className="text-foreground shrink-0 text-[13px] font-bold whitespace-nowrap">{kicker}</span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-text-faint truncate text-[11px]">{range}</span>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          inputMode="numeric"
          value={empty ? "" : String(test.score)}
          aria-label={tf("os.score.aria", { label: kicker })}
          onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ""))}
          className="border-line focus:border-primary tabular w-14 rounded-sm border bg-background px-2 py-1 text-center text-[15px] font-bold outline-none"
        />
        {allowMax && onMax ? (
          <span className="text-text-faint tabular flex items-center gap-0.5 text-[12px]">
            /
            {/* 빈칸 편집 허용(분모를 지우면 옛 값으로 스냅백하던 버그, 2026-07-24 원장 제보). */}
            <TestMaxInput
              max={test.max}
              onCommit={onMax}
              ariaLabel={tf("os.score.maxAria", { label: kicker })}
              className="border-line focus:border-primary tabular w-10 rounded-sm border bg-background px-1 py-0.5 text-center text-[12px] outline-none"
            />
          </span>
        ) : (
          <span className="text-text-faint tabular text-[12px]">/ {test.max}</span>
        )}
        <div className="flex flex-col">
          <button
            type="button"
            aria-label={t("os.score.up")}
            onClick={() => setVal((test.score ?? 0) + 1)}
            className="border-line text-text-dim hover:bg-bg-soft flex h-3.5 w-5 items-center justify-center rounded-t-sm border"
          >
            <EyIcon name="chevronUp" size={9} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            aria-label={t("os.score.down")}
            onClick={() => setVal((test.score ?? 0) - 1)}
            className="border-line text-text-dim hover:bg-bg-soft -mt-px flex h-3.5 w-5 items-center justify-center rounded-b-sm border"
          >
            <EyIcon name="chevronDown" size={9} strokeWidth={1.8} />
          </button>
        </div>
        {!empty ? <DeltaChip score={test.score} prev={test.prevScore} /> : null}
        {!empty ? (
          <span className="text-text-dim tabular ml-auto text-[12px] font-bold">
            {pct(test.score ?? 0, test.max)}%
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** 테스트 카드 — 일일/확인 점수 입력 (맞은 개수) */
export function TestCard({
  student,
  onScore,
  allowMax,
  onMax,
  dailyEnabled = true,
  checkEnabled = true,
  embedded,
  tests,
}: {
  student: OneScreenStudent;
  /**
   * 표시·편집할 점수 — **선택된 행**의 값(row-fields.ts `resolveRowFields`). 미지정이면 학생 값.
   * 🔴 보강은 정규와 따로 나가는 다른 보고서라 점수가 겹치면 안 된다(원장 2026-08-13).
   */
  tests?: Tests;
  onScore: (which: "daily" | "check", v: number | null) => void;
  allowMax?: boolean; // 강사 문항수 변경 허용(학원 설정)
  onMax?: (which: "daily" | "check", v: number) => void;
  dailyEnabled?: boolean; // 일일테스트 사용(off면 입력창 숨김)
  checkEnabled?: boolean; // 확인테스트 사용(off면 입력창 숨김)
  /** 보고서 카드 안에 들어간 상태 — 카드 속 카드로 겹쳐 보이지 않게 그림자·배경을 뺀 얇은 테두리로(2026-08-05 통합). */
  embedded?: boolean;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const shown = tests ?? student.tests;
  // 다중 차시도 한 줄로 이어 표시(", "). '·'로 쪼개던 옛 로직은 다중차시(개행)에서 깨져 제거.
  const prevRange = student.subjects.map((s) => displayLessons(s.prev) || s.prev).filter(Boolean).join(" / ");
  const todayRange = student.subjects.map((s) => displayLessons(s.today) || s.today).filter(Boolean).join(" / ");
  return (
    <div className={embedded ? "border-line rounded-lg border" : "bg-card border-line shadow-card rounded-2xl border"}>
      {/* embedded = 보고서 카드 안 → 제목 한 줄 + 안내문구 생략(칸이 좁고 옆 입력이 이미 자명하다). */}
      <header
        className={`border-line flex items-center justify-between gap-2 border-b ${
          embedded ? "px-3 py-2" : "px-4 py-3"
        }`}
      >
        <div>
          {embedded ? (
            <p className="text-foreground text-[13px] font-bold">{t("os.test.title")}</p>
          ) : (
            <>
              <p className="micro text-text-faint">{t("os.test.kicker")}</p>
              <p className="text-foreground text-[15px] font-bold">{t("os.test.heading")}</p>
            </>
          )}
        </div>
        {embedded ? null : <span className="text-text-faint text-[11px]">{t("os.test.hint")}</span>}
      </header>
      <div className={`flex flex-col gap-2 ${embedded ? "px-3 py-2" : "px-4 py-3"}`}>
        {dailyEnabled ? (
          <ScoreBlock
            kicker={t("os.test.daily")}
            range={tf("os.test.prevRange", { range: prevRange })}
            test={shown.daily}
            onChange={(v) => onScore("daily", v)}
            allowMax={allowMax}
            onMax={onMax ? (v) => onMax("daily", v) : undefined}
          />
        ) : null}
        {checkEnabled ? (
          <ScoreBlock
            kicker={t("os.test.check")}
            range={tf("os.test.todayRange", { range: todayRange })}
            test={shown.check}
            onChange={(v) => onScore("check", v)}
            allowMax={allowMax}
            onMax={onMax ? (v) => onMax("check", v) : undefined}
          />
        ) : null}
        {!dailyEnabled && !checkEnabled ? (
          <p className="text-text-faint py-1 text-center text-[12px]">{t("os.test.off")}</p>
        ) : null}
      </div>
    </div>
  );
}
