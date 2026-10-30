"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmbedLink } from "@/components/embed-link";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { WindowLink } from "@/components/workspace/window-link";
import { mapArchive } from "@/features/withdrawal-reports/server/archive-actions";
import type { ArchiveDetail, ArchiveStudent } from "@/features/withdrawal-reports/archive-model";
import { ArchiveReportForm } from "./archive-report-form";

/** `withdrawalHref` = 연결된 학생이 지금 퇴원 상태이고 퇴원관리를 열 수 있을 때만 서버가 넣는 '퇴원 상세' 주소. */
export function ArchiveDetailView({ archive: a, students, canManage = false, withdrawalHref }: { archive: ArchiveDetail; students: ArchiveStudent[]; canManage?: boolean; withdrawalHref?: string | null }) {
  const router = useRouter();
  const [studentId, setStudentId] = useState(a.mapped_student_id ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function save() {
    startTransition(async () => {
      try {
        const res = await mapArchive({ id: a.id, studentId: studentId || null, revision: a.revision });
        if ("error" in res) setError(res.error ?? "연결을 저장하지 못했습니다.");
        else { setError(""); router.refresh(); }
      } catch { setError("연결을 저장하지 못했습니다. 다시 시도해 주세요."); }
    });
  }
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="flex flex-wrap items-center gap-3 text-sm">
        <EmbedLink className="text-primary hover:underline" href="/withdrawal-reports">← 퇴원보고서 목록</EmbedLink>
        {withdrawalHref && <WindowLink className="text-primary hover:underline" href={withdrawalHref}>퇴원 상세</WindowLink>}
      </span>
    </div>
    <h1 className="text-xl font-semibold">{a.student_name || "이름 미기재"} · 기존 퇴원보고서</h1>
    <ArchiveReportForm archive={a} />
    {canManage && <details className="rounded-xl border bg-muted/20 p-4">
      <summary className="cursor-pointer text-sm font-medium">학생 연결 관리 · {a.mapped_student_id ? "연결됨" : "학생 연결 필요"}</summary>
      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-md space-y-1">
            <p className="text-sm font-medium">기록을 연결할 학생</p>
            <SearchableSelect portal ariaLabel="기록 연결 학생" options={[{ value: "", label: "연결하지 않음" }, ...students.map(s => ({ value: s.id, label: s.name, hint: `${s.school ?? ""} ${s.grade ?? ""} · ${s.status === "withdrawn" ? "퇴원" : s.status === "on_hold" ? "휴원" : "재원"}` }))]} value={studentId} onValueChange={id => { if (!pending) setStudentId(id); }} searchPlaceholder="이름·학교로 검색" />
          </div>
          <Button disabled={pending || studentId === (a.mapped_student_id ?? "")} onClick={save}>{pending ? "저장 중…" : "학생 연결 저장"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">학생 연결은 기록의 귀속만 정합니다. 현재 재원·수강 상태와 승인 절차는 바뀌지 않습니다.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </details>}
  </>;
}
