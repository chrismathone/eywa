import { pct } from "../report";
import { DeltaChip } from "./delta-chip";
import type { OneScreenStudent, TestScore } from "../types";

function clamp(n: number, max: number) {
  return Math.max(0, Math.min(max, n));
}

function ScoreBlock({
  kicker,
  range,
  test,
  onChange,
}: {
  kicker: string;
  range: string;
  test: TestScore;
  onChange: (v: number | null) => void;
}) {
  const empty = test.score == null;
  const setVal = (raw: string | number) => {
    if (raw === "") return onChange(null);
    const n = typeof raw === "number" ? raw : parseInt(raw, 10);
    if (Number.isNaN(n)) return;
    onChange(clamp(n, test.max));
  };
  return (
    <div className="border-line rounded-md border px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-foreground text-[13px] font-bold">{kicker}</span>
        <span className="text-text-faint text-[11px]">{range}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          inputMode="numeric"
          value={empty ? "" : String(test.score)}
          aria-label={`${kicker} 점수`}
          onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ""))}
          className="border-line focus:border-primary tabular w-14 rounded-sm border bg-background px-2 py-1 text-center text-[15px] font-bold outline-none"
        />
        <span className="text-text-faint tabular text-[12px]">/ {test.max}</span>
        <div className="flex flex-col">
          <button
            type="button"
            aria-label="점수 올림"
            onClick={() => setVal((test.score ?? 0) + 1)}
            className="border-line text-text-dim hover:bg-bg-soft flex h-3.5 w-5 items-center justify-center rounded-t-sm border text-[8px]"
          >
            ▲
          </button>
          <button
            type="button"
            aria-label="점수 내림"
            onClick={() => setVal((test.score ?? 0) - 1)}
            className="border-line text-text-dim hover:bg-bg-soft -mt-px flex h-3.5 w-5 items-center justify-center rounded-b-sm border text-[8px]"
          >
            ▼
          </button>
        </div>
        {!empty ? <DeltaChip score={test.score} prev={test.prevScore} /> : null}
        {!empty ? (
          <span className="text-text-dim tabular ml-auto text-[12px] font-semibold">
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
}: {
  student: OneScreenStudent;
  onScore: (which: "daily" | "check", v: number | null) => void;
}) {
  const prevRange = student.subjects.map((s) => s.prev.split("·")[0]?.trim()).join(" / ");
  const todayRange = student.subjects.map((s) => s.today.split("·")[0]?.trim()).join(" / ");
  return (
    <div className="bg-card border-line shadow-card rounded-md border">
      <header className="border-line flex items-center justify-between border-b px-4 py-3">
        <div>
          <p className="micro text-text-faint">데일리 · 확인 테스트</p>
          <p className="text-foreground text-[15px] font-bold">점수 입력</p>
        </div>
        <span className="text-text-faint text-[11px]">맞은 개수만 입력</span>
      </header>
      <div className="flex flex-col gap-2.5 px-4 py-3">
        <ScoreBlock
          kicker="일일테스트"
          range={`이전 진도 · ${prevRange}`}
          test={student.tests.daily}
          onChange={(v) => onScore("daily", v)}
        />
        <ScoreBlock
          kicker="확인테스트"
          range={`오늘 진도 · ${todayRange}`}
          test={student.tests.check}
          onChange={(v) => onScore("check", v)}
        />
      </div>
    </div>
  );
}
