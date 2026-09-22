"use client";

/**
 * 수업보고서 **회수** 탭 — 원장/관리자가 **전체 보고서를 검색해** 학부모 게시글을 거둬들인다
 * (원장 지시 2026-08-05: *"관리자는 전체 수업보고서 검색 후 회수 가능"*).
 *
 * 왜 목록 탭이 아니라 별도 탭인가: 목록은 열람·발송·수업일 지정이 섞인 일상 화면이고, 회수는 **되돌릴 수 없는
 * 파괴적 동작**이다. 같은 표에 섞으면 오클릭 거리가 가까워지고 경고가 묻힌다 — 들어올 때부터 "지금은 회수 화면"인
 * 것이 보여야 한다(원장이 '회수 탭'을 찾은 것도 같은 기대).
 *
 * 🔴 기본 조회는 **발송 완료(success)** 로 고정한다 — 회수할 수 있는 것만 보여준다.
 *    미발송·실패 건을 섞어 놓고 버튼만 잠그면 "왜 안 눌리지"가 되고, 그건 거짓 약속이다.
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { listReports } from "@/features/report-admin/server/actions";
import { RecallButton } from "@/features/report-admin/components/recall-button";
import { classnoteBadge } from "@/features/onescreen/components/report-card";
import type { ReportFilterOptions } from "@/features/report-admin/server/queries";
import type { ReportListFilters, ReportListRow } from "@/features/report-admin/report-filters";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";

type Result = { rows: ReportListRow[]; total: number; page: number; pageSize: number };

/** 회수 화면의 조회 기본값 — 발송 완료만, 기간 무제한(옛 오발송도 찾아야 한다). */
function defaultRecallFilters(): ReportListFilters {
  return { page: 0, status: "success" };
}

export function RecallFace({ options, todayYmd }: { options: ReportFilterOptions; todayYmd: string }) {
  const subjects = useSubjectMaps();
  const [filters, setFilters] = useState<ReportListFilters>(defaultRecallFilters);
  const [student, setStudent] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();

  function run(next: ReportListFilters) {
    setFilters(next);
    start(async () => {
      const res = await listReports(next);
      if (res.ok) setResult({ rows: res.rows ?? [], total: res.total ?? 0, page: res.page ?? 0, pageSize: res.pageSize ?? 30 });
      else {
        setResult(null);
        toast.error(res.error ?? "조회하지 못했습니다");
      }
    });
  }
  const search = () => run({ ...filters, student: student.trim() || undefined, page: 0 });

  const rows = result?.rows ?? [];
  const maxPage = result ? Math.max(0, Math.ceil(result.total / result.pageSize) - 1) : 0;

  return (
    <section className="bg-card border-line shadow-card rounded-2xl border p-4">
      <div className="mb-3">
        <h2 className="text-foreground text-base font-bold">보고서 회수</h2>
        <p className="text-text-faint mt-0.5 text-xs">
          학부모 게시판에 올라간 보고서를 거둬들입니다. 학생 이름으로 찾는 게 가장 빠릅니다.
        </p>
      </div>

      {/* 경고 — 무슨 일이 일어나는지 화면에 상시 노출(버튼 안 다이얼로그에만 두면 스크롤 위에서 안 보인다). */}
      <p className="border-amber/40 bg-amber-soft text-amber mb-3 flex items-start gap-1.5 rounded-md border px-3 py-2 text-xs leading-relaxed">
        <EyIcon name="alert" size={14} className="mt-0.5 shrink-0" />
        <span>
          회수하면 <b>학부모 공유 링크가 즉시 차단</b>되고, 연동 PC가 <b>ClassNote 게시글을 삭제</b>합니다.
          되돌릴 수 없으며, 학부모가 이미 읽었을 수 있습니다. 다시 보내려면 링크 재발급 후 새로 작성해야 합니다.
        </span>
      </p>

      {/* 검색 — 이름이 주 진입점, 나머지는 보조. 기간은 비워 두면 전체(옛 오발송도 찾아야 한다). */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={student}
          onChange={(e) => setStudent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") search();
          }}
          placeholder="학생 이름"
          aria-label="학생 이름"
          className="border-line rounded-lg border px-2.5 py-1.5 text-sm"
        />
        <select
          value={filters.teacher ?? ""}
          onChange={(e) => run({ ...filters, teacher: e.target.value || undefined, student: student.trim() || undefined, page: 0 })}
          aria-label="강사"
          className="border-line rounded-lg border px-2 py-1.5 text-sm"
        >
          <option value="">강사 전체</option>
          {options.teachers.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={filters.from ?? ""}
          max={todayYmd}
          onChange={(e) => run({ ...filters, from: e.target.value || undefined, student: student.trim() || undefined, page: 0 })}
          aria-label="시작일"
          className="border-line rounded-lg border px-2 py-1.5 text-sm"
        />
        <span className="text-text-faint text-xs">~</span>
        <input
          type="date"
          value={filters.to ?? ""}
          max={todayYmd}
          onChange={(e) => run({ ...filters, to: e.target.value || undefined, student: student.trim() || undefined, page: 0 })}
          aria-label="종료일"
          className="border-line rounded-lg border px-2 py-1.5 text-sm"
        />
        <Button size="sm" disabled={pending} onClick={search}>
          {pending ? "찾는 중…" : "찾기"}
        </Button>
        {/* 회수 진행/완료건도 뒤처리(실패 재시도)를 위해 볼 수 있어야 한다. */}
        <select
          value={filters.status ?? "success"}
          onChange={(e) => run({ ...filters, status: e.target.value, student: student.trim() || undefined, page: 0 })}
          aria-label="상태"
          className="border-line rounded-lg border px-2 py-1.5 text-sm"
        >
          <option value="success">발송 완료(회수 가능)</option>
          <option value="recall_requested">회수 처리 중</option>
          <option value="recalled">회수됨</option>
          <option value="recall_failed">회수 실패</option>
        </select>
      </div>

      {result === null ? (
        <p className="text-text-faint py-8 text-center text-sm">
          학생 이름을 입력하고 <b>찾기</b>를 누르세요.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-text-faint py-8 text-center text-sm">조건에 맞는 보고서가 없습니다.</p>
      ) : (
        <>
          <p className="text-text-dim mb-1.5 text-xs">총 {result.total}건</p>
          <DragScrollArea>
            <table className="w-full text-sm">
              <thead className="text-text-faint border-line border-b text-left">
                <tr>
                  <th className="px-3 py-2 font-bold">수업일</th>
                  <th className="px-3 py-2 font-bold">학생 · 과목</th>
                  <th className="px-3 py-2 font-bold">반</th>
                  <th className="px-3 py-2 font-bold">강사</th>
                  <th className="px-3 py-2 font-bold">상태</th>
                  <th className="px-3 py-2 text-right font-bold">회수</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const badge = classnoteBadge(r.classnoteStatus ?? undefined);
                  return (
                    <tr key={r.id} className="border-line hover:bg-bg-soft border-b">
                      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{r.reportDate}</td>
                      <td className="px-3 py-2">
                        <span className="text-foreground font-bold">{r.studentName}</span>
                        {r.subject ? <span className="text-text-faint ml-1.5">{subjects.labelOf(r.subject)}</span> : null}
                      </td>
                      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{r.className ?? "—"}</td>
                      <td className="text-text-dim px-3 py-2">{r.teacherName ?? "—"}</td>
                      <td className="px-3 py-2">
                        {badge ? <span className={`text-xs font-bold ${badge.cls}`}>{badge.label}</span> : null}
                        {/* 읽음은 **양성 표시만**(없음 = 미읽음이 아니라 동기화 안 됨일 수 있다) */}
                        {r.readAt ? <span className="text-primary ml-1.5 text-xs font-bold">읽음</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <RecallButton
                          reportId={r.id}
                          studentName={r.studentName}
                          classnoteStatus={r.classnoteStatus}
                          shareToken={r.shareToken}
                          readAt={r.readAt}
                          onDone={() => run(filters)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DragScrollArea>
          {maxPage > 0 ? (
            <div className="mt-3 flex items-center justify-center gap-2 text-xs">
              <Button size="sm" variant="ghost" disabled={result.page <= 0 || pending} onClick={() => run({ ...filters, page: result.page - 1 })}>
                이전
              </Button>
              <span className="text-text-dim">
                {result.page + 1} / {maxPage + 1}
              </span>
              <Button size="sm" variant="ghost" disabled={result.page >= maxPage || pending} onClick={() => run({ ...filters, page: result.page + 1 })}>
                다음
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
