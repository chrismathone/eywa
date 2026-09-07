"use client";

// 선생님 원스크린 "발송 현황" 뷰(5단계-1) — 읽기 중심 상태 보드.
// 오늘 (학생×과목)별 미작성/작성중/발송 + ClassNote 상태 + 학부모 열람을 한눈에. 행 클릭 → 그 학생 카드로.
// 신규 쿼리 없음: 이미 로드된 students(발송·열람) + reports state(초안)만 사용.
import { useState } from "react";
import { SortableTh } from "@/components/table/sortable-th";
import { compareKo, sortRows, type SortState } from "@/lib/table/sort";
import { buildGridRows } from "../grid";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { rowSendStatus, summarizeSend, type SendStatus } from "../status";
import type { OneScreenStudent } from "../types";
import { classnoteBadge, type SubjectReport } from "./report-card";
import { attendanceMarkLabel, MARK_LATE, MARK_PRESENT } from "../attendance-mark";
import { CLASS_GROUP_NONE } from "../class-tags";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import type { SheetDictKey } from "@/features/teacher-view/i18n";

/**
 * 색은 의미색 캐논([`semantic-color.ts`](src/lib/design/semantic-color.ts)) — 발송완료=positive ·
 * 작성중=caution(아직 내 일) · 미작성=critical(마감이 있는 큐라 '아무것도 안 한 상태'가 곧 위험).
 * ⚠️ 발송완료는 v4에서 primary(네이비) → positive(그린): "끝났다"는 앱 전역이 그린이라(완납·승인·출석)
 *    여기만 네이비면 같은 뜻이 화면마다 다른 색이 된다.
 */
// 🔴 라벨은 **사전 키**다(색은 의미색 캐논 그대로) — 화면 파일에 낱말을 다시 박지 않는다.
const STATUS_META: Record<SendStatus, { label: SheetDictKey; cls: string }> = {
  sent: { label: "os.status.sent", cls: TONE_SOFT.positive },
  draft: { label: "os.status.draft", cls: TONE_SOFT.caution },
  todo: { label: "os.status.todo", cls: TONE_SOFT.critical },
  // '수업보고서 미발송' 반(0174a) — 보낼 일이 없는 행이라 **위험(빨강)이 아니라 종료(중립)**다(2026-08-19).
  excluded: { label: "os.status.excluded", cls: TONE_SOFT.inert },
};

// 정렬 우선순위 — '보고서' 열은 가나다가 아니라 **급한 순**(미작성 먼저)이 유용하다.
const STATUS_ORDER: Record<SendStatus, number> = {
  todo: 0,
  draft: 1,
  sent: 2,
  excluded: 3, // 할 일이 아니라 맨 뒤
};

type SortKey = "student" | "progress" | "report" | "classnote" | "views";

/** 반 미배정 행을 담는 그룹 이름 — 항상 맨 끝으로 보낸다. */
const NO_CLASS = CLASS_GROUP_NONE;

function Chip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className={`rounded-full px-3 py-1.5 ${tone}`}>
      <span className="text-lg font-bold tabular">{value}</span>
      <span className="ml-1 text-xs font-bold">{label}</span>
    </div>
  );
}

export function StatusBoard({
  students,
  reports,
  onOpenCard,
  emptyLabel,
}: {
  students: OneScreenStudent[];
  reports: Record<string, Record<string, SubjectReport>>;
  onOpenCard: (studentId: string) => void;
  /** 빈 표 문구 — **작성 필터**로 비었을 때 "담당 학생이 없다"는 거짓말을 하지 않도록 호출부가 덮어쓴다.
   *  안 넘기면 사전 기본값. */
  emptyLabel?: string;
}) {
  const [sort, setSort] = useState<SortState<SortKey>>(null);
  const rows = buildGridRows(students);
  const lang = useSheetLang();
  const t = useSheetT();
  const tf = useSheetTf();
  const sum = summarizeSend(rows, reports);

  if (rows.length === 0) {
    return (
      <div className="bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-2xl border p-10 text-sm">
        {emptyLabel ?? t("os.status.empty")}
      </div>
    );
  }

  // 정렬값 — 열마다 무엇으로 비교할지 한 곳에서 정의(표시 문자열과 정렬 기준이 어긋나지 않게).
  const valueOf = (r: (typeof rows)[number], key: SortKey) => {
    const rep = reports[r.student.id]?.[r.subject.name];
    switch (key) {
      case "student":
        return r.student.name;
      case "progress":
        return r.subject.today?.trim() || null;
      case "report":
        return STATUS_ORDER[rowSendStatus(rep, r.subject)];
      case "classnote":
        return classnoteBadge(rep?.classnoteStatus, lang)?.label ?? null;
      case "views":
        return rep?.viewCount ?? 0;
    }
  };

  // 반별 묶음 — 38명이 평면으로 깔리면 반 경계가 안 보인다(원장 요청 2026-07-21).
  // 반 이름은 그 행의 과목 반(subject.className) 우선, 없으면 학생 대표 반. 둘 다 없으면 '반 미배정'.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const name = r.subject.className || r.student.className || NO_CLASS;
    const list = groups.get(name);
    if (list) list.push(r);
    else groups.set(name, [r]);
  }
  // 그룹 순서는 반 이름 가나다(자연 정렬) 고정 — 열 정렬은 **그룹 안에서만** 돈다.
  // 그래야 "정렬해도 반 묶음은 그대로"라 어느 반을 보고 있는지 놓치지 않는다. '반 미배정'은 항상 끝.
  const orderedGroups = [...groups.entries()].sort((a, b) => {
    if (a[0] === NO_CLASS) return 1;
    if (b[0] === NO_CLASS) return -1;
    return compareKo(a[0], b[0]);
  });

  return (
    <div className="flex flex-col gap-3">
      {/* 요약 — 미작성이 핵심(빨강). 발송·열람은 진척. */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip label={t("os.status.todo")} value={sum.todo} tone="bg-danger/10 text-danger" />
        <Chip label={t("os.status.draft")} value={sum.draft} tone="bg-amber-soft text-amber" />
        <Chip label={t("os.status.sent")} value={sum.sent} tone="bg-primary/10 text-primary" />
        <Chip
          label={t("os.status.parentRead")}
          value={sum.viewed}
          tone="border-line text-text-dim border"
        />
        <span className="text-text-faint ml-auto text-xs">
          {tf("os.status.unsent", { n: sum.unsent, total: sum.total })}
          {/* 분모에서 뺀 행을 밝힌다 — 안 밝히면 "학생은 8명인데 전체가 5?"가 된다. */}
          {sum.excluded > 0 ? tf("os.status.excludedTail", { n: sum.excluded }) : ""}
        </span>
      </div>

      <div className="bg-card border-line shadow-card overflow-x-auto rounded-2xl border">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="border-line text-text-faint group border-b">
              <SortableTh sortKey="student" state={sort} onSort={setSort}>
                {t("os.col.student")}
              </SortableTh>
              <SortableTh sortKey="progress" state={sort} onSort={setSort}>
                {t("os.status.colProgress")}
              </SortableTh>
              <SortableTh sortKey="report" state={sort} onSort={setSort}>
                {t("os.status.colReport")}
              </SortableTh>
              <SortableTh sortKey="classnote" state={sort} onSort={setSort}>
                ClassNote
              </SortableTh>
              <SortableTh
                sortKey="views"
                state={sort}
                onSort={setSort}
                align="right"
              >
                {t("os.status.colViews")}
              </SortableTh>
            </tr>
          </thead>
          {/* ⚠️ 그룹마다 <tbody> — 표 안에 <tr>을 중첩할 수는 없다(잘못된 HTML → 레이아웃 붕괴).
              한 표에 tbody 여러 개는 표준이며, 반 머리행을 그 안에 자연스럽게 넣을 수 있다. */}
          {orderedGroups.map(([className, groupRows]) => {
            const inGroup = sortRows(groupRows, sort, valueOf);
            const statuses = groupRows.map((r) =>
              rowSendStatus(reports[r.student.id]?.[r.subject.name], r.subject),
            );
            const todo = statuses.filter((s) => s === "todo").length;
            const allExcluded = statuses.length > 0 && statuses.every((s) => s === "excluded");
            return (
              <tbody key={className}>
                {/* 반 머리행 — 반 이름 + 인원 + 그 반의 미작성 수(급한 반이 바로 보이게). */}
                <tr className="bg-bg-soft border-line border-b">
                  <th colSpan={5} className="px-3 py-1.5 text-left">
                    <span className="text-foreground text-xs font-bold">
                      {/* 🔴 반 이름은 한국어 그대로(위 top-bar 주석과 같은 이유). */}
                      {className === NO_CLASS ? t("os.status.noClass") : className}
                    </span>
                    <span className="text-text-faint ml-2 text-xs">
                      {/* ⚠️ 행 수가 아니라 **학생 수** — 한 학생이 두 과목이면 2행이라 행 수를 쓰면 인원이 부푼다. */}
                      {tf("os.list.count", {
                        n: new Set(groupRows.map((r) => r.student.id)).size,
                      })}
                    </span>
                    {todo > 0 ? (
                      <span className="text-danger ml-2 text-xs font-bold">
                        {tf("os.status.todoN", { n: todo })}
                      </span>
                    ) : allExcluded ? (
                      // 🔴 "전원 작성"이라고 하면 거짓말이다 — 아무도 안 썼고, 쓸 일도 없는 반이다.
                      <span className="text-text-dim ml-2 text-xs font-bold">
                        {t("os.status.noSendClass")}
                      </span>
                    ) : (
                      <span className="text-primary ml-2 text-xs font-bold">
                        {t("os.status.allWritten")}
                      </span>
                    )}
                  </th>
                </tr>
                {inGroup.map((r) => {
                  const rep = reports[r.student.id]?.[r.subject.name];
                  const status = rowSendStatus(rep, r.subject);
                  const meta = STATUS_META[status];
                  const badge = classnoteBadge(rep?.classnoteStatus, lang);
                  const views = rep?.viewCount ?? 0;
                  return (
                    <tr
                      key={r.key}
                      onClick={() => onOpenCard(r.student.id)}
                      className={`border-line hover:bg-bg-soft cursor-pointer border-b last:border-b-0 ${
                        status === "todo" ? "bg-danger/5" : ""
                      }`}
                    >
                      <td className="px-3 py-2">
                        <span className="text-foreground font-bold">
                          {r.student.name}
                        </span>
                        <span className="text-text-faint ml-1.5">
                          {r.subject.name}
                        </span>
                        {r.student.attendance !== MARK_PRESENT ? (
                          <span
                            className={`ml-1.5 rounded-pill px-1.5 py-px text-xs font-bold ${
                              r.student.attendance === MARK_LATE
                                ? "bg-amber-soft text-amber"
                                : "bg-danger text-white"
                            }`}
                          >
                            {attendanceMarkLabel(r.student.attendance, lang)}
                          </span>
                        ) : null}
                      </td>
                      <td className="text-text-dim px-3 py-2">
                        {r.subject.today?.trim() || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-pill px-2 py-0.5 text-xs font-bold ${meta.cls}`}
                        >
                          {t(meta.label)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {badge ? (
                          <span
                            className={`text-xs font-bold ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                        ) : (
                          <span className="text-text-faint text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {views > 0 ? (
                          <span className="text-text-dim tabular text-xs">
                            {tf("os.status.views", { n: views })}
                          </span>
                        ) : (
                          <span className="text-text-faint text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
