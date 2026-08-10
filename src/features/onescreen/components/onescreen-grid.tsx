"use client";

import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { buildGridRows, buildRowRenderMeta, isRowActionable, rowInClass } from "../grid";
import { planBulkAttendance } from "../bulk-attendance";
import { moveInOrder } from "../student-order";
import { resolveStudyGrade } from "../curriculum";
import type { OneScreenStudent } from "../types";
import type { SubjectReport } from "./report-card";
import { BulkApplyPopover } from "./bulk-apply";
import { ClassNarrativePopover } from "./class-narrative";
import { GridToolbar, type GridBulkActions } from "./grid-toolbar";
import { GridBodyRow, type GridConfig, type GridFieldHandlers, type GridRowActions } from "./grid-row";
import { PrevRow } from "./prev-row";

// 열 제목은 **가운데 정렬**(원장 2026-08-05) — 본문 값은 좌측 정렬 그대로다(읽는 흐름 유지).
const TH = "text-text-faint px-2 py-2 text-center text-[11px] font-bold whitespace-nowrap";
const ORDER_BTN =
  "border-line text-text-dim hover:bg-bg-soft hover:text-foreground flex size-5 items-center justify-center rounded-sm border text-[11px] font-bold disabled:opacity-40";

/**
 * 선생님 원스크린 — 표(스프레드시트) 대량작성 뷰.
 * 카드 뷰와 **같은 state·저장로직**을 공유(핸들러는 studentId 파라미터 버전). 행 = (학생 × 과목).
 * 반 전체 진도·점수·태도·과제·교재명을 한 표에서 입력 → 일괄 저장 / 일괄 ClassNote 발송.
 * 분해(0단계): 일괄 바=grid-toolbar, 본문 행=grid-row, 참고행=prev-row — 이 파일은 조립·선택 상태만.
 */
export function OneScreenGrid({
  students,
  reports,
  config,
  fields,
  rowActions,
  bulkActions,
  order,
  classFilter,
  narrative,
  attPending,
  attReadOnly,
  genKey,
  bulkGen,
  uploadingAttKey,
}: {
  students: OneScreenStudent[]; // 현재 필터(반)로 보이는 학생만
  reports: Record<string, Record<string, SubjectReport>>; // studentId → 과목명 → 발송상태
  config: GridConfig;
  fields: GridFieldHandlers;
  rowActions: GridRowActions;
  bulkActions: GridBulkActions;
  // 학생 순서변경(3-2) — 단일 반 필터일 때만 전달(전체 필터에선 undefined=버튼 숨김). onSave 성공 시 true.
  order?: { classId: string; onSave: (classId: string, studentIds: string[]) => Promise<boolean> };
  classFilter: string | null; // 특정 반이면 그 반 소속 과목 행만 표시(다반 학생 타 반 행 혼입 차단)
  // 반 공통 서술(G6) — activeClass=특정된 단일 반 이름(전체·동명 모호=null → 비활성+안내, 순서 기능과 동일 가드).
  // value=현재 반 서술, onSave=저장(빈값=삭제). 키는 부모(client)가 classId로 관리.
  narrative?: { activeClass: string | null; value: string; onSave: (text: string) => void };
  attPending: ReadonlySet<string>; // 출결 저장 중 (학생::반) — pill 잠금(2-2)
  attReadOnly?: boolean; // 출결 쓰기 권한 없음 — pill을 표시 전용으로
  genKey?: string | null; // 자동작성 중인 행 키(studentId::과목)
  bulkGen?: boolean; // 전체 자동작성 진행중
  uploadingAttKey?: string | null; // 첨부 업로드 중인 행 키(studentId::과목) — 그 행 클립만 로딩 표시
}) {
  const rows = buildGridRows(students).filter((r) => rowInClass(r.subject, classFilter));
  // 작업별 대상(2-3): 발송·자동작성=진도+결석 제외, 저장=진도만(결석 포함 — 기록 보존).
  const sendableRows = rows.filter((r) => isRowActionable(r.subject, "send"));
  // 🔴 실제로 **발송되는** 행 = 위 조건 + **멘트 있음**. 빈 멘트는 절대 가드가 거절하므로(2026-07-28 사고)
  //    `sendableRows`를 그대로 "발송가능"이라 쓰면 상단 숫자와 행 라벨("멘트 입력 필요")이 서로 다른 말을 한다.
  //    ⚠️ `sendableRows`는 자동작성 대상 계산(멘트 없는 행 = autoWritable)에 그대로 필요하니 갈라 둔다.
  const hasDraft = (r: (typeof rows)[number]) => !!reports[r.student.id]?.[r.subject.name]?.draft?.trim();
  const sendReadyRows = sendableRows.filter(hasDraft);
  const saveableRows = rows.filter((r) => isRowActionable(r.subject, "save"));
  // 행 선택(체크) — 일괄 작업 대상. **표시된 모든 행**을 선택 가능(진도 유무 무관).
  // 실제 처리는 client의 selectRows가 발송가능(진도 입력) 행만 걸러내므로, 진도 없는 행은 안전히 건너뜀.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showPrev, setShowPrev] = useState(true); // 이전 회차 참고행 토글(기본 켜짐)
  // 순서 모드(3-2) — 학생 묶음(과목 행 아님)을 ↑↓로 재배열해 (강사×반)에 영구 저장.
  const [orderMode, setOrderMode] = useState(false);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);
  // ⚠️ 반 필터 전환 방어(리뷰 확정 결함): 반 칩은 상단 바(그리드 밖)라 순서 모드 중에도 눌리는데, 그대로 두면
  // stale draftOrder(이전 반 학생)가 새 반 키로 저장돼 그 반의 저장 순서를 조용히 파괴한다 → 대상 반이 바뀌면
  // 순서 모드 강제 종료. 렌더 중 이전 값 비교 리셋(React 공식 패턴, #25 set-state-in-effect 회피).
  const orderClassId = order?.classId ?? null;
  const [prevOrderClassId, setPrevOrderClassId] = useState<string | null>(orderClassId);
  if (prevOrderClassId !== orderClassId) {
    setPrevOrderClassId(orderClassId);
    if (orderMode) {
      setOrderMode(false);
      setDraftOrder([]);
    }
  }
  const selectedKeys = rows.filter((r) => checked.has(r.key)).map((r) => r.key);
  const selectedSendReady = sendReadyRows.filter((r) => checked.has(r.key)).length; // 선택 중 실제 발송될 수
  const selectedSaveable = saveableRows.filter((r) => checked.has(r.key)).length; // 선택 중 실제 저장될 수
  // 자동작성 실대상 = 발송가능 − **이미 멘트가 있는 행**(client autoWriteAllVisible이 손댄 문구를 보존하려 건너뜀).
  // 이 수를 버튼에 그대로 노출한다 — 이전값 가져오기로 멘트를 깔면 대상이 즉시 줄어드는 게 눈에 보여야
  // "채웠는데 자동작성이 덮어쓰나?" 하는 불안이 없다(원장 지시 07-21).
  const noDraft = (r: (typeof rows)[number]) => !hasDraft(r);
  const autoWritable = sendableRows.filter(noDraft).length;
  const selectedAutoWritable = sendableRows.filter((r) => checked.has(r.key) && noDraft(r)).length;
  const hasPrev = rows.some((r) => r.subject.prevReport); // 참고행 데이터가 있을 때만 토글 노출
  // '맨 위 행 복사' 표시용 — 선택이 있으면 선택 행, 없으면 표시 전체(핸들러와 같은 규약).
  const copyRows = selectedKeys.length ? rows.filter((r) => selectedKeys.includes(r.key)) : rows;
  const copySource = copyRows[0];
  // 값 일괄 입력의 **진도 대상 과목** 후보 — 대상 행에 실제로 있는 과목만, 행이 많은 순(첫 항목이 기본값).
  // 진도는 과목 한정이라(수학 진도가 영어 행에 들어가면 그대로 학부모에게 나간다) 선택지를 화면에서 준다.
  const bulkSubjects = (() => {
    const by = new Map<string, { key: string; name: string; count: number }>();
    for (const r of copyRows) {
      const key = r.subject.subjectKey ?? "math";
      const cur = by.get(key);
      if (cur) cur.count += 1;
      else by.set(key, { key, name: r.subject.subjectLabel || r.subject.name, count: 1 });
    }
    return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
  })();
  // 진도 차시 선택기의 기본 학년 — 대상 행에서 가장 흔한 진도 학년(반은 대개 같은 학년이라 한 번에 맞는다).
  const bulkStudyGrade = (() => {
    const tally = new Map<string, number>();
    for (const r of copyRows) {
      const g = resolveStudyGrade(r.student.studyGrade ?? r.student.grade);
      if (g) tally.set(g, (tally.get(g) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  })();
  const allChecked = rows.length > 0 && selectedKeys.length === rows.length;
  const toggleRow = (k: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const toggleAll = () =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (allChecked) rows.forEach((r) => n.delete(r.key));
      else rows.forEach((r) => n.add(r.key));
      return n;
    });

  // 순서 모드 표시 순서 — 초안 순서(학생 묶음)대로 행 정렬(같은 학생 안 과목 순서는 보존).
  const displayRows = orderMode
    ? (() => {
        const pos = new Map(draftOrder.map((id, i) => [id, i]));
        return rows
          .map((r, i) => ({ r, i, p: pos.get(r.student.id) ?? Number.MAX_SAFE_INTEGER }))
          .sort((a, b) => a.p - b.p || a.i - b.i)
          .map((x) => x.r);
      })()
    : rows;
  // 렌더 메타(표시 순서 기준) — nav 인덱스·순서 모드 ↑↓ 배치 공유. 재배열(orderMode)에도 시각 순서와 정합.
  const rowMeta = buildRowRenderMeta(displayRows);
  const startOrder = () => {
    setDraftOrder([...new Set(rows.map((r) => r.student.id))]);
    setOrderMode(true);
  };
  const saveOrder = async () => {
    if (!order) return;
    setSavingOrder(true);
    try {
      const ok = await order.onSave(order.classId, draftOrder);
      if (ok) setOrderMode(false);
    } finally {
      setSavingOrder(false);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-2xl border p-10 text-sm">
        표시할 학생이 없습니다
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 일괄 바 — 선택은 표시 전체, 처리는 발송가능 행만(client selectRows). 값 일괄 입력은 진도 무관(raw 행). */}
      <GridToolbar
        counts={{
          total: rows.length,
          sendable: sendableRows.length,
          sendReady: sendReadyRows.length,
          saveable: saveableRows.length,
          selectedSendReady,
          selectedSaveable,
          autoWritable,
          selectedAutoWritable,
        }}
        selectedKeys={selectedKeys}
        prev={{ has: hasPrev, show: showPrev, onToggle: () => setShowPrev((v) => !v) }}
        // '이전값 일괄 가져오기'도 참고행 토글과 **같은 게이트**(hasPrev) — planPrevFill은 prev가 없으면
        // 그대로 `{}`를 돌려주므로, 참고행이 0건인 화면에서 이 버튼은 눌러도 아무 일이 없는 죽은 컨트롤이다.
        // (과목 분리 2026-07-29 이후 영어 강사 화면이 정상적으로 이전 회차 0건 = 이 상태에 항상 해당.)
        actions={hasPrev ? bulkActions : { ...bulkActions, onBulkImportPrev: undefined }}
        bulkGen={bulkGen}
        locked={orderMode}
        navHint={config.dailyEnabled || config.checkEnabled}
      >
        {orderMode ? (
          <>
            <span className="text-text-dim text-[11px]">↑↓로 학생 순서를 바꾼 뒤 저장하세요</span>
            <Button variant="outline" size="sm" onClick={() => setOrderMode(false)} disabled={savingOrder}>
              취소
            </Button>
            <Button size="sm" onClick={saveOrder} disabled={savingOrder}>
              {savingOrder ? "저장 중…" : "순서 저장"}
            </Button>
          </>
        ) : (
          <>
            <BulkApplyPopover
              targetCount={selectedKeys.length || rows.length}
              selectedCount={selectedKeys.length}
              attitudes={config.attitudes}
              subjects={bulkSubjects}
              studyGrade={bulkStudyGrade}
              copySource={
                copySource && bulkActions.onCopyFirstRow
                  ? { label: copySource.student.name, belowCount: Math.max(0, copyRows.length - 1) }
                  : null
              }
              // 출결 일괄 — 쓰기 권한이 없으면 아예 안 넘긴다(못 하는 일을 보여주지 않는다).
              // 대상 집합은 다른 일괄 필드와 **같은 행**(copyRows = 선택 행, 없으면 표시 전체).
              attendance={
                attReadOnly
                  ? null
                  : {
                      plan: (status, onlyEmpty) =>
                        planBulkAttendance(
                          copyRows.map((r) => ({
                            studentId: r.student.id,
                            classId: r.subject.classId,
                            isMakeup: r.student.isMakeup,
                            raw: r.subject.attendanceRaw,
                          })),
                          status,
                          { onlyEmpty },
                        ),
                    }
              }
              onApply={(patch, onlyEmpty, progressSubjectKey, attendance) =>
                bulkActions.onBulkApply(selectedKeys, patch, onlyEmpty, progressSubjectKey, attendance)
              }
              onCopyFirstRow={(overwrite) => bulkActions.onCopyFirstRow?.(selectedKeys, overwrite)}
              disabled={bulkGen}
            />
            {/* 반 공통 서술(G6) — 항상 노출·반 미특정(전체/동명 모호)이면 비활성+안내(순서 버튼 #22 발견성 패턴). */}
            {narrative ? (
              <ClassNarrativePopover
                activeClass={narrative.activeClass}
                value={narrative.value}
                onSave={narrative.onSave}
                disabled={bulkGen}
              />
            ) : null}
            {/* 순서 버튼은 항상 노출 — '전체' 필터에선 비활성+안내로 기능 발견성 확보(#22). 단일 반 선택 시만 동작. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => order && startOrder()}
              disabled={!order || bulkGen}
              title={
                order
                  ? "학생 표시 순서 변경 — 이 반에 저장(좌석·채점지 순서). 다음 작성에도 유지"
                  : "반을 하나 선택하면 학생 순서를 바꿀 수 있습니다"
              }
            >
              순서
            </Button>
          </>
        )}
      </GridToolbar>

      <div className="bg-card border-line shadow-card overflow-x-auto rounded-2xl border">
        {/* table-fixed + colgroup 고정 폭 — 헤더/본문 열 정렬 결정적, 표는 내용 폭(좌측 정렬)이라 진도가 남는 폭을 독식하지 않음. */}
        {/* 열 구분선 — 첫 칸(선택 체크박스)을 뺀 모든 셀의 **왼쪽**에 아주 옅은 세로선(원장 2026-08-05
            "열 구분할 수 있게 아주 미세한 세로선, 거의 보일랑말랑"). 셀 상수(TD·TH·참고행)를 각각 고치지 않고
            표 한 곳에서 거는 이유: 행 종류가 여럿이고(본문·참고행·묶음 첫 행) 앞으로 늘 수 있어, 한 군데를
            빠뜨리면 그 행만 세로선이 끊긴다. 너비와 **색을 같이** 지정한다 — 색을 빼면 Tailwind v4 기본
            border-color(currentColor)가 먹어 진한 선이 된다. */}
        <table className="w-full min-w-[1304px] table-fixed border-collapse text-[12px] [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
          {/* ⚠️ 주석을 `<col />`과 **같은 줄**에 두지 말 것 — 사이의 공백이 JSX 텍스트 노드로 남아
              "whitespace text nodes cannot be a child of <colgroup>" 하이드레이션 에러가 난다(표뷰 전체가
              클라 재렌더로 떨어져 클릭이 먹통처럼 보임, #75류). 줄바꿈이 낀 공백만 컴파일러가 제거한다. */}
          <colgroup>
            {/* 선택 */}
            <col className="w-[34px]" />
            {/* 학생·반 */}
            <col className="w-[128px]" />
            {/* 수업타임(시수) — 전용 열(원장 2026-08-05 "타임이 너무 작다 … 열을 하나 더 추가해서라도").
                이름칸 안에 끼워 넣으면 pill과 자리를 다퉈 계속 작아진다. 늘어난 폭은 아래 '학부모 문구'
                (유일한 가변 열)가 내준다 — 원장: "우측 입력창의 열너비를 줄이면 될". */}
            <col className="w-[64px]" />
            {/* 진도 */}
            <col className="w-[200px]" />
            {/* 일일 */}
            {config.dailyEnabled ? <col className="w-[88px]" /> : null}
            {/* 확인 */}
            {config.checkEnabled ? <col className="w-[88px]" /> : null}
            {/* 태도 — 1클릭 pill(1-1) */}
            <col className="w-[130px]" />
            {/* 과제 */}
            <col className="w-[130px]" />
            {/* 교재명 · 보강 */}
            <col className="w-[140px]" />
            {/* 학부모 문구(멘트) — 남는 폭 흡수(우측 공간 활용) */}
            <col />
            {/* 자동작성 · 카드 · 발송 */}
            <col className="w-[132px]" />
          </colgroup>
          <thead>
            <tr className="bg-bg-soft">
              <th className={TH}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  aria-label="표시 행 전체 선택"
                  className="accent-primary size-3.5 align-middle"
                />
              </th>
              <th className={TH}>학생 · 반</th>
              <th className={TH} title="수업타임(시수) — 기본 1. 출석부에 그대로 들어갑니다(학부모 보고서엔 미표시)">
                타임
              </th>
              <th className={TH}>진도(오늘)</th>
              {config.dailyEnabled ? <th className={TH}>일일</th> : null}
              {config.checkEnabled ? <th className={TH}>확인</th> : null}
              <th className={TH}>태도</th>
              <th className={TH}>과제 수행률</th>
              <th className={TH}>교재명 · 보강</th>
              <th className={TH}>학부모 문구</th>
              <th className={TH}>발송 · 편집</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => {
              // 순서 모드: 학생 묶음 첫 행에만 ↑↓ 노출(과목 행 단위 이동 아님). 참고행은 숨김(시각 단순화).
              const meta = rowMeta[i]!;
              const firstOfStudent = meta.firstOfStudent;
              const orderControls = orderMode ? (
                firstOfStudent ? (
                  <div className="flex flex-col items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setDraftOrder((p) => moveInOrder(p, row.student.id, -1))}
                      aria-label={`${row.student.name} 위로`}
                      className={ORDER_BTN}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftOrder((p) => moveInOrder(p, row.student.id, 1))}
                      aria-label={`${row.student.name} 아래로`}
                      className={ORDER_BTN}
                    >
                      ↓
                    </button>
                  </div>
                ) : (
                  <span aria-hidden />
                )
              ) : undefined;
              return (
                <Fragment key={row.key}>
                  {/* 학생 구분선 — 묶음의 **첫 렌더 행**만 굵은 회색 상단선. 참고행이 켜져 있고 그 학생에
                      참고 데이터가 있으면 참고행이 첫 행이므로 그쪽이 받는다(선이 두 번 그어지지 않게 배타). */}
                  {showPrev && !orderMode ? (
                    <PrevRow
                      subject={row.subject}
                      dailyEnabled={config.dailyEnabled}
                      checkEnabled={config.checkEnabled}
                      onImport={() => rowActions.onImportPrev(row.student, row.subject.name)}
                      groupStart={firstOfStudent}
                    />
                  ) : null}
                  <GridBodyRow
                    groupStart={firstOfStudent && !(showPrev && !orderMode && !!row.subject.prevReport)}
                    row={row}
                    checked={checked.has(row.key)}
                    onToggle={toggleRow}
                    rep={reports[row.student.id]?.[row.subject.name]}
                    fields={fields}
                    actions={rowActions}
                    config={config}
                    gen={{
                      rowBusy: genKey === row.key,
                      bulk: bulkGen,
                      attPending,
                      attReadOnly,
                      uploadingKey: uploadingAttKey,
                    }}
                    nav={{ row: i, studentRow: firstOfStudent ? meta.studentRow : undefined }}
                    orderControls={orderControls}
                  />
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
