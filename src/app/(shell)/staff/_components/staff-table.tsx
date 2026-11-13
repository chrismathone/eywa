"use client";

import type { ReactNode } from "react";
import { Pill } from "@/components/atoms/pill";
import { roleMeta, staffStatusMeta } from "@/features/staff/status-labels";
import { Paperclip } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { EditingBadge } from "@/features/presence/editing-badge";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { StaffRow } from "@/features/staff/server/queries";
import { StaffRowLink } from "./staff-row-link";
import { useStaffViewPrefs } from "./staff-view-prefs";
import { normalizeOrder, visibleColumns, type StaffColumnKey } from "@/features/staff/list/columns";
import { phoneLabel } from "@/lib/format/phone";

const CELL = "px-3 py-2.5";

/**
 * 직원 목록 표 — **보이는 열과 순서를 사용자가 고른다**(원장 지시 2026-07-31).
 * 열 설정은 계정(`ui_prefs.staff`)이 진실이고 `StaffViewPrefsProvider`가 서버 시드로 첫 렌더부터 그 값으로 그린다(클릭은 즉시).
 * 행 데이터는 서버가 만든 그대로 받는다. 과목 라벨·색은 `useSubjectMaps()`(학원설정 단일 소스) — 코드에 과목을 박지 않는다.
 */
export function StaffTable({ rows }: { rows: StaffRow[] }) {
  const subjects = useSubjectMaps();
  const { view } = useStaffViewPrefs();
  const order = normalizeOrder(view.columnOrder);
  const cols = visibleColumns(order, view.columnHidden);

  const render: Record<StaffColumnKey, (s: StaffRow) => ReactNode> = {
    department: (s) => <span className="font-medium">{s.department ?? "—"}</span>,
    name: (s) => (
      <>
        {/* 이름 링크 = 키보드 접근 경로(행 클릭과 같은 상세). 아바타 금지 — 이름 텍스트만. */}
        <WindowLink
          href={`/staff/${s.id}`}
          title={s.displayName}
          ariaLabel={`${s.displayName} 상세`}
          className="group inline-flex items-center gap-1.5"
        >
          {/* 시간표 강사 색(근무 설정) — **정해 둔 사람만** 사각형이 선다(원장 2026-09-07).
              색이 곧 시간표에서 그 사람을 찾는 단서라, 명부에서 누가 무슨 색인지 바로 보이게 한다.
              ⚠️ 색은 사람이 고른 자유 hex라 토큰이 아니다 → 인라인 style(문자열 그대로 저장된 값). */}
          {s.bgColor ? (
            <span
              aria-hidden
              title={`시간표 색 ${s.bgColor}`}
              className="border-line inline-block size-3.5 shrink-0 rounded-xs border"
              style={{ background: s.bgColor }}
            />
          ) : null}
          <span className="text-foreground font-bold group-hover:underline">{s.displayName}</span>
          <EditingBadge scope={`staff:${s.id}`} />
        </WindowLink>
      </>
    ),
    jobTitle: (s) => <span className="font-medium">{s.jobTitle ?? "—"}</span>,
    employmentType: (s) => <span className="font-medium">{s.employmentType ?? "—"}</span>,
    // 플레이스홀더(@imported.local)는 미설정으로 표시 — raw 노출 금지.
    email: (s) => (
      <span className="num">{s.email.toLowerCase().endsWith("@imported.local") ? "미설정" : s.email}</span>
    ),
    hireDate: (s) => <span className="num">{s.hireDate ?? "—"}</span>,
    phone: (s) => <span className="num">{phoneLabel(s.phone) ?? "—"}</span>,
    contract: (s) =>
      s.contractStart && s.contractEnd ? (
        <span className="num">
          {s.contractStart} ~ {s.contractEnd}
          {s.contractSeq ? <span className="text-text-dim ml-1">({s.contractSeq}차)</span> : null}
        </span>
      ) : (
        "—"
      ),
    workHours: (s) => (
      // 이력서 '근무시간' 한 줄(원장 2026-10-06). 상한은 em — 표 글자 −/+ 배수를 그대로 따른다(옛 계약조건 열과 같은 폭).
      <span className="mx-auto block max-w-[14em] truncate" title={s.workHours ?? ""}>
        {s.workHours ?? "—"}
      </span>
    ),
    contractEnd: (s) => <span className="num">{s.contractEnd ?? "—"}</span>,
    contractFile: (s) =>
      s.contractFile ? (
        <span className="text-primary inline-flex items-center gap-1 text-xs font-medium">
          <Paperclip className="size-3.5" /> 있음
        </span>
      ) : (
        "—"
      ),
    subjects: (s) => (
      <span className="flex flex-wrap justify-center gap-1">
        {s.subjects.length > 0
          ? s.subjects.map((k) => (
              <Pill key={k} color={subjects.colorOf(k)}>
                {subjects.labelOf(k)}
              </Pill>
            ))
          : "—"}
      </span>
    ),
    role: (s) => {
      const m = roleMeta(s.systemRole);
      return <Pill color={m.color}>{m.label}</Pill>;
    },
    classes: (s) => <span className="num font-medium">{s.classesCount > 0 ? s.classesCount : "—"}</span>,
    students: (s) => (
      <span className="num font-medium">{s.primaryStudentsCount > 0 ? s.primaryStudentsCount : "—"}</span>
    ),
    status: (s) => {
      const m = staffStatusMeta(s.status) ?? staffStatusMeta("active")!;
      return <Pill color={m.color}>{m.label}</Pill>;
    },
    updatedAt: (s) => <span className="num">{s.updatedAt ? s.updatedAt.slice(0, 10) : "—"}</span>,
  };

  const LABEL: Record<StaffColumnKey, string> = {
    department: "소속부서",
    name: "이름",
    jobTitle: "직급",
    employmentType: "계약구분",
    email: "메일",
    hireDate: "입사일",
    phone: "전화번호",
    contract: "현재 계약",
    workHours: "근무시간",
    contractEnd: "계약갱신일",
    contractFile: "계약서",
    subjects: "과목",
    role: "역할",
    classes: "담당 반",
    students: "담당 학생",
    status: "상태",
    updatedAt: "수정일",
  };

  return (
    <table
      // 열 제목은 한 줄(nowrap) — 16px에선 17열의 max-content 합이 표 폭을 넘겨 auto 레이아웃이 열을 좁히고 제목이 글자 단위로 꺾여 머리 행이 100px 넘게 자랐다(실측 2026-09-04).
      className="[&_td]:border-line [&_th]:border-line w-full border-collapse [&_td]:border [&_th]:border [&_th]:whitespace-nowrap"
      style={{ minWidth: Math.max(560, cols.length * 116) }}
    >
      <thead>
        {/* 열 제목과 값은 같은 축(원장 2026-09-18) — 제목도 값도 전부 가운데(숫자 열 포함).
            크기는 본문과 같다(옛 0.9em은 v5에서 14.4px). */}
        <tr className="bg-bg-soft/70 text-foreground text-center">
          {cols.map((k) => (
            <th key={k} className={`${CELL} font-bold`}>
              {LABEL[k]}
            </th>
          ))}
        </tr>
      </thead>
      {/* AutoPageSize가 이 몸통의 위치·첫 행 높이로 한 쪽 행 수를 잰다. */}
      <tbody data-autopage-list>
        {rows.map((s) => (
          // 행 전체 클릭 → 직원 상세(기본정보에 이력서 내용 포함) — 원장 지시 2026-07-28.
          <StaffRowLink
            key={s.id}
            href={`/staff/${s.id}`}
            title={s.displayName}
            className="hover:bg-bg-soft/50 cursor-pointer transition"
          >
            {cols.map((k) => (
              <td
                key={k}
                className={`text-foreground ${CELL} text-center ${
                  k === "workHours" ? "" : "whitespace-nowrap"
                }`}
              >
                {render[k](s)}
              </td>
            ))}
          </StaffRowLink>
        ))}
      </tbody>
    </table>
  );
}
