"use client";

/**
 * 일괄 입력 팝오버 — 선택(없으면 표시 전체) 행을 한 번에 채운다. **채울 값을 어디서 가져오는지**만 두 갈래:
 *   ① 직접 입력 — 진도·태도·과제·교재·오늘 과제를 여기서 골라 넣는다(빈 필드는 적용 안 함 = 값 지우기 아님).
 *   ② 맨 위 행 복사 — 맨 위 행의 진도·교재·오늘 과제를 아래 행에 그대로 붙인다.
 *
 * ⚠️ 원래 '값 일괄 입력'과 '맨 위 행 복사'는 **버튼 두 개**였는데, 진도가 ①에 추가되면서 둘이 같은 일(같은 대상 규약,
 * 같은 행 단위 필드)을 하게 됐다(2026-07-23 원장 지적 "겹치는 것 같은데"). 하나로 합치고 값 출처만 고르게 한다.
 * ⚠️ **덮어쓰기 기본값은 모드마다 다르다** — 직접 입력은 덮어쓰기(내가 방금 고른 값을 넣으려는 것),
 * 복사는 빈 칸만(남의 행 값이 내 입력을 밀어내면 안 된다). 각 기능이 원래 갖고 있던 계약을 그대로 보존한다.
 *
 * ⚠️ **진도만 과목을 골라 그 과목 행에만** 넣는다 — 수학 진도가 영어 행에 들어가면 그대로 학부모에게 나간다
 * (planCopyFirstRow의 과목 가드와 같은 이유). 수학 계열은 행과 **같은 차시 선택기**(ProgressSelector),
 * 그 외(영어 등)는 자유 텍스트 — 진도 셀의 분기를 그대로 따른다.
 * (2026-07-23 강사 제보 "진도 일괄 적는 게 안 돼요" — 이 팝오버에 진도만 빠져 있었다.)
 *
 * ⚠️ **출결만 성질이 다르다**(2026-07-30 추가). 나머지 칸은 화면 state를 고쳐 두고 나중에 저장하지만
 * 출결은 **적용 즉시 출석부(attendance_records)에 기록**되고 원스크린에서 되돌릴 수 없다. 그래서
 * ① 대상·덮어쓸 건수를 고르는 즉시 보여주고 ② 덮어쓸 게 있으면 확인을 받는다(계산은 planBulkAttendance).
 */
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import type { BulkPatch } from "../grid";
import {
  BULK_ATTENDANCE_LABEL,
  BULK_ATTENDANCE_STATUSES,
  describeAttendanceSkips,
  type BulkAttPlan,
  type BulkAttendanceStatus,
} from "../bulk-attendance";
import { FieldSelect } from "./field-select";
import { HomeworkRateInput } from "./homework-rate-input";
import { ProgressSelector } from "./progress-selector";

/** 대상 행에 있는 과목 — 진도를 넣을 과목 선택지(행 수는 "몇 행에 들어가는지" 표시용). */
export type BulkSubjectOption = { key: string; name: string; count: number };

/** 진도 입력이 커리큘럼(math)인지 — 미지정은 math(진도 셀 분기와 동일 규약). */
const isMathSubject = (key: string) => (key || "math") === "math";

export function BulkApplyPopover({
  targetCount,
  selectedCount,
  attitudes,
  subjects,
  studyGrade,
  copySource,
  attendance,
  onApply,
  onCopyFirstRow,
  disabled,
}: {
  targetCount: number; // 적용 대상 행 수(선택 없으면 표시 전체)
  selectedCount: number; // 체크된 행 수(라벨용)
  attitudes: readonly string[];
  /** 대상 행의 과목들 — 진도 대상 과목 선택. 첫 항목이 기본값(대상이 가장 많은 과목). */
  subjects: BulkSubjectOption[];
  /** 진도 차시 선택기의 기본 학년(대상 행에서 가장 흔한 진도 학년). */
  studyGrade: string;
  /** '맨 위 행 복사'의 원본 — 맨 위 행 학생 이름과 아래 행 수(없으면 복사 모드 비활성). */
  copySource: { label: string; belowCount: number } | null;
  /**
   * 출결 일괄 — 출결 **쓰기 권한이 있을 때만** 넘어온다(권한 없으면 아예 안 보인다: 못 하는 일을
   * 할 수 있는 것처럼 보여주지 않는다, attendance-pills와 같은 규칙).
   * `plan`은 순수 계산(planBulkAttendance)이라 고르는 즉시 대상·덮어쓸 건수를 미리 보여줄 수 있다.
   */
  attendance?: { plan: (status: BulkAttendanceStatus, onlyEmpty: boolean) => BulkAttPlan } | null;
  onApply: (
    patch: BulkPatch,
    onlyEmpty: boolean,
    progressSubjectKey: string,
    attendance: BulkAttendanceStatus | null,
  ) => void;
  onCopyFirstRow: (overwrite: boolean) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"input" | "copy">("input");
  const [attitude, setAttitude] = useState<string | null>(null);
  const [homework, setHomework] = useState<string>("");
  const [textbook, setTextbook] = useState("");
  const [homeworkToday, setHomeworkToday] = useState("");
  const [progress, setProgress] = useState("");
  const [subjectKey, setSubjectKey] = useState<string | null>(null);
  const [grade, setGrade] = useState(studyGrade);
  const [att, setAtt] = useState<BulkAttendanceStatus | null>(null);
  // 모드마다 기본이 다르다(위 주석) — 직접 입력=덮어쓰기, 복사=빈 칸만.
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const canCopy = !!copySource && copySource.belowCount > 0;
  // 고른 출결의 실제 대상 — 상태·'빈 칸만'을 바꿀 때마다 다시 센다(순수 계산이라 렌더 중 안전).
  const attPlan = attendance && att ? attendance.plan(att, onlyEmpty) : null;
  const hasAny =
    mode === "copy"
      ? canCopy
      : !!(attitude || homework || textbook.trim() || homeworkToday.trim() || progress.trim() || att);
  // 과목이 하나뿐이면 고를 것도 없다 — 그대로 그 과목.
  const activeSubject = subjects.find((s) => s.key === (subjectKey ?? subjects[0]?.key)) ?? subjects[0] ?? null;

  const switchMode = (next: "input" | "copy") => {
    setMode(next);
    setOnlyEmpty(next === "copy"); // 각 모드가 원래 갖고 있던 계약 그대로
  };
  const reset = () => {
    // 닫을 때 초기화 — 이전 입력 잔존이 다음 일괄 적용 실수로 이어지지 않게.
    setAttitude(null);
    setHomework("");
    setTextbook("");
    setHomeworkToday("");
    setProgress("");
    setAtt(null); // 출결은 특히 — 남아 있다가 다음 적용에 딸려 나가면 출석부에 그대로 박힌다
    // ⚠️ 과목·진도 학년·모드는 유지 — 같은 반을 연달아 채우는 흐름에서 매번 다시 고르게 하면 손이 는다.
  };
  const apply = () => {
    if (mode === "copy") {
      // 복사는 기본이 '빈 칸만'이라 덮어쓰기를 켠 경우에만 확인한다(되돌리기 없음).
      if (!onlyEmpty && !window.confirm("이미 입력된 진도·교재·오늘 과제도 맨 위 행 값으로 덮어씁니다. 계속할까요?"))
        return;
      onCopyFirstRow(!onlyEmpty);
      setOpen(false);
      return;
    }
    // 확인이 필요한 사유를 모아 **한 번만** 묻는다(다이얼로그가 연달아 뜨면 아무도 안 읽는다).
    const warns: string[] = [];
    // ⚠️ 선택 행이 없으면 **표시 전체**가 대상이라, 이미 개별 입력한 태도/과제를 통째 덮어쓸 수 있다(#4 확정).
    //    "빈 칸만"이 꺼져 있으면(덮어쓰기 모드) 전체 대상일 때 한 번 확인한다(실수 방지, 되돌리기 없음).
    if (selectedCount === 0 && !onlyEmpty) {
      warns.push(
        `· 선택한 행이 없어 표시된 ${targetCount}행 전체에 적용됩니다. 이미 입력한 값도 덮어씁니다.\n  (빈 칸만 채우려면 '빈 칸만 채우기'를 켜세요)`,
      );
    }
    // 출결은 적용 즉시 출석부에 남고 여기서 되돌릴 수 없다 — **기존 기록을 덮을 때만** 따로 밝힌다.
    if (att && attPlan && attPlan.overwrite > 0) {
      warns.push(
        `· 출결 ${attPlan.cells.length}건을 '${BULK_ATTENDANCE_LABEL[att]}'으로 기록합니다 — 그중 ${attPlan.overwrite}건은 이미 있는 기록을 덮어씁니다.\n  출결은 저장 즉시 출석부에 반영되며 여기서는 되돌릴 수 없습니다.`,
      );
    }
    if (warns.length && !window.confirm(`${warns.join("\n\n")}\n\n계속할까요?`)) return;
    onApply(
      { attitude: attitude ?? undefined, homework: homework ?? undefined, textbook, homeworkToday, today: progress },
      onlyEmpty,
      activeSubject?.key ?? "",
      att,
    );
    setOpen(false);
    reset();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <Popover.Trigger
        disabled={disabled}
        className="text-text-dim hover:bg-bg-soft hover:text-foreground data-[popup-open]:bg-bg-soft inline-flex h-8 items-center rounded-lg px-2.5 text-[12.5px] font-bold transition-colors disabled:pointer-events-none disabled:opacity-50"
        title="선택(없으면 표시 전체) 행을 한 번에 채우기 — 직접 입력하거나 맨 위 행을 복사"
      >
        일괄 입력
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card flex w-[300px] flex-col gap-2.5 rounded-lg border p-3 text-[12px] outline-none">
            <p className="text-text-dim text-[11px]">
              대상 <span className="text-foreground font-bold">{targetCount}</span>행
              {selectedCount ? " (선택 행)" : " (표시 전체)"}
            </p>
            {/* 값 출처 — 버튼 두 개(값 일괄 입력·맨 위 행 복사)를 합친 자리(2026-07-23 원장 "겹치는 것 같은데"). */}
            <div className="border-line bg-background inline-flex overflow-hidden rounded-lg border">
              {(
                [
                  { key: "input" as const, label: "직접 입력" },
                  { key: "copy" as const, label: "맨 위 행 복사" },
                ]
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => switchMode(m.key)}
                  aria-pressed={mode === m.key}
                  disabled={m.key === "copy" && !canCopy}
                  className={`flex-1 px-2 py-1 text-[11.5px] not-first:border-l border-line disabled:opacity-40 ${
                    mode === m.key ? "bg-primary text-primary-foreground font-bold" : "text-text-dim hover:bg-bg-soft"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {mode === "copy" ? (
              <div className="border-line bg-bg-soft rounded-md border px-2.5 py-2">
                <p className="text-text-dim text-[11px]">
                  {canCopy ? (
                    <>
                      <span className="text-foreground font-bold">{copySource!.label}</span> 행을 아래{" "}
                      <span className="text-foreground font-bold">{copySource!.belowCount}</span>행에 복사합니다
                    </>
                  ) : (
                    "복사할 아래 행이 없습니다"
                  )}
                </p>
                <p className="text-foreground mt-1.5 text-[11px] font-bold">복사되는 것</p>
                <p className="text-text-dim text-[11px]">진도 · 교재명 · 오늘 과제</p>
                <p className="text-text-faint mt-1 text-[11px]">
                  점수 · 태도 · 과제 수행 · 학부모 문구는 <b>복사되지 않습니다</b>(학생마다 다른 기록)
                </p>
                <p className="text-text-faint mt-1 text-[11px]">
                  다른 과목 행 · 발송 완료 행은 건너뜁니다
                </p>
              </div>
            ) : null}
            {/* 진도 — 유일하게 **과목 한정**이라 한 덩이로 묶어 경계를 눈에 보이게 한다. */}
            {mode === "input" && activeSubject ? (
              <div className="border-line bg-bg-soft/60 rounded-md border p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="micro text-text-faint">오늘 진도</p>
                  {subjects.length > 1 ? (
                    <select
                      value={activeSubject.key}
                      onChange={(e) => setSubjectKey(e.target.value)}
                      aria-label="진도를 넣을 과목"
                      className="border-line bg-card h-6 max-w-[130px] rounded-md border px-1 text-[11px] outline-none"
                    >
                      {subjects.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.name} ({s.count}행)
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-text-faint text-[11px]">
                      {activeSubject.name} {activeSubject.count}행
                    </span>
                  )}
                </div>
                {isMathSubject(activeSubject.key) ? (
                  <ProgressSelector
                    value={progress}
                    onChange={setProgress}
                    studyGrade={grade}
                    onStudyGrade={setGrade}
                    studentGrade={grade}
                    ariaLabel="일괄 진도"
                  />
                ) : (
                  <input
                    type="text"
                    value={progress}
                    onChange={(e) => setProgress(e.target.value)}
                    placeholder="오늘 진도 (예: Unit 8 · p.90)"
                    aria-label="일괄 진도"
                    className="border-line bg-card focus:border-primary h-8 w-full rounded-lg border px-2 text-[12px] outline-none"
                  />
                )}
                <p className="text-text-faint mt-1 text-[11px]">
                  {activeSubject.name} 행에만 들어갑니다 — 다른 과목 행은 그대로
                </p>
              </div>
            ) : null}
            {/* 출결 — 화면 state가 아니라 **출석부에 즉시 기록**되는 유일한 칸이라 따로 묶고 경계를 밝힌다. */}
            {mode === "input" && attendance ? (
              <div className="border-line bg-bg-soft/60 rounded-md border p-2">
                <p className="micro text-text-faint mb-1">출결</p>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setAtt(null)}
                    aria-pressed={att === null}
                    className={`rounded-pill px-2 py-0.5 text-[11px] font-bold transition ${
                      att === null
                        ? "bg-primary text-primary-foreground"
                        : "border-line text-text-dim hover:bg-bg-soft border"
                    }`}
                  >
                    적용 안 함
                  </button>
                  {BULK_ATTENDANCE_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setAtt(att === s ? null : s)}
                      aria-pressed={att === s}
                      className={`rounded-pill px-2 py-0.5 text-[11px] font-bold transition ${
                        att === s
                          ? "bg-primary text-primary-foreground"
                          : "border-line text-text-dim hover:bg-bg-soft border"
                      }`}
                    >
                      {BULK_ATTENDANCE_LABEL[s]}
                    </button>
                  ))}
                </div>
                {/* 고른 즉시 실제 대상·덮어쓸 건수를 보여준다 — 눌러 보고 나서 알게 되면 늦다. */}
                {attPlan ? (
                  <p className={`mt-1 text-[11px] ${attPlan.cells.length ? "text-text-dim" : "text-amber"}`}>
                    {attPlan.cells.length ? (
                      <>
                        <span className="text-foreground font-bold">{attPlan.cells.length}건</span> 기록
                        {attPlan.overwrite ? ` · 기존 기록 ${attPlan.overwrite}건 덮어씀` : ""}
                      </>
                    ) : (
                      "기록할 대상이 없습니다"
                    )}
                    {describeAttendanceSkips(attPlan) ? (
                      <span className="text-text-faint"> · 제외 {describeAttendanceSkips(attPlan)}</span>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-text-faint mt-1 text-[11px]">
                    저장 즉시 출석부에 기록됩니다 — 조퇴·공결·보강 행은 건드리지 않습니다
                  </p>
                )}
              </div>
            ) : null}
            {mode === "input" ? (
              <>
                <div>
                  <p className="micro text-text-faint mb-1">태도</p>
                  <FieldSelect
                    options={attitudes}
                    value={attitude}
                    onSelect={setAttitude}
                    ariaLabel="일괄 태도"
                  />
                </div>
                <div>
                  <p className="micro text-text-faint mb-1">과제 수행률</p>
                  <HomeworkRateInput
                    value={homework}
                    onChange={setHomework}
                    label="일괄 과제 수행률"
                    size="lg"
                  />
                </div>
                <input
                  type="text"
                  value={textbook}
                  onChange={(e) => setTextbook(e.target.value)}
                  placeholder="교재명 (비우면 적용 안 함)"
                  aria-label="일괄 교재명"
                  className="border-line bg-card focus:border-primary h-8 w-full rounded-lg border px-2 text-[12px] outline-none"
                />
                <input
                  type="text"
                  value={homeworkToday}
                  onChange={(e) => setHomeworkToday(e.target.value)}
                  placeholder="오늘 과제 (비우면 적용 안 함)"
                  aria-label="일괄 오늘 과제"
                  className="border-line bg-card focus:border-primary h-8 w-full rounded-lg border px-2 text-[12px] outline-none"
                />
                <p className="text-text-faint text-[11px]">채운 필드만 적용됩니다</p>
              </>
            ) : null}
            <div className="flex items-center justify-between">
              <label className="text-text-dim flex cursor-pointer items-center gap-1 text-[11px]">
                <input
                  type="checkbox"
                  checked={onlyEmpty}
                  onChange={() => setOnlyEmpty((v) => !v)}
                  className="accent-primary size-3.5"
                />
                빈 칸만 채우기
              </label>
              <Button size="sm" onClick={apply} disabled={!hasAny}>
                적용
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
