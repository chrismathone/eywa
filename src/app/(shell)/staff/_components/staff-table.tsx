"use client";

import type { ReactNode } from "react";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { Paperclip } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { EditingBadge } from "@/features/presence/editing-badge";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { usePrefs } from "@/components/workspace/use-prefs";
import type { StaffRow } from "@/features/staff/server/queries";
import { StaffRowLink } from "./staff-row-link";
import { normalizeOrder, visibleColumns, type StaffColumnKey } from "./staff-columns";

const ROLE_META: Record<string, { label: string; color: PillColor }> = {
  master: { label: "원장", color: "danger" },
  admin: { label: "관리자", color: "blue" },
  manager: { label: "매니저", color: "blue" },
  teacher: { label: "강사", color: "primary" },
  counselor: { label: "상담", color: "rose" },
  accountant: { label: "회계", color: "purple" },
  viewer: { label: "참관", color: "neutral" },
};
const STATUS_META: Record<string, { label: string; color: PillColor }> = {
  active: { label: "재직", color: "primary" },
  inactive: { label: "퇴사", color: "neutral" },
  pending: { label: "대기", color: "amber" },
};

const CELL = "px-3 py-2.5";

/**
 * 직원 목록 표 — **보이는 열과 순서를 사용자가 고른다**(원장 지시 2026-07-31).
 * 설정이 브라우저 저장(usePrefs)이라 표를 클라이언트에서 그린다. 행 데이터는 서버가 만든 그대로 받는다.
 * 과목 라벨·색은 `useSubjectMaps()`(학원설정 단일 소스) — 코드에 과목을 박지 않는다.
 */
export function StaffTable({ rows }: { rows: StaffRow[] }) {
  const subjects = useSubjectMaps();
  const order = normalizeOrder(usePrefs((s) => s.staffColumnOrder));
  const hidden = usePrefs((s) => s.staffColumnHidden);
  const cols = visibleColumns(order, hidden);

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
    phone: (s) => <span className="num">{s.phone ?? "—"}</span>,
    contract: (s) =>
      s.contractStart && s.contractEnd ? (
        <span className="num">
          {s.contractStart} ~ {s.contractEnd}
          {s.contractSeq ? <span className="text-text-dim ml-1">({s.contractSeq}차)</span> : null}
        </span>
      ) : (
        "—"
      ),
    contractTerms: (s) => (
      <span className="block max-w-[220px] truncate" title={s.contractTerms ?? ""}>
        {s.contractTerms ?? "—"}
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
      <span className="flex flex-wrap gap-1">
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
      const m = ROLE_META[s.systemRole] ?? ROLE_META.viewer!;
      return <Pill color={m.color}>{m.label}</Pill>;
    },
    classes: (s) => <span className="num font-medium">{s.classesCount > 0 ? s.classesCount : "—"}</span>,
    students: (s) => (
      <span className="num font-medium">{s.primaryStudentsCount > 0 ? s.primaryStudentsCount : "—"}</span>
    ),
    status: (s) => {
      const m = STATUS_META[s.status] ?? STATUS_META.active!;
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
    contractTerms: "계약조건",
    contractEnd: "계약갱신일",
    contractFile: "계약서",
    subjects: "과목",
    role: "역할",
    classes: "담당 반",
    students: "담당 학생",
    status: "상태",
    updatedAt: "수정일",
  };
  const rightAligned = new Set<StaffColumnKey>(["classes", "students"]);

  return (
    <table
      className="[&_td]:border-line [&_th]:border-line w-full border-collapse [&_td]:border [&_th]:border"
      style={{ minWidth: Math.max(560, cols.length * 116) }}
    >
      <thead>
        <tr className="bg-bg-soft/70 text-foreground text-left text-[0.9em]">
          {cols.map((k) => (
            <th key={k} className={`${CELL} font-bold ${rightAligned.has(k) ? "text-right" : ""}`}>
              {LABEL[k]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
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
                className={`text-foreground ${CELL} ${rightAligned.has(k) ? "text-right" : ""} ${
                  k === "contractTerms" ? "" : "whitespace-nowrap"
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
