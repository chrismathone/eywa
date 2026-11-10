"use client";

import { useEffect, useState } from "react";
import type { AbsentRow, AdminPeriod, ClassInfo, RollupStudent, StudentInfo } from "../../view-admin";

export type StudentsPayload = { rows: RollupStudent[]; students: StudentInfo; classInfo: ClassInfo; absent?: AbsentRow[] };
export type StudentsFilter = { owner?: string | null; /** 담당자 없는 의무만('담당 미정'). */ ownerNone?: boolean; classId?: string | null; subject?: string | null; studentId?: string | null };

/**
 * 학생 × 반 × 종류 집계 GET(`/api/duties/admin/students`) — 선생님 단계(담당자)·반 단계(반)가 쓴다. 실패는 문구 하나.
 * 조건(기간·담당자·반·과목)이 바뀌면 이전 값을 지우고 새로 받는다 · `refreshKey`(60초 갱신)만 바뀌면 **받는 동안 이전 값을 그대로 보인다**(화면이 비지 않게).
 * `enabled`가 false면 부르지 않는다(담당 미정 줄처럼 좁힐 조건이 없을 때 — 전원을 받아 오지 않는다). subject가 NO_SUBJECT("none")면 과목 없는 의무만.
 */
export function useStudentsPayload(period: AdminPeriod, filter: StudentsFilter, refreshKey = 0, enabled = true): { data: StudentsPayload | null; failed: boolean } {
  const filterKey = enabled ? `${period}|${filter.ownerNone ? "none" : filter.owner ?? ""}|${filter.classId ?? ""}|${filter.subject ?? ""}|${filter.studentId ?? ""}` : "";
  const [state, setState] = useState<{ filterKey: string; data: StudentsPayload | null; failed: boolean }>({ filterKey: "", data: null, failed: false });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const q = new URLSearchParams({ period });
    if (filter.ownerNone) q.set("owner", "none"); else if (filter.owner) q.set("owner", filter.owner);
    if (filter.classId) q.set("class", filter.classId);
    if (filter.subject) q.set("subject", filter.subject);
    if (filter.studentId) q.set("student", filter.studentId);
    fetch(`/api/duties/admin/students?${q.toString()}`, { cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return (await r.json()) as StudentsPayload; })
      .then((data) => { if (alive) setState({ filterKey, data, failed: false }); })
      .catch(() => { if (alive) setState((cur) => (cur.filterKey === filterKey && cur.data ? cur : { filterKey, data: null, failed: true })); });
    return () => { alive = false; };
  }, [enabled, filterKey, period, filter.owner, filter.ownerNone, filter.classId, filter.subject, filter.studentId, refreshKey]);
  if (!enabled) return { data: null, failed: false };
  // 조건이 바뀐 직후(아직 안 받음)엔 이전 값을 보이지 않는다 — 다른 선생님 목록이 잠깐 남는 것을 막는다.
  return state.filterKey === filterKey ? { data: state.data, failed: state.failed } : { data: null, failed: false };
}
