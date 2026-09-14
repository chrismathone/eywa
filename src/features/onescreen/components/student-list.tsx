"use client";

import { useState } from "react";
import { ChevronDown } from "@/components/icons/eywa-icon-compat";
import { BulkPresentButton, type BulkPresentProps } from "./bulk-present-button";
import { EyIcon } from "@/components/icons/eywa-icons";
import { studentStatus, type TestConfig } from "../report";
import { subjectTone, toneSolidClass } from "../data";
import type { CellState, OneScreenStudent } from "../types";
import { attendanceMarkLabel, MARK_LATE, MARK_PRESENT } from "../attendance-mark";
import { CLASS_GROUP_MAKEUP, CLASS_GROUP_OTHER } from "../class-tags";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import type { SheetDictKey } from "@/features/teacher-view/i18n";

/**
 * 이름 옆 발송 표시 재료(원장 요청 2026-07-27: "발송완료면 체크 같은 걸 이름 옆에").
 * `sent`=학부모에게 나간 행 수 / `total`=나갈 수 있는 행 수(결석 행 제외 — 호출부가 세어 넘긴다).
 * 표시 기준(ClassNote 게시 vs 보고서 저장)은 학원 설정에 따라 갈리므로 호출부가 `label`로 그 사실을 밝힌다.
 */
export type SendMark = { sent: number; total: number; label: string };

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
  onClick,
  testConfig,
}: {
  st: OneScreenStudent;
  active: boolean;
  reportCell?: CellState;
  sendMark?: SendMark;
  onClick: () => void;
  testConfig?: TestConfig;
}) {
  const lang = useSheetLang();
  const t = useSheetT();
  const s = studentStatus(st, testConfig);
  // 보(보고서) 셀은 과목별 발송 상태로 재정의 가능 (클라이언트가 reportCellById로 전달).
  const cellState = (key: "prog" | "test" | "rep"): CellState =>
    key === "rep" ? (reportCell ?? s.rep) : s[key];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition ${
        active ? "border-primary bg-primary-soft/40" : "border-transparent hover:bg-bg-soft"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground truncate text-sm font-bold">{st.name}</span>
          {/* 발송 표시 — 라벨 색(보 셀)만으로는 '나갔는지'가 눈에 안 띈다는 원장 지적(2026-07-27).
              ⚠️ 표시는 **실제로 나간 행**에만 붙는다: 전부 나갔으면 채운 체크, 일부면 흐린 체크 + 남은 수.
                 아무것도 안 나갔으면 아무 표시도 없다(없음 = 미발송, 거짓 안심 금지). */}
          {sendMark && sendMark.total > 0 && sendMark.sent > 0 ? (
            <span
              title={`${sendMark.label} ${sendMark.sent}/${sendMark.total}`}
              className={`flex shrink-0 items-center gap-0.5 rounded-full px-1 py-px text-xs font-bold whitespace-nowrap ${
                sendMark.sent >= sendMark.total
                  ? "bg-primary-soft text-primary"
                  : "border-line text-text-faint border"
              }`}
            >
              <EyIcon name="check" size={10} />
              {sendMark.sent < sendMark.total ? (
                <span className="tabular">
                  {sendMark.sent}/{sendMark.total}
                </span>
              ) : null}
            </span>
          ) : null}
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
        <div className="text-text-faint mt-0.5 flex items-center gap-1.5 text-xs">
          <span className="min-w-0 truncate">{st.grade}</span>
          <span className="flex shrink-0 items-center gap-0.5">
            {st.subjects.map((su, i) => (
              <span
                key={i}
                className={`size-1.5 rounded-full ${toneSolidClass(subjectTone(su.name).tone)}`}
                title={su.name}
              />
            ))}
          </span>
          {st.attendance !== MARK_PRESENT ? (
            <span
              className={`shrink-0 rounded-full px-1 py-px text-xs font-bold whitespace-nowrap ${
                st.attendance === MARK_LATE ? "bg-amber-soft text-amber" : "bg-danger-soft text-danger"
              }`}
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
            title={t(c.title)}
            // 낱말이 들어가므로 정사각(size-5)이 아니라 **글자 폭을 따라가는 알약**으로. shrink-0 =
            // 이름이 길어도 이 칸이 찌그러져 글자가 깨지지 않게(찌그러지면 축약보다 못하다).
            className={`shrink-0 rounded-sm px-1.5 py-0.5 text-xs font-bold whitespace-nowrap ${CELL_CLASS[cellState(c.key)]}`}
          >
            {t(c.label)}
          </span>
        ))}
      </div>
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
}: {
  students: OneScreenStudent[];
  selId: string;
  onSelect: (id: string, subjectName?: string) => void;
  selectedSubjectName?: string;
  statusForStudent?: (student: OneScreenStudent) => { reportCell: CellState; sendMark: SendMark };
  reportCellById?: Record<string, CellState>;
  /** 이름 옆 발송 표시 — 학생 id → {나간 행 수, 나갈 수 있는 행 수, 기준 라벨}. */
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
  const groups = new Map<string, OneScreenStudent[]>();
  for (const st of students) {
    const makeup = st.subjects.filter(su => su.makeup && !su.classId);
    const regular = st.subjects.filter(su => !su.makeup || !!su.classId);
    const add = (key: string, row: OneScreenStudent) => groups.set(key, [...(groups.get(key) ?? []), row]);
    if (regular.length || !makeup.length) add(st.className ?? CLASS_GROUP_OTHER, { ...st, subjects: regular });
    // 실제 학생 id는 그대로 유지한다. 보강을 선택하면 같은 카드의 해당 과목 행을 연다.
    for (const su of makeup) add(CLASS_GROUP_MAKEUP, { ...st, subjects: [su], attendance: MARK_PRESENT });
  }
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
       60vh까지만 차지하고 나머지는 페이지가 스크롤한다. */
    <div className="bg-card border-line shadow-card flex flex-col rounded-2xl border lg:h-full lg:min-h-0">
      <header className="border-line flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <p className="micro text-text-faint">{t("os.list.caption")}</p>
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
            {tf("os.list.count", { n: students.length })}
          </p>
        </div>
      </header>
      <div className="scrollbar-thin flex max-h-[60vh] min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 lg:max-h-none [scrollbar-gutter:stable]">
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
                  className="bg-card/95 hover:bg-bg-soft sticky top-0 z-10 flex items-center justify-between gap-1.5 rounded-sm px-1.5 py-0.5 text-left backdrop-blur transition"
                >
                  <span className="flex min-w-0 items-center gap-1">
                    <ChevronDown
                      className={`text-text-faint size-3 shrink-0 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                      strokeWidth={2.5}
                    />
                    <span className="text-text-dim truncate text-xs font-bold">
                      {/* 🔴 반 이름은 한국어 그대로 — 원스크린은 학부모 보고서를 짓는 표면이다. */}
                      {key === CLASS_GROUP_OTHER
                        ? t("os.list.noClass")
                        : key === CLASS_GROUP_MAKEUP
                          ? t("os.list.makeup")
                          : key}
                    </span>
                  </span>
                  <span className="text-text-faint shrink-0 font-mono text-xs">
                    {tf("os.list.count", { n: rows.length })}
                  </span>
                </button>
                {!isCollapsed
                  ? rows.map((st) => {
                      const rowStatus = statusForStudent?.(st);
                      return (
                        <StudentRow
                          key={`${st.id}:${st.subjects[0]?.name ?? ""}`}
                          st={st}
                          active={st.id === selId && (!selectedSubjectName || st.subjects.some(su => su.name === selectedSubjectName))}
                          reportCell={rowStatus?.reportCell ?? reportCellById?.[st.id]}
                          sendMark={rowStatus?.sendMark ?? sendMarkById?.[st.id]}
                          onClick={() => onSelect(st.id, st.subjects[0]?.name)}
                          testConfig={testConfig}
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
