"use client";

// 수업보고서 — Edutrix UUID 미매핑 목록 + 수동 연결(오배정 방지 오버사이트).
// 테스트 프로필(학원N·테스트 이름)은 기본 숨김 — 실매핑 대상만 먼저 본다.
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { linkEdutrixStudent } from "@/features/report-admin/server/edutrix-map-actions";
import type { EdutrixMapView, UnmappedEdutrixRow } from "@/features/report-admin/server/edutrix-map-queries";

function RowLink({ row }: { row: UnmappedEdutrixRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const freeCandidates = useMemo(
    () => row.candidates.filter((c) => !c.alreadyMapped),
    [row.candidates],
  );
  const [eywaId, setEywaId] = useState(freeCandidates[0]?.id ?? "");

  const options = freeCandidates.map((c) => ({ value: c.id, label: c.label }));
  const eduLabel = [row.name, schoolGradeLabel(row.school, row.grade) || null].filter(Boolean).join(" · ");

  function link() {
    if (!eywaId) {
      toast.error("연결할 eywa 학생을 선택하세요");
      return;
    }
    start(async () => {
      const res = await linkEdutrixStudent(eywaId, row.edutrixId);
      if (res.ok) {
        toast.success(`연결 완료 · 보고서 ${res.pulled ?? 0}건 이관`);
        router.refresh();
      } else toast.error(res.error ?? "연결 실패");
    });
  }

  return (
    <tr className="border-line border-b last:border-0">
      <td className="px-3 py-2 align-top">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-foreground text-[13px] font-medium">{eduLabel}</span>
          {row.likelyDummy ? (
            <span className="bg-bg-soft text-text-faint rounded px-1.5 py-0.5 text-[10px] font-bold">
              테스트
            </span>
          ) : null}
        </div>
        <div className="text-text-faint font-mono text-[10px]">{row.edutrixId.slice(0, 8)}…</div>
      </td>
      <td className="text-foreground tabular px-3 py-2 align-top text-[13px] font-bold">
        {row.reportCount}
      </td>
      <td className="px-3 py-2 align-top">
        {options.length === 0 ? (
          <p className="text-amber text-[12px]">
            같은 이름 eywa 후보 없음
            {row.candidates.some((c) => c.alreadyMapped) ? " (동명 전원 이미 매핑)" : " — 학생목록에서 등록 후 연결"}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[200px] flex-1">
              <SearchableSelect
                options={options}
                value={eywaId}
                onValueChange={setEywaId}
                placeholder="eywa 학생 선택"
                ariaLabel={`${row.name} eywa 연결`}
                cap={30}
              />
            </div>
            <Button type="button" size="sm" disabled={pending || !eywaId} onClick={link}>
              {pending ? "연결 중…" : "연결"}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

export function EdutrixUnmappedCard({ view }: { view: EdutrixMapView }) {
  // 기본: 테스트 프로필 숨김 — 실매핑 대상만 노출.
  const [showDummy, setShowDummy] = useState(false);

  if (!view.ok) {
    return (
      <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
        <h2 className="text-foreground text-[15px] font-bold">Edutrix 미매핑</h2>
        <p className="text-amber mt-2 text-[13px]">{view.error ?? "목록을 불러오지 못했습니다"}</p>
      </section>
    );
  }

  const { unmapped, mappedCount, edutrixStudentCount } = view;
  const dummyCount = unmapped.filter((r) => r.likelyDummy).length;
  const realCount = unmapped.length - dummyCount;
  const visible = showDummy ? unmapped : unmapped.filter((r) => !r.likelyDummy);

  return (
    <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-foreground text-[15px] font-bold">Edutrix 미매핑</h2>
          <p className="text-text-faint text-[12px]">
            보고서가 있는 Edutrix 학생 중 UUID 미연결 · 자동 이관 제외(오배정 방지). 연결 시 최근 보고서도
            이관됩니다. 테스트 프로필(학원1·테스트 등 이름)은 기본 숨김.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="bg-bg-soft text-text-dim rounded-full px-2.5 py-1">
            매핑 <b className="text-foreground tabular">{mappedCount}</b>
            <span className="text-text-faint"> / Edutrix {edutrixStudentCount}</span>
          </span>
          <span
            className={
              realCount > 0
                ? "bg-danger/10 text-danger rounded-full px-2.5 py-1 font-bold"
                : "bg-primary/10 text-primary rounded-full px-2.5 py-1 font-bold"
            }
          >
            실매핑 대상 <b className="tabular">{realCount}</b>
          </span>
          {dummyCount > 0 ? (
            <span className="bg-bg-soft text-text-faint rounded-full px-2.5 py-1">
              테스트 <b className="tabular">{dummyCount}</b>
            </span>
          ) : null}
          {dummyCount > 0 ? (
            <label className="text-text-dim flex cursor-pointer items-center gap-1.5 rounded-full border border-transparent px-2 py-1 hover:border-line">
              <input
                type="checkbox"
                className="accent-primary size-3.5"
                checked={showDummy}
                onChange={(e) => setShowDummy(e.target.checked)}
              />
              테스트 프로필 표시
            </label>
          ) : null}
        </div>
      </div>

      {unmapped.length === 0 ? (
        <p className="text-primary text-[13px]">미매핑 없음 — 보고서 있는 Edutrix 학생이 모두 연결됨.</p>
      ) : visible.length === 0 ? (
        <p className="text-text-dim text-[13px]">
          남은 미매핑 {dummyCount}건은 모두 테스트 프로필(학원1·테스트 등 이름). 우측 「테스트 프로필
          표시」로 확인할 수 있습니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead>
              <tr className="border-line text-text-faint border-b">
                <th className="px-3 py-2 font-bold">Edutrix 학생</th>
                <th className="px-3 py-2 font-bold">보고서</th>
                <th className="px-3 py-2 font-bold">eywa 연결</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <RowLink key={row.edutrixId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
