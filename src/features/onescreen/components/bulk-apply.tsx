"use client";

/**
 * 일괄 입력 팝오버 — 선택(없으면 표시 전체) 행을 한 번에 채운다. **채울 값을 어디서 가져오는지**만 두 갈래:
 *   ① 직접 입력 — 진도·출결·테스트·태도·과제·영상·교재·오늘 과제·특이사항을 여기서 골라 넣는다(빈 필드는 적용 안 함 = 값 지우기 아님).
 *      (테스트·영상·특이사항은 2026-10-02 추가 — 표 행엔 있는데 여기 없던 칸. 그리기는 bulk-apply-extras.tsx.)
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
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { attendanceLabelOf } from "@/features/class-sheets/lib/attendance-label";
import { formatSessionUnits } from "@/features/attendance/session-units";
import { ProgressSelector } from "./progress-selector";
import { ReasonNoteInput } from "./reason-note-input";
import { attitudeNeedsNote, attitudeNoteComplete } from "../math-report-pilot-sections";
import { ProgressModePills } from "./progress-mode-pills";
import type { VideoHomeworkStatus } from "@/features/video-homework/types";
import {
  BulkTestFields,
  BulkVideoFields,
  bulkCount,
  EMPTY_BULK_TESTS,
  EMPTY_BULK_VIDEO,
  type BulkFieldConfig,
} from "./bulk-apply-extras";

/** 대상 행에 있는 과목 — 진도를 넣을 과목 선택지(행 수는 "몇 행에 들어가는지" 표시용). */
export type BulkSubjectOption = { key: string; name: string; count: number };

/** 진도 입력이 커리큘럼(math)인지 — 미지정은 math(진도 셀 분기와 동일 규약). */
const isMathSubject = (key: string) => (key || "math") === "math";

export function BulkApplyPopover({
  targetCount,
  selectedCount,
  fields,
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
  /** 그릴 칸의 재료 — 태도 선택지 · 테스트 사용 여부 · 영상 칸이 있는 행 수(bulk-apply-extras.tsx). */
  fields: BulkFieldConfig;
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
  attendance?: {
    plan: (status: BulkAttendanceStatus, onlyEmpty: boolean) => BulkAttPlan;
    /** 그 날짜가 학원설정 휴원일이면 이름 — 출결을 실을 때 확인 사유에 한 줄 더한다(막지는 않는다). */
    holidayName?: string | null;
  } | null;
  onApply: (
    patch: BulkPatch,
    onlyEmpty: boolean,
    progressSubjectKey: string,
    attendance: BulkAttendanceStatus | null,
    /** 출결 수업타임(시수) — 빈 문자열=미지정(종전과 동일, 새 행 시수 null=1). 새로 만드는 행에만 적용. */
    attendanceUnits: string,
    /** 지난 영상 숙제 검사 — null=적용 안 함. 출결처럼 **적용 즉시 기록**된다(화면 state가 아니다). */
    videoCheck: VideoHomeworkStatus | null,
  ) => void;
  onCopyFirstRow: (overwrite: boolean) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"input" | "copy">("input");
  const [attitude, setAttitude] = useState<string | null>(null);
  // 수업 태도 의견 — 고른 태도가 하·중하일 때만(원장 2026-10-26, 새 수학 보고서 행에 들어간다 · planBulkApply).
  const [attNote, setAttNote] = useState("");
  const [homework, setHomework] = useState<string>("");
  const [textbook, setTextbook] = useState("");
  const [homeworkToday, setHomeworkToday] = useState("");
  const [progress, setProgress] = useState("");
  // 오늘 수업 성격(복습·문제풀이) — 행의 진도 칸과 같은 알약(원장 2026-10-26 *"일괄입력에 진도에 복습, 문제풀이가 선택이 안되는데"*).
  const [lessonMode, setLessonMode] = useState<string | null>(null);
  const [subjectKey, setSubjectKey] = useState<string | null>(null);
  const [grade, setGrade] = useState(studyGrade);
  // 반이 바뀌면(대상 행의 기본 진도 학년이 바뀌면) 그 반 기준으로 다시 연다 — 같은 반에서 고른 학년은 닫아도 유지(reset 주석).
  // 예전엔 처음 마운트 때 한 번만 정해 앞 반의 학년으로 열렸다(2026-10-26 조사). 렌더 중 조건부 갱신 = React가 권하는 '값이 바뀌면 맞추기'.
  const [gradeFor, setGradeFor] = useState(studyGrade);
  if (gradeFor !== studyGrade) {
    setGradeFor(studyGrade);
    setGrade(studyGrade);
  }
  const t = useSheetT();
  const tf = useSheetTf();
  const lang = useSheetLang();
  const [att, setAtt] = useState<BulkAttendanceStatus | null>(null);
  // 출결 수업타임(시수) — 새로 기록되는 칸에만 적용(기존 기록의 시수는 보존). 빈칸=기본(1).
  // 시수는 급여 재료라(감사 P0-2) 3시간 반(1.5) 같은 배수 반을 일괄로 찍을 때 강사가 직접 지정한다.
  const [attUnits, setAttUnits] = useState("");
  // 2026-10-02 추가 칸 — 테스트(개수/문항수) · 영상(지난 검사 · 오늘 과제 · 링크 넣기) · 특이사항.
  const [tests, setTests] = useState(EMPTY_BULK_TESTS);
  const [video, setVideo] = useState(EMPTY_BULK_VIDEO);
  const [note, setNote] = useState("");
  const testPatch = {
    dailyScore: fields.dailyEnabled ? bulkCount(tests.dailyScore) : undefined,
    dailyMax: fields.dailyEnabled && fields.allowTestMax ? bulkCount(tests.dailyMax) : undefined,
    checkScore: fields.checkEnabled ? bulkCount(tests.checkScore) : undefined,
    checkMax: fields.checkEnabled && fields.allowTestMax ? bulkCount(tests.checkMax) : undefined,
  };
  const hasTest = Object.values(testPatch).some((v) => v !== undefined);
  // 모드마다 기본이 다르다(위 주석) — 직접 입력=덮어쓰기, 복사=빈 칸만.
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const canCopy = !!copySource && copySource.belowCount > 0;
  // 고른 출결의 실제 대상 — 상태·'빈 칸만'을 바꿀 때마다 다시 센다(순수 계산이라 렌더 중 안전).
  const attPlan = attendance && att ? attendance.plan(att, onlyEmpty) : null;
  // 고른 영상 검사의 실제 대상 — 같은 규칙(검사·'빈 칸만'을 바꿀 때마다 다시 센다).
  const videoCheckPlan = video.check && fields.videoCheckPlan ? fields.videoCheckPlan(video.check, onlyEmpty) : null;
  // 🔴 시수를 비우면 새 칸에 들어갈 값 — 수학 자동 시수(수업 길이)가 섞이면 '1'이 아니다. 안내가 저장값과
  //    같은 말을 하게 한다(보이는 기본값 = 저장될 값, 원장 2026-09-11). 전부 1이면 종전 문구 그대로.
  const blankUnits = attPlan?.newCellUnits ?? [];
  const blankIsOne = blankUnits.every((u) => u === 1);
  const blankList = blankUnits.map(formatSessionUnits).join("·");
  const hasAny =
    mode === "copy"
      ? canCopy
      : !!(attitude || homework || textbook.trim() || homeworkToday.trim() || progress.trim() || lessonMode || att ||
          note.trim() || hasTest || video.check || video.homework !== null || video.due !== null);
  // 과목이 하나뿐이면 고를 것도 없다 — 그대로 그 과목.
  const activeSubject = subjects.find((s) => s.key === (subjectKey ?? subjects[0]?.key)) ?? subjects[0] ?? null;

  const switchMode = (next: "input" | "copy") => {
    setMode(next);
    setOnlyEmpty(next === "copy"); // 각 모드가 원래 갖고 있던 계약 그대로
  };
  const reset = () => {
    // 닫을 때 초기화 — 이전 입력 잔존이 다음 일괄 적용 실수로 이어지지 않게.
    setAttitude(null);
    setAttNote("");
    setHomework("");
    setTextbook("");
    setHomeworkToday("");
    setProgress("");
    setLessonMode(null);
    setAtt(null); // 출결은 특히 — 남아 있다가 다음 적용에 딸려 나가면 출석부에 그대로 박힌다
    setAttUnits(""); // 시수도 같은 이유 — 급여 재료라 잔존값이 다음 반에 딸려 나가면 안 된다
    setTests(EMPTY_BULK_TESTS);
    setVideo(EMPTY_BULK_VIDEO); // 검사는 적용 즉시 기록된다 — 출결과 같은 이유로 남기지 않는다
    setNote("");
    // ⚠️ 과목·진도 학년·모드는 유지 — 같은 반을 연달아 채우는 흐름에서 매번 다시 고르게 하면 손이 는다.
  };
  const apply = () => {
    if (mode === "copy") {
      // 복사는 기본이 '빈 칸만'이라 덮어쓰기를 켠 경우에만 확인한다(되돌리기 없음).
      if (!onlyEmpty && !window.confirm(t("os.bulk.confirmCopy")))
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
        tf("os.bulk.warnAll", { n: targetCount }),
      );
    }
    // 대상이 여러 반인데 수업 내용 칸(진도·교재·오늘 과제)을 넣으면 반 이름을 밝힌다(원장 2026-10-15 — 다른 반·다른 학년 학부모에게
    // 엉뚱한 과제가 나갔다). 막지는 않는다 — 시험 대비처럼 여러 반에 일부러 같은 내용을 넣기도 한다.
    const contentAll = !!(textbook.trim() || homeworkToday.trim()); // 교재·오늘 과제 = 모든 대상 행
    const progressKey = progress.trim() || lessonMode ? (activeSubject?.key ?? null) : null; // 진도 = 고른 과목 행만(planBulkApply)
    const classNames = [...new Set((fields.classRows ?? [])
      .filter((r) => contentAll || (progressKey !== null && r.subjectKey === progressKey))
      .map((r) => r.className))];
    if (classNames.length > 1) {
      warns.push(tf("os.bulk.warnMultiClass", { n: classNames.length, names: classNames.join(", ") }));
    }
    // 휴원일에 출결을 실으면 한 번 묻는다(원장 2026-10-13 — 10/9 한글날 금요일 반 19명이 이 길로 출석이 됐다).
    // 휴원일에도 수업하는 날이 있어 막지는 않는다 — 같은 확인창에 한 줄로 모은다.
    const holidayName = attendance?.holidayName;
    if (att && attPlan && attPlan.cells.length > 0 && holidayName) {
      warns.push(tf("os.bulk.warnHoliday", { name: holidayName, n: attPlan.cells.length }));
    }
    // 출결은 적용 즉시 출석부에 남고 여기서 되돌릴 수 없다 — **기존 기록을 덮을 때만** 따로 밝힌다.
    if (att && attPlan && attPlan.overwrite > 0) {
      warns.push(
        tf("os.bulk.warnAtt", {
          n: attPlan.cells.length,
          label: attendanceLabelOf(att, lang) ?? BULK_ATTENDANCE_LABEL[att],
          over: attPlan.overwrite,
        }),
      );
    }
    // 영상 검사도 적용 즉시 기록된다 — 이미 찍힌 검사를 바꿀 때만 밝힌다('미제출'은 적어 둔 제출일까지 지운다).
    if (video.check && videoCheckPlan && videoCheckPlan.overwrite > 0) {
      warns.push(
        tf("os.bulk.warnVideoCheck", {
          n: videoCheckPlan.cells,
          label: t(video.check === "submitted" ? "os.vh.done" : "os.vh.missing"),
          over: videoCheckPlan.overwrite,
        }),
      );
    }
    if (warns.length && !window.confirm(`${warns.join("\n\n")}\n\n${t("os.bulk.confirmTail")}`)) return;
    onApply(
      {
        attitude: attitude ?? undefined, homework: homework ?? undefined, textbook, homeworkToday, today: progress,
        ...(attitudeNeedsNote(attitude) && attNote.trim() ? { attitudeNote: attNote } : {}),
        note,
        // 수업 성격 — 고른 때만(진도와 같은 과목 행에만 들어간다, planBulkApply).
        ...(lessonMode ? { progressMode: lessonMode } : {}),
        ...testPatch,
        // 영상 과제 — 고른 때만. 링크 넣기는 '있음'과 함께 켠 때만 싣는다(안 켰으면 그 값은 건드리지 않는다).
        ...(video.homework !== null ? { videoHomework: video.homework } : {}),
        ...(video.homework === true && video.link ? { videoSubmitLink: true } : {}),
        // 마감 — 고른 때만('없음'을 고르면 마감 줄이 숨고 값도 버린다). 영상 과제가 켜진 행에만 들어간다(planBulkApply).
        ...(video.due !== null && video.homework !== false ? { videoHomeworkDue: video.due } : {}),
      },
      onlyEmpty,
      activeSubject?.key ?? "",
      att,
      att && att !== "absent" ? attUnits.trim() : "", // 결석엔 시수가 무의미(소비 0) — 안 보낸다
      video.check,
    );
    setOpen(false);
    reset();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o, details) => {
        // 진도 선택 창(이 창 안의 두 번째 팝오버)이 떠 있는 채로 바깥을 누르면 그 클릭은 '선택 창 닫기'다 — 이 창까지 닫고
        // 초기화하면 고른 진도가 사라져 "튕겨서 입력이 안 된다"(원장 제보 2026-10-26 · 7/23 도입 때부터). 선택 창만 닫히고 이 창은 남는다.
        // 같은 클릭 안에서는 선택 창이 아직 화면에 있다(닫힘은 클릭 처리가 끝난 뒤 반영) — 순서와 상관없이 같은 판정.
        if (!o && details.reason === "outside-press" && document.querySelector("[data-progress-picker]")) return;
        setOpen(o);
        if (!o) reset();
      }}
    >
      <Popover.Trigger
        disabled={disabled}
        className="text-text-dim hover:bg-bg-soft hover:text-foreground data-[popup-open]:bg-bg-soft inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-bold transition-colors disabled:pointer-events-none disabled:opacity-50"
        title={t("os.bulk.title")}
      >
        {t("os.bulk.btn")}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          {/* 칸이 늘어 창 높이를 넘을 수 있다 — 화면에 남은 높이까지만 쓰고 안에서 스크롤한다(적용 버튼이 화면 밖으로 나가지 않게). */}
          <Popover.Popup className="bg-card border-line shadow-card flex max-h-[min(85dvh,var(--available-height))] w-[min(640px,calc(100vw-24px))] flex-col gap-2.5 overflow-hidden rounded-lg border p-3 text-xs outline-none">
            <p className="text-text-dim text-xs">
              {t("os.bulk.targetPre")}
              <span className="text-foreground font-bold">{targetCount}</span>
              {t("os.bulk.targetPost")}
              {selectedCount ? t("os.bulk.targetSel") : t("os.bulk.targetAll")}
            </p>
            {/* 값 출처 — 버튼 두 개(값 일괄 입력·맨 위 행 복사)를 합친 자리(2026-07-23 원장 "겹치는 것 같은데"). */}
            <div className="border-line bg-background inline-flex shrink-0 overflow-hidden rounded-lg border">
              {(
                [
                  { key: "input" as const, label: t("os.bulk.modeInput") },
                  { key: "copy" as const, label: t("os.bulk.modeCopy") },
                ]
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => switchMode(m.key)}
                  aria-pressed={mode === m.key}
                  disabled={m.key === "copy" && !canCopy}
                  className={`flex-1 px-2 py-1 text-xs not-first:border-l border-line disabled:opacity-40 ${
                    mode === m.key ? "bg-primary text-primary-foreground font-bold" : "text-text-dim hover:bg-bg-soft"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="grid min-h-0 grid-cols-1 items-start gap-3 overflow-y-auto overscroll-contain sm:grid-cols-2">
            {mode === "copy" ? (
              <div className="border-line bg-bg-soft rounded-md border px-2.5 py-2 sm:col-span-2">
                <p className="text-text-dim text-xs">
                  {canCopy ? (
                    <>
                      <span className="text-foreground font-bold">{copySource!.label}</span>
                      {t("os.bulk.copyA")}
                      <span className="text-foreground font-bold">{copySource!.belowCount}</span>
                      {t("os.bulk.copyB")}
                    </>
                  ) : (
                    t("os.bulk.copyNone")
                  )}
                </p>
                <p className="text-foreground mt-1.5 text-xs font-bold">{t("os.bulk.copyWhat")}</p>
                <p className="text-text-dim text-xs">{t("os.bulk.copyList")}</p>
                <p className="text-text-faint mt-1 text-xs">
                  {t("os.bulk.copyNotA")}
                  <b>{t("os.bulk.copyNotB")}</b>
                  {t("os.bulk.copyNotC")}
                </p>
                <p className="text-text-faint mt-1 text-xs">
                  {t("os.bulk.copySkip")}
                </p>
              </div>
            ) : null}
            {/* 진도 — 유일하게 **과목 한정**이라 한 덩이로 묶어 경계를 눈에 보이게 한다. */}
            {mode === "input" && activeSubject ? (
              <div className="border-line bg-bg-soft/60 rounded-md border p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="micro text-text-faint">{t("os.pc.title")}</p>
                  {subjects.length > 1 ? (
                    <select
                      value={activeSubject.key}
                      onChange={(e) => setSubjectKey(e.target.value)}
                      aria-label={t("os.bulk.subjectAria")}
                      className="border-line bg-card h-6 max-w-[130px] rounded-md border px-1 text-xs outline-none"
                    >
                      {subjects.map((s) => (
                        <option key={s.key} value={s.key}>
                          {tf("os.bulk.subjectOpt", { name: s.name, n: s.count })}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-text-faint text-xs">
                      {tf("os.bulk.subjectOne", { name: activeSubject.name, n: activeSubject.count })}
                    </span>
                  )}
                </div>
                {isMathSubject(activeSubject.key) ? (
                  <ProgressSelector
                    value={progress}
                    onChange={setProgress}
                    mode={lessonMode}
                    onMode={setLessonMode}
                    studyGrade={grade}
                    onStudyGrade={setGrade}
                    studentGrade={grade}
                    ariaLabel={t("os.bulk.progressAria")}
                  />
                ) : (
                  <input
                    type="text"
                    value={progress}
                    onChange={(e) => setProgress(e.target.value)}
                    placeholder={t("os.row.progressPh")}
                    aria-label={t("os.bulk.progressAria")}
                    className="border-line bg-card focus:border-primary h-8 w-full rounded-lg border px-2 text-xs outline-none"
                  />
                )}
                {/* 수학은 진도 고르기 안에 알약이 있다 — 자유 입력 과목만 칸 아래에(행과 같은 자리). */}
                {isMathSubject(activeSubject.key) ? null : (
                  <ProgressModePills mode={lessonMode} onMode={setLessonMode} compact ariaLabel={t("os.bulk.progressAria")} />
                )}
                <p className="text-text-faint mt-1 text-xs">
                  {tf("os.bulk.subjectOnly", { name: activeSubject.name })}
                </p>
              </div>
            ) : null}
            {/* 출결 — 화면 state가 아니라 **출석부에 즉시 기록**되는 유일한 칸이라 따로 묶고 경계를 밝힌다. */}
            {mode === "input" && attendance ? (
              <div className="border-line bg-bg-soft/60 rounded-md border p-2">
                <p className="micro text-text-faint mb-1">{t("os.card.attendance")}</p>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setAtt(null)}
                    aria-pressed={att === null}
                    className={`rounded-pill px-2 py-0.5 text-xs font-bold transition ${
                      att === null
                        ? "bg-primary text-primary-foreground"
                        : "border-line text-text-dim hover:bg-bg-soft border"
                    }`}
                  >
                    {t("os.bulk.attNone")}
                  </button>
                  {BULK_ATTENDANCE_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setAtt(att === s ? null : s)}
                      aria-pressed={att === s}
                      className={`rounded-pill px-2 py-0.5 text-xs font-bold transition ${
                        att === s
                          ? "bg-primary text-primary-foreground"
                          : "border-line text-text-dim hover:bg-bg-soft border"
                      }`}
                    >
                      {attendanceLabelOf(s, lang) ?? BULK_ATTENDANCE_LABEL[s]}
                    </button>
                  ))}
                </div>
                {/* 수업타임(시수) — 출석·지각일 때만(결석은 시수 소비 0). 새로 만드는 기록에만 적용되고
                    기존 기록의 시수는 보존된다(급여 재료 — 3시간 반은 1.5, 감사 P0-2). */}
                {att && att !== "absent" ? (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={attUnits}
                      onChange={(e) => setAttUnits(e.target.value)}
                      placeholder={t("os.card.units")}
                      aria-label={t("os.bulk.unitsAria")}
                      title={blankIsOne ? t("os.bulk.unitsTitle") : tf("os.bulk.unitsTitleAuto", { list: blankList })}
                      className="border-line bg-card focus:border-primary h-7 w-20 rounded-lg border px-2 text-xs outline-none"
                    />
                    <span className="text-text-faint text-xs">
                      {blankIsOne ? t("os.bulk.unitsHint") : tf("os.bulk.unitsHintAuto", { list: blankList })}
                    </span>
                  </div>
                ) : null}
                {/* 고른 즉시 실제 대상·덮어쓸 건수를 보여준다 — 눌러 보고 나서 알게 되면 늦다. */}
                {attPlan ? (
                  <p className={`mt-1 text-xs ${attPlan.cells.length ? "text-text-dim" : "text-amber"}`}>
                    {attPlan.cells.length ? (
                      <>
                        <span className="text-foreground font-bold">{attPlan.cells.length}</span>
                        {t("os.bulk.planRecord")}
                        {attPlan.overwrite ? tf("os.bulk.planOver", { n: attPlan.overwrite }) : ""}
                      </>
                    ) : (
                      t("os.bulk.planNone")
                    )}
                    {describeAttendanceSkips(attPlan, lang) ? (
                      <span className="text-text-faint">
                        {tf("os.bulk.planSkip", { list: describeAttendanceSkips(attPlan, lang) })}
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-text-faint mt-1 text-xs">
                    {t("os.bulk.attHint")}
                  </p>
                )}
              </div>
            ) : null}
            {mode === "input" ? (
              <>
                <div className="flex flex-col gap-2.5">
                <BulkTestFields config={fields} value={tests} onChange={setTests} />
                <div>
                  <p className="micro text-text-faint mb-1">{t("os.col.attitude")}</p>
                  <FieldSelect
                    options={fields.attitudes}
                    value={attitude}
                    onSelect={setAttitude}
                    ariaLabel={t("os.bulk.attitudeAria")}
                  />
                  {attitudeNeedsNote(attitude) ? (
                    <ReasonNoteInput
                      multiline
                      value={attNote}
                      done={attitudeNoteComplete(attNote)}
                      labelKey="os.card.attNote.label"
                      placeholderKey="os.card.attNote.ph"
                      onChange={setAttNote}
                    />
                  ) : null}
                </div>
                <div>
                  <p className="micro text-text-faint mb-1">{t("os.col.homework")}</p>
                  <HomeworkRateInput
                    value={homework}
                    onChange={setHomework}
                    label={t("os.bulk.hwAria")}
                    size="lg"
                  />
                </div>
                </div>
                <div className="flex flex-col gap-2.5">
                <BulkVideoFields config={fields} value={video} onChange={setVideo} checkPlan={videoCheckPlan} />
                <input
                  type="text"
                  value={textbook}
                  onChange={(e) => setTextbook(e.target.value)}
                  placeholder={t("os.bulk.bookPh")}
                  aria-label={t("os.bulk.bookAria")}
                  className="border-line bg-card focus:border-primary h-8 w-full rounded-lg border px-2 text-xs outline-none"
                />
                <input
                  type="text"
                  value={homeworkToday}
                  onChange={(e) => setHomeworkToday(e.target.value)}
                  placeholder={t("os.bulk.hwTodayPh")}
                  aria-label={t("os.bulk.hwTodayAria")}
                  className="border-line bg-card focus:border-primary h-8 w-full rounded-lg border px-2 text-xs outline-none"
                />
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("os.bulk.notePh")}
                  aria-label={t("os.bulk.noteAria")}
                  className="border-line bg-card focus:border-primary h-8 w-full rounded-lg border px-2 text-xs outline-none"
                />
                <p className="text-text-faint text-xs">{t("os.bulk.onlyFilled")}</p>
                </div>
              </>
            ) : null}
            </div>
            <div className="border-line flex shrink-0 items-center justify-between border-t pt-2">
              <label className="text-text-dim flex cursor-pointer items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={onlyEmpty}
                  onChange={() => setOnlyEmpty((v) => !v)}
                  className="accent-primary size-3.5"
                />
                {t("os.bulk.onlyEmpty")}
              </label>
              <Button size="sm" onClick={apply} disabled={!hasAny}>
                {t("os.bulk.apply")}
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
