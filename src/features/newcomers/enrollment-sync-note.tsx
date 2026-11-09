"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { MakeeduSyncState } from "@/features/integrations/server/makeedu-sync";
import css from "./followup-workspace.module.css";

export type EnrollmentSyncInfo = { students: MakeeduSyncState | null; enrollments: MakeeduSyncState | null };
const stamp = (s: MakeeduSyncState | null) => s ? new Date(s.syncedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "수집 기록 없음";

/** 화면은 ID로 연결된 최신 저장 자료를 다시 읽는다. MakeEdu 실시간 수집과 혼동하지 않는다. */
export function EnrollmentSyncNote({ info, editing }: { info?: EnrollmentSyncInfo; editing: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (editing) return;
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 15000) return;
      last = Date.now(); router.refresh();
    };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [editing, router]);
  if (!info || (!info.students && !info.enrollments)) return null;
  return <aside className={css.syncNote} aria-label="학생·수강 자료 연결 상태">
    <div><b>학생ID로 수강·담임·과목 기본 관리자를 자동 연결</b><p>학생 수집 {stamp(info.students)} · 수강 연결 {stamp(info.enrollments)}</p>
      {!info.enrollments ? <p>수강 자동 수집 기록이 없습니다. 연동 PC의 수강 연결 수집 설정을 확인해 주세요.</p>
        : info.enrollments.status !== "ok" || info.enrollments.issue ? <p>수강 수집·연결에 확인할 항목이 있습니다. 확인되지 않은 과목·시작일은 추정하지 않습니다.</p> : null}
      <small>에이와에 저장된 최신 정보를 1분마다 반영합니다. 기록 입력 중에는 갱신을 잠시 멈춥니다.</small></div>
    <button type="button" disabled={editing} onClick={() => router.refresh()}>최신 저장정보 반영</button>
  </aside>;
}
