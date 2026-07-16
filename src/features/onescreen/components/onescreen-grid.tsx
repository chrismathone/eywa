"use client";

import { Fragment, useState } from "react";
import { buildGridRows, isReportEligible } from "../grid";
import type { OneScreenStudent } from "../types";
import type { SubjectReport } from "./report-card";
import { GridToolbar, type GridBulkActions } from "./grid-toolbar";
import { GridBodyRow, type GridConfig, type GridFieldHandlers, type GridRowActions } from "./grid-row";
import { PrevRow } from "./prev-row";

const TH = "text-text-faint px-2 py-2 text-left text-[11px] font-semibold whitespace-nowrap";

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
  genKey,
  bulkGen,
}: {
  students: OneScreenStudent[]; // 현재 필터(반)로 보이는 학생만
  reports: Record<string, Record<string, SubjectReport>>; // studentId → 과목명 → 발송상태
  config: GridConfig;
  fields: GridFieldHandlers;
  rowActions: GridRowActions;
  bulkActions: GridBulkActions;
  genKey?: string | null; // 자동작성 중인 행 키(studentId::과목)
  bulkGen?: boolean; // 전체 자동작성 진행중
}) {
  const rows = buildGridRows(students);
  const eligibleRows = rows.filter((r) => isReportEligible(r.subject));
  const eligible = eligibleRows.length;
  // 행 선택(체크) — 일괄 작업 대상. **표시된 모든 행**을 선택 가능(진도 유무 무관).
  // 실제 처리는 client의 selectRows가 발송가능(진도 입력) 행만 걸러내므로, 진도 없는 행은 안전히 건너뜀.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showPrev, setShowPrev] = useState(true); // 이전 회차 참고행 토글(기본 켜짐)
  const selectedKeys = rows.filter((r) => checked.has(r.key)).map((r) => r.key);
  const selectedEligible = eligibleRows.filter((r) => checked.has(r.key)).length; // 실제 처리될 수(발송가능)
  const hasPrev = rows.some((r) => r.subject.prevReport); // 참고행 데이터가 있을 때만 토글 노출
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

  if (rows.length === 0) {
    return (
      <div className="bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-md border p-10 text-sm">
        표시할 학생이 없습니다
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 일괄 바 — 선택은 표시 전체, 처리는 발송가능 행만(client selectRows). */}
      <GridToolbar
        counts={{ total: rows.length, eligible, selectedEligible }}
        selectedKeys={selectedKeys}
        prev={{ has: hasPrev, show: showPrev, onToggle: () => setShowPrev((v) => !v) }}
        actions={bulkActions}
        bulkGen={bulkGen}
      />

      <div className="bg-card border-line shadow-card overflow-x-auto rounded-md border">
        {/* table-fixed + colgroup 고정 폭 — 헤더/본문 열 정렬 결정적, 표는 내용 폭(좌측 정렬)이라 진도가 남는 폭을 독식하지 않음. */}
        <table className="w-full min-w-[1240px] table-fixed border-collapse text-[12px]">
          <colgroup>
            <col className="w-[34px]" /> {/* 선택 */}
            <col className="w-[128px]" /> {/* 학생·반 */}
            <col className="w-[200px]" /> {/* 진도 */}
            {config.dailyEnabled ? <col className="w-[88px]" /> : null} {/* 일일 */}
            {config.checkEnabled ? <col className="w-[88px]" /> : null} {/* 확인 */}
            <col className="w-[96px]" /> {/* 태도 */}
            <col className="w-[96px]" /> {/* 과제 */}
            <col className="w-[140px]" /> {/* 교재명 · 보강 */}
            <col /> {/* 학부모 문구(멘트) — 남는 폭 흡수(우측 공간 활용) */}
            <col className="w-[132px]" /> {/* 자동작성 · 카드 · 발송 */}
          </colgroup>
          <thead>
            <tr className="bg-bg-soft">
              <th className={`${TH} text-center`}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  aria-label="표시 행 전체 선택"
                  className="accent-primary size-3.5 align-middle"
                />
              </th>
              <th className={TH}>학생 · 반</th>
              <th className={TH}>진도(오늘)</th>
              {config.dailyEnabled ? <th className={`${TH} text-center`}>일일</th> : null}
              {config.checkEnabled ? <th className={`${TH} text-center`}>확인</th> : null}
              <th className={TH}>태도</th>
              <th className={TH}>과제</th>
              <th className={TH}>교재명 · 보강</th>
              <th className={TH}>학부모 문구</th>
              <th className={TH}>발송 · 편집</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.key}>
                {showPrev ? (
                  <PrevRow
                    subject={row.subject}
                    dailyEnabled={config.dailyEnabled}
                    checkEnabled={config.checkEnabled}
                  />
                ) : null}
                <GridBodyRow
                  row={row}
                  checked={checked.has(row.key)}
                  onToggle={toggleRow}
                  rep={reports[row.student.id]?.[row.subject.name]}
                  fields={fields}
                  actions={rowActions}
                  config={config}
                  genRowBusy={genKey === row.key}
                  bulkGen={bulkGen}
                />
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
