"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncIjwMathTimetable, type IjwSyncSummary } from "@/features/integrations/server/ijw-sync";

/**
 * eywa → ijw-calander 【수학 시간표】 동기화 카드 (연동 면).
 * 반 구조 + 활성 수강명단을 eywa 기준으로 ijw에 반영. integrations 쓰기 권한 전용(서버 액션이 게이트).
 * 흐름: '미리보기'(드라이런, 쓰기 없음)로 변경 규모 확인 → '동기화 반영'으로 실제 적용.
 */
export function IjwSyncCard() {
  const [previewing, startPreview] = useTransition();
  const [applying, startApply] = useTransition();
  const [preview, setPreview] = useState<IjwSyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function runPreview() {
    if (previewing || applying) return;
    setError(null);
    setDone(null);
    startPreview(async () => {
      const res = await syncIjwMathTimetable("dry-run");
      if (res?.error) setError(res.error);
      else setPreview(res?.summary ?? null);
    });
  }

  function runApply() {
    if (applying || previewing || !preview) return;
    setError(null);
    startApply(async () => {
      const res = await syncIjwMathTimetable("commit");
      if (res?.error) setError(res.error);
      else {
        const s = res?.summary;
        setDone(
          s
            ? `반영 완료 — 반 갱신 ${s.classUpdate} · 명단 추가 ${s.enrollCreate} · 명단 종료 ${s.enrollEnd}`
            : "반영 완료",
        );
        setPreview(null);
      }
    });
  }

  const busy = previewing || applying;

  return (
    <section className="bg-card border-border space-y-4 rounded-md border p-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <ArrowUpRight className="text-primary size-4" />
          <h2 className="text-foreground text-base font-semibold">구 Eywa 시간표 동기화</h2>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Eywa 2.0의 <strong>수학</strong> 시간표(반 구조 + 활성 수강명단)를 이전 버전
          <strong> 구 Eywa</strong>로 내보냅니다. Eywa 2.0이 기준이며, 반 배정이 바뀐 학생은 자동으로
          옮겨지고(추가+종료), 반의 요일·교시·강사도 Eywa 2.0 기준으로 맞춰집니다.
        </p>
      </div>

      {error ? <p className="text-chart-4 text-sm">{error}</p> : null}
      {done ? <p className="text-primary text-sm">{done}</p> : null}

      {/* 미리보기 결과 — 무엇이 얼마나 바뀔지 (쓰기 전) */}
      {preview ? (
        <div className="border-line bg-bg-soft rounded-md border p-4 text-[13px]">
          <p className="text-foreground font-medium">미리보기 (아직 반영 안 됨)</p>
          <ul className="text-text-dim mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            <li>Eywa 2.0 수학반 <b className="text-foreground">{preview.eywaMathClasses}</b></li>
            <li>Eywa 2.0 활성수강 <b className="text-foreground">{preview.eywaActiveEnrollments}</b></li>
            <li>반 갱신 <b className="text-foreground">{preview.classUpdate}</b></li>
            <li>명단 추가 <b className="text-foreground">{preview.enrollCreate}</b></li>
            <li>명단 종료 <b className="text-foreground">{preview.enrollEnd}</b></li>
            <li>학생 미매칭 <b className="text-foreground">{preview.studentUnresolved}</b></li>
          </ul>
          {preview.classMissingInIjw > 0 ? (
            <p className="text-text-faint mt-2 text-[12px]">
              ⚠️ 구 Eywa에 없는 Eywa 2.0 수학반 {preview.classMissingInIjw}개 — 이 반들은 이번에 반영되지 않습니다(구 Eywa에 반 먼저 생성 필요).
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={runPreview} disabled={busy}>
          {previewing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {previewing ? "미리보기 계산 중" : "미리보기(드라이런)"}
        </Button>
        <Button onClick={runApply} disabled={busy || !preview}>
          {applying ? <Loader2 className="size-4 animate-spin" /> : null}
          {applying ? "반영 중" : "동기화 반영"}
        </Button>
      </div>

      <p className="text-muted-foreground border-t pt-3 text-[11px]">
        범위: 수학만 · 활성 명단 파리티(추가/종료) + 반 구조. 종료는 endDate 처리(soft)라 되돌릴 수 있고,
        과거 퇴원이력 정리는 이 버튼에 포함되지 않습니다. 원장(master) 등 연동 권한자만 실행할 수 있습니다.
      </p>
    </section>
  );
}
