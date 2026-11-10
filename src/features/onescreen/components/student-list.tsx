"use client";

import { MakeupClassTag } from "./makeup-class-tag";
import { ReservedMakeupTag } from "./reserved-makeup-tag";
import { studentReservations } from "../reserved-makeup";
import { useState } from "react";
import { ChevronDown } from "@/components/icons/aywa-icon-compat";
import { BulkPresentButton, type BulkPresentProps } from "./bulk-present-button";
import { studentListGroups } from "../student-list-groups";
import { useLessonClock } from "./use-lesson-clock";
import { useDisplayOptions } from "./display-options-context";
import type { SendMark } from "../send-mark";
export type { SendMark } from "../send-mark";
import { studentStatus, type TestConfig } from "../report";
import { SUBJECT_SOLID, subjectColorOfRow } from "@/features/owner/subjects";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { CellState, OneScreenStudent } from "../types";
import { attendanceMarkBadgeClass, attendanceMarkLabel, MARK_PRESENT } from "../attendance-mark";
import { CLASS_GROUP_MAKEUP, CLASS_GROUP_OTHER } from "../class-tags";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { CnBadge } from "./cn-badge";
import type { CnLabel } from "../classnote-match";
import type { SheetDictKey } from "@/features/teacher-view/i18n";

const CELL_CLASS: Record<CellState, string> = {
  ok: "bg-primary-soft text-primary",
  warn: "bg-amber-soft text-amber",
  todo: "bg-bg-soft text-text-faint",
};

/**
 * 진행 상태 칸 — 🔴 **한 글자로 줄이지 않는다**(원장 2026-08-07: *"한글자만 적으니까 잘 이해도 안되게
 * 보이네. 공간 충분한거 같으니까 라벨 확장"*). '진'·'테'·'보'는 쓴 사람만 아는 축약이고, 옆에 툴팁을
 * 달아 봐야 같은 한 글자라 도움이 안 됐다. 자리가 있으니 낱말로 적는다.
 * ⚠️ `title`은 라벨을 되풀이하지 말고 **그 칸이 무엇을 기다리는지**를 적는다(라벨과 같은 말이면 무의미).
 */
const CELLS: { key: "prog" | "test" | "rep"; label: SheetDictKey; title: SheetDictKey }[] = [
  { key: "prog", label: "os.chip.prog", title: "os.chip.prog.title" },
  { key: "test", label: "os.chip.test", title: "os.chip.test.title" },
  { key: "rep", label: "os.chip.rep", title: "os.chip.rep.title" },
];

function StudentRow({
  st,
  active,
  reportCell,
  sendMark,
  cn,
  onClick,
  testConfig,
  showClass = false,
}: {
  st: OneScreenStudent;
  active: boolean;
  reportCell?: CellState;
  sendMark?: SendMark;
  /** ClassNote 반 보드 매칭(수학 행만 — 호출부가 cnLabelFor로 판정). null = 라벨 없음. */
  cn?: CnLabel | null;
  onClick: () => void;
  testConfig?: TestConfig;
  showClass?: boolean;
}) {
  const lang = useSheetLang();
  const t = useSheetT();
  const s = studentStatus(st, testConfig);
  const tf = useSheetTf();
  const subjectMaps = useSubjectMaps(); // 과목 점 색 = 학원설정(운영 enum 하드코딩 금지)
  const reportTitle = (sendMark?.overdue ?? 0) > 0 ? t("os.list.overdue")
    : sendMark && sendMark.sent > 0 ? tf("os.list.sendDetail", { label: sendMark.label, sent: sendMark.sent, total: sendMark.total }) : t("os.chip.rep.title");
  // 보(보고서) 셀은 과목별 발송 상태로 재정의 가능 (클라이언트가 reportCellById로 전달).
  const cellState = (key: "prog" | "test" | "rep"): CellState =>
    key === "rep" ? (reportCell ?? s.rep) : s[key];
  const makeupRow = st.subjects.find((su) => su.makeup && !su.classId);
  const reservations = studentReservations(st);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-md border px-2.5 py-2 text-left transition ${
        active ? "border-primary bg-primary-soft/40" : "border-transparent hover:bg-bg-soft"
      }`}
    >
      <div className="contents">
        <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-foreground max-w-full break-all text-sm font-bold">{st.name}</span>
          <CnBadge label={cn ?? null} className={st.className} />
          {showClass ? <span className="text-text-faint truncate text-xs">{st.subjects[0]?.className ?? st.className}</span> : null}
        </div>
        {/* 둘째 줄 = 학년 · 과목 점 · **출결 배지**.
            🔴 배지가 여기로 내려온 이유(원장 2026-08-18 *"이거 왜 짤리지?"*): 목록 열은 **폭이 고정**이고
               오른쪽 진도·테스트·보고서 칩이 `shrink-0`로 먼저 가져간다. 남는 폭을 이름과 배지가 나눠 쓰다
               보니 배지가 한 글자 폭까지 찌그러져 **"결/석"으로 쪼개졌다**(글자가 깨지면 축약보다 못하다 —
               아래 칩 주석과 같은 원칙). 둘째 줄은 학년+점뿐이라 자리가 남는다.
            ⚠️ **여기에 px 예산을 다시 적지 말 것** — 옛 주석이 "열 240px · 칩 ~124px · 남는 ~84px"이라고
               적어 뒀는데, 타입 스케일 v5(2026-09-08)가 칩 글자를 키우면서 그 예산이 조용히 무너져
               **이름이 한 글자로 잘렸다**(원장 제보 *"학생 이름이 짤려버리는거"*). 열은 300px로 넓혔고
               (가운데를 590→530으로 줄여 총폭 유지 — 원장 *"가운데 영역을 줄여서라도 왼쪽 이름이 다 나오게"*),
               칩 폭은 글자 크기를 따라 변한다. 숫자가 필요하면 **화면에서 재라**(주석의 숫자는 늙는다).
            ⚠️ `whitespace-nowrap`을 빼지 말 것 — 이 배지가 쪼개진 게 이 수정의 발단이다.
            ⚠️ 학년은 `min-w-0 truncate` — 긴 학교명이 와도 배지를 밀어내 다시 찌그러뜨리지 않게. */}
        <div className="text-text-faint flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
          <span className="min-w-0 truncate">{st.grade}</span>
          <span className="flex shrink-0 items-center gap-0.5">
            {st.subjects.map((su, i) => (
              <span
                key={i}
                className={`size-1.5 rounded-full ${SUBJECT_SOLID[subjectColorOfRow(subjectMaps, su)]}`}
                title={su.name}
              />
            ))}
          </span>
          {st.attendance !== MARK_PRESENT ? (
            <span
              className={`shrink-0 rounded-full px-1 py-px text-xs font-bold whitespace-nowrap ${attendanceMarkBadgeClass(st.attendance)}`}
            >
              {attendanceMarkLabel(st.attendance, lang)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {CELLS.map((c) => (
          <span
            key={c.key}
            title={c.key === "rep" ? reportTitle : t(c.title)}
            // 낱말이 들어가므로 정사각(size-5)이 아니라 **글자 폭을 따라가는 알약**으로. shrink-0 =
            // 이름이 길어도 이 칸이 찌그러져 글자가 깨지지 않게(찌그러지면 축약보다 못하다).
            className={`shrink-0 rounded-sm px-1.5 py-0.5 text-xs font-bold whitespace-nowrap ${c.key === "rep" && sendMark && sendMark.total > 0
              ? (sendMark.overdue ?? 0) > 0 ? "bg-danger-soft text-danger"
                : sendMark.sent >= sendMark.total ? sendMark.delivery === false ? CELL_CLASS.ok : "bg-green-soft text-green"
                  : sendMark.sent === 0 && cellState(c.key) !== "warn" ? CELL_CLASS.todo : CELL_CLASS.warn
              : CELL_CLASS[cellState(c.key)]}`}
          >
            {t(c.label)}
          </span>
        ))}
      </div>
      {/* 보강 표식 줄 = 셋째 줄 전체 폭(원장 2026-10-27 *"보강이 라벨 겹침 현상"*). 둘째 줄 왼쪽 칸에 두면 줄바꿈 없는 표식
          ('보강 예약 18:20~19:15'·보강 반 이름)이 좁은 칸을 넘쳐 오른쪽 진도·테스트·보고서 칩 밑으로 들어갔다.
          ⚠️ 칩 뒤에 둘 것 — 격자 자동 배치라 칩 앞에 두면 칩이 다음 줄 왼쪽으로 밀린다.
          · 보강 줄의 보강 반(원장 2026-09-30 — 보강 묶음에 서 있어도 어느 반으로 들어가는지). 표시만(이 줄 전체가 버튼이다).
          · 그날 보강 예약(0264a) — 정규 수업일 예약은 정규 줄에 합쳐져 따로 줄이 안 서므로 목록에서 바로 보이게(원장 2026-10-22). */}
      {makeupRow || reservations.length > 0 ? (
        <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-1 text-xs">
          {makeupRow ? <MakeupClassTag subject={makeupRow} /> : null}
          <ReservedMakeupTag list={reservations} />
        </div>
      ) : null}
    </button>
  );
}

export function StudentList({
  students,
  selId,
  onSelect,
  reportCellById,
  sendMarkById,
  classOrder,
  testConfig,
  bulkPresent,
  emptyLabel,
  selectedSubjectName,
  statusForStudent,
  classFilter = null,
}: {
  students: OneScreenStudent[];
  classFilter?: string | null;
  selId: string;
  onSelect: (id: string, subjectName?: string) => void;
  selectedSubjectName?: string;
  statusForStudent?: (student: OneScreenStudent, now: string | null) => {
    reportCell: CellState;
    sendMark: SendMark;
    cn?: CnLabel | null;
  };
  reportCellById?: Record<string, CellState>;
  /** 보고서 라벨의 색·툴팁 — 학생 id → 발송한 행 수·전체 행 수. */
  sendMarkById?: Record<string, SendMark>;
  /** 빈 목록 문구 — 반이 아니라 **작성 필터** 때문에 비었을 때 사실과 다른 말을 하지 않도록 호출부가 덮어쓴다.
   *  안 넘기면 사전 기본값. */
  emptyLabel?: string;
  /** 반 그룹 표시 순서(보통 시각순). 없으면 등장 순서. */
  classOrder?: readonly string[];
  /** 테스트 사용 여부 — '테' 셀이 비활성 테스트를 요구하지 않게(#25). */
  testConfig?: TestConfig;
  /**
   * 머리의 '일괄 출석'(빠른 출결) — 재료·핸들러. **없으면 버튼 자체를 안 그린다**(출결 쓰기 권한이
   * 없을 때. 누를 수 있는 것처럼 보였다가 서버가 거절하는 게 최악 — attendance-pills와 같은 규약).
   * 대상 계산은 호출부가 [planQuickPresent](../quick-attendance.ts)로 한다 — 반 필터를 아는 쪽이고,
   * 표 모드와 **같은 한 번의 계산**을 나눠 써야 두 화면이 다른 수를 말하지 않는다.
   */
  bulkPresent?: BulkPresentProps;
}) {
  // 반별 그룹 — className 없으면 "기타"로.
  const t = useSheetT();
  const tf = useSheetTf();
  const now = useLessonClock();
  const { options } = useDisplayOptions();
  const byClass = studentListGroups(students, classFilter);
  const groups = options.sort === "name"
    ? new Map([["__name__", [...byClass.values()].flat().sort((a, b) => a.name.localeCompare(b.name, "ko"))]])
    : byClass;
  const orderedKeys = [
    ...(classOrder ?? []).filter((k) => groups.has(k)),
    ...[...groups.keys()].filter((k) => !(classOrder ?? []).includes(k)),
  ];

  // 반 그룹별 접기 상태 (세션 한정 — 새로고침 시 초기화).
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allCollapsed = orderedKeys.length > 0 && orderedKeys.every((k) => collapsed.has(k));

  return (
    /* 높이 = 창에 맞춤(2026-07-27 원장: "하단 공간이 이렇게 많은데 왜 저기서 잘라버리나").
       예전엔 안쪽 스크롤러에 `max-h-[calc(100vh-220px)]` 고정값을 박아, 화면을 아래로 굴려 상단 바가
       사라진 뒤에도 그 220px을 계속 비워 둬 목록만 일찍 잘렸다.
       → 2026-08-06부터 넓은 화면은 **3열 한 화면 배치**라 이 카드가 열 높이를 그대로 채우고(`lg:h-full`)
       안쪽 목록만 스크롤한다(sticky 불필요 — 페이지가 아예 안 굴러간다). 좁은 화면(세로 적층)에선
       60vh까지만 차지하고 나머지는 페이지가 스크롤한다.
       글자 확대·사이드바로 oscard가 846px 미만이면 viewport lg여도 같은 세로 적층 규칙을 쓴다. */
    <div className="bg-card border-line shadow-card flex flex-col overflow-hidden rounded-2xl border lg:h-full lg:min-h-0 @max-[846px]/oscard:h-auto">
      <header className="border-line flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <p className="micro text-text-faint">{t(options.sort === "name" ? "os.stat.students" : "os.list.caption")}</p>
        <div className="flex items-center gap-2">
          {bulkPresent ? <BulkPresentButton {...bulkPresent} /> : null}
          {orderedKeys.length > 1 ? (
            <button
              type="button"
              onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(orderedKeys))}
              className="text-text-faint hover:text-text-dim text-xs font-medium whitespace-nowrap"
            >
              {allCollapsed ? t("os.list.expandAll") : t("os.list.collapseAll")}
            </button>
          ) : null}
          <p className="text-text-dim font-mono text-xs">
            {tf("os.list.count", { n: new Set([...groups.values()].flatMap(rows => rows.map(row => row.id))).size })}
          </p>
        </div>
      </header>
      <div className="scrollbar-thin flex max-h-[60vh] min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 lg:max-h-none @max-[846px]/oscard:max-h-[60vh] [scrollbar-gutter:stable]">
        {students.length === 0 ? (
          <p className="text-text-faint px-2 py-6 text-center text-xs">
            {emptyLabel ?? t("os.list.empty")}
          </p>
        ) : (
          orderedKeys.map((key) => {
            const rows = groups.get(key)!;
            const isCollapsed = collapsed.has(key);
            return (
              <div key={key} className="flex flex-col gap-1">
                {/* 반 헤더 — 클릭하면 접기/펼치기, sticky로 스크롤 중에도 어느 반인지 보이게 */}
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  aria-expanded={!isCollapsed}
                  className="bg-card hover:bg-bg-soft border-line sticky top-0 z-10 flex items-center justify-between gap-1.5 border-b px-1.5 py-2 text-left transition-colors"
                >
                  <span className="flex min-w-0 items-center gap-1">
                    <ChevronDown
                      className={`text-text-faint size-3 shrink-0 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                      strokeWidth={2.5}
                    />
                    <span className="text-text-dim truncate text-xs font-bold">
                      {/* 🔴 반 이름은 한국어 그대로 — 원스크린은 학부모 보고서를 짓는 표면이다. */}
                      {key === "__name__" ? t("os.display.byName") : key === CLASS_GROUP_OTHER
                        ? t("os.list.noClass")
                        : key === CLASS_GROUP_MAKEUP
                          ? t("os.list.makeup")
                          : key}
                    </span>
                  </span>
                  <span className="text-text-faint shrink-0 font-mono text-xs">
                    {tf("os.list.count", { n: new Set(rows.map(row => row.id)).size })}
                  </span>
                </button>
                {!isCollapsed
                  ? rows.map((st) => {
                      const rowStatus = statusForStudent?.(st, now);
                      return (
                        <StudentRow
                          key={`${st.id}:${st.subjects[0]?.name ?? ""}`}
                          st={st}
                          active={st.id === selId && (!selectedSubjectName || st.subjects.some(su => su.name === selectedSubjectName))}
                          reportCell={rowStatus?.reportCell ?? reportCellById?.[st.id]}
                          sendMark={rowStatus?.sendMark ?? sendMarkById?.[st.id]}
                          cn={rowStatus?.cn}
                          onClick={() => onSelect(st.id, st.subjects[0]?.name)}
                          testConfig={testConfig}
                          showClass={options.sort === "name"}
                        />
                      );
                    })
                  : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
