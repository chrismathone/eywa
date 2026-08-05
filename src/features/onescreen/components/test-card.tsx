import { pct } from "../report";
import { displayLessons } from "../curriculum";
import { EyIcon } from "@/components/icons/eywa-icons";
import { DeltaChip } from "./delta-chip";
import { TestMaxInput } from "./test-max-input";
import { TestModeToggle } from "./test-mode-toggle";
import type { OneScreenStudent, TestScore, TestScoreMode } from "../types";

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
  onMode,
}: {
  kicker: string;
  range: string;
  test: TestScore;
  onChange: (v: number | null) => void;
  allowMax?: boolean; // 학원설정: 강사 문항수 변경 허용
  onMax?: (v: number) => void;
  onMode?: (m: TestScoreMode) => void; // 개수/점수 표기 전환(0148a). 미지정이면 토글 숨김.
}) {
  const empty = test.score == null;
  const mode: TestScoreMode = test.mode ?? "count";
  const scoreMode = mode === "score";
  const setVal = (raw: string | number) => {
    if (raw === "") return onChange(null);
    const n = typeof raw === "number" ? raw : parseInt(raw, 10);
    if (Number.isNaN(n)) return;
    onChange(clamp(n, test.max)); // 점수 모드 만점=100(roster·setModeFor가 보장) → 0~100 클램프
  };
  return (
    <div className="border-line rounded-md border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        {/* 보고서 카드로 합쳐지며 열이 좁아졌다(2026-08-05) — 라벨이 "확인테스 / 트"로 쪼개지므로 줄바꿈 금지.
            길어서 밀리는 건 옆의 범위 텍스트(truncate)가 흡수한다. */}
        <span className="text-foreground shrink-0 text-[13px] font-bold whitespace-nowrap">{kicker}</span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-text-faint truncate text-[11px]">{range}</span>
          {onMode ? <TestModeToggle mode={mode} onMode={onMode} /> : null}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          inputMode="numeric"
          value={empty ? "" : String(test.score)}
          aria-label={`${kicker} 점수`}
          onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ""))}
          className="border-line focus:border-primary tabular w-14 rounded-sm border bg-background px-2 py-1 text-center text-[15px] font-bold outline-none"
        />
        {scoreMode ? (
          // 점수 모드 = "X점"(만점 100 고정). 문항수 입력·% 표시 없음.
          <span className="text-text-faint text-[13px] font-bold">점</span>
        ) : allowMax && onMax ? (
          <span className="text-text-faint tabular flex items-center gap-0.5 text-[12px]">
            /
            {/* 빈칸 편집 허용(분모를 지우면 옛 값으로 스냅백하던 버그, 2026-07-24 원장 제보). */}
            <TestMaxInput
              max={test.max}
              onCommit={onMax}
              ariaLabel={`${kicker} 문항수`}
              className="border-line focus:border-primary tabular w-10 rounded-sm border bg-background px-1 py-0.5 text-center text-[12px] outline-none"
            />
          </span>
        ) : (
          <span className="text-text-faint tabular text-[12px]">/ {test.max}</span>
        )}
        <div className="flex flex-col">
          <button
            type="button"
            aria-label="점수 올림"
            onClick={() => setVal((test.score ?? 0) + 1)}
            className="border-line text-text-dim hover:bg-bg-soft flex h-3.5 w-5 items-center justify-center rounded-t-sm border"
          >
            <EyIcon name="chevronUp" size={9} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            aria-label="점수 내림"
            onClick={() => setVal((test.score ?? 0) - 1)}
            className="border-line text-text-dim hover:bg-bg-soft -mt-px flex h-3.5 w-5 items-center justify-center rounded-b-sm border"
          >
            <EyIcon name="chevronDown" size={9} strokeWidth={1.8} />
          </button>
        </div>
        {!empty ? <DeltaChip score={test.score} prev={test.prevScore} /> : null}
        {/* % 는 개수 모드에서만 — 점수 모드는 숫자 자체가 점수라 중복이다. */}
        {!empty && !scoreMode ? (
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
  onMode,
  dailyEnabled = true,
  checkEnabled = true,
  embedded,
}: {
  student: OneScreenStudent;
  onScore: (which: "daily" | "check", v: number | null) => void;
  allowMax?: boolean; // 강사 문항수 변경 허용(학원 설정)
  onMax?: (which: "daily" | "check", v: number) => void;
  onMode?: (which: "daily" | "check", m: TestScoreMode) => void; // 개수/점수 표기 전환(0148a)
  dailyEnabled?: boolean; // 일일테스트 사용(off면 입력창 숨김)
  checkEnabled?: boolean; // 확인테스트 사용(off면 입력창 숨김)
  /** 보고서 카드 안에 들어간 상태 — 카드 속 카드로 겹쳐 보이지 않게 그림자·배경을 뺀 얇은 테두리로(2026-08-05 통합). */
  embedded?: boolean;
}) {
  // 다중 차시도 한 줄로 이어 표시(", "). '·'로 쪼개던 옛 로직은 다중차시(개행)에서 깨져 제거.
  const prevRange = student.subjects.map((s) => displayLessons(s.prev) || s.prev).filter(Boolean).join(" / ");
  const todayRange = student.subjects.map((s) => displayLessons(s.today) || s.today).filter(Boolean).join(" / ");
  return (
    <div className={embedded ? "border-line rounded-lg border" : "bg-card border-line shadow-card rounded-2xl border"}>
      {/* embedded = 보고서 카드 안 → 제목 한 줄 + 안내문구 생략(토글이 바로 옆에 있어 자명하다). */}
      <header
        className={`border-line flex items-center justify-between gap-2 border-b ${
          embedded ? "px-3 py-2" : "px-4 py-3"
        }`}
      >
        <div>
          {embedded ? (
            <p className="text-foreground text-[13px] font-bold">테스트 점수</p>
          ) : (
            <>
              <p className="micro text-text-faint">데일리 · 확인 테스트</p>
              <p className="text-foreground text-[15px] font-bold">점수 입력</p>
            </>
          )}
        </div>
        {embedded ? null : <span className="text-text-faint text-[11px]">개/점 토글로 표기 전환</span>}
      </header>
      <div className={`flex flex-col gap-2 ${embedded ? "px-3 py-2" : "px-4 py-3"}`}>
        {dailyEnabled ? (
          <ScoreBlock
            kicker="일일테스트"
            range={`이전 진도 · ${prevRange}`}
            test={student.tests.daily}
            onChange={(v) => onScore("daily", v)}
            allowMax={allowMax}
            onMax={onMax ? (v) => onMax("daily", v) : undefined}
            onMode={onMode ? (m) => onMode("daily", m) : undefined}
          />
        ) : null}
        {checkEnabled ? (
          <ScoreBlock
            kicker="확인테스트"
            range={`오늘 진도 · ${todayRange}`}
            test={student.tests.check}
            onChange={(v) => onScore("check", v)}
            allowMax={allowMax}
            onMax={onMax ? (v) => onMax("check", v) : undefined}
            onMode={onMode ? (m) => onMode("check", m) : undefined}
          />
        ) : null}
        {!dailyEnabled && !checkEnabled ? (
          <p className="text-text-faint py-1 text-center text-[12px]">테스트를 사용하지 않는 학원 설정입니다.</p>
        ) : null}
      </div>
    </div>
  );
}
