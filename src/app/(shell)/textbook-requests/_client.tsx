"use client";

import { useActionState } from "react";
import { BookMarked, FileDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { requestTextbook } from "@/features/billing/server/textbook-actions";
import type { StudentOption, TextbookOrderRow } from "@/features/billing/server/textbook-queries";

/** 진행 3단계 배지 — 신청(requested)→주문(ordered)→납부(paid). ijw 교재 상태와 동일 순서. */
function StatusBadge({ row }: { row: TextbookOrderRow }) {
  const label = row.paid ? "납부 완료" : row.ordered ? "주문됨" : "신청됨";
  const tone = row.paid
    ? "bg-primary-soft text-primary"
    : row.ordered
      ? "bg-blue-soft text-blue"
      : "bg-amber-soft/50 text-amber";
  return (
    <span className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>
      {label}
    </span>
  );
}

export function TextbookRequestClient({
  rows,
  students,
  isTeacher,
}: {
  rows: TextbookOrderRow[];
  students: StudentOption[];
  isTeacher: boolean;
}) {
  // 성공 시 목록은 서버 액션 revalidatePath로 자동 갱신. 폼 값은 유지(같은 학생 다른 교재 연속 요청에 편함).
  const [state, formAction, pending] = useActionState(requestTextbook, undefined);

  const options = students.map((s) => ({
    value: s.id,
    label: s.name,
    hint: s.grade ?? undefined,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-2">
        <BookMarked className="text-primary size-5" />
        <div>
          <h1 className="text-foreground text-[19px] font-bold">교재 요청</h1>
          <p className="text-text-dim text-[13px]">
            {isTeacher
              ? "담당 학생의 교재를 요청하면 사무실에서 주문·납부를 처리합니다."
              : "교재 요청 목록 — 사무실은 수납관리 › 교재에서 주문·납부를 처리합니다."}
          </p>
        </div>
      </header>

      {/* 요청 폼 */}
      <section className="border-line bg-card rounded-md border p-4">
        <h2 className="text-foreground mb-3 flex items-center gap-1.5 text-[13px] font-bold">
          <Plus className="size-4" /> 새 교재 요청
        </h2>
        {students.length === 0 ? (
          <p className="text-text-dim text-[13px]">담당 학생이 없어 교재를 요청할 수 없습니다.</p>
        ) : (
          <form action={formAction} className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-text-dim text-[12px] font-medium">
                학생 <span className="text-danger">*</span>
              </span>
              <SearchableSelect
                name="studentId"
                options={options}
                placeholder="학생 선택..."
                ariaLabel="교재 요청 학생 선택"
              />
              {state?.fieldErrors?.studentId ? (
                <span className="text-danger text-[11px]">{state.fieldErrors.studentId}</span>
              ) : null}
            </label>
            <label className="space-y-1">
              <span className="text-text-dim text-[12px] font-medium">
                교재명 <span className="text-danger">*</span>
              </span>
              <Input name="bookName" placeholder="예: 쎈 중등수학 2-1" />
              {state?.fieldErrors?.bookName ? (
                <span className="text-danger text-[11px]">{state.fieldErrors.bookName}</span>
              ) : null}
            </label>
            <label className="space-y-1">
              <span className="text-text-dim text-[12px] font-medium">비고(선택)</span>
              <Input name="bookDetail" placeholder="예: 3권, 개정판" />
            </label>
            <label className="space-y-1">
              <span className="text-text-dim text-[12px] font-medium">메모(선택)</span>
              <Input name="notes" placeholder="사무실 전달 메모" />
            </label>
            <div className="sm:col-span-2 flex items-center gap-3">
              <Button type="submit" disabled={pending}>
                {pending ? "요청 중…" : "교재 요청"}
              </Button>
              {state?.error ? <span className="text-danger text-[12px]">{state.error}</span> : null}
              {state?.ok ? (
                <span className="text-primary flex items-center gap-2 text-[12px]">
                  요청되었습니다.
                  {state.createdId ? (
                    <a
                      href={`/textbook/${state.createdId}/print?download=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex items-center gap-1 font-semibold underline underline-offset-2"
                    >
                      <FileDown className="size-3.5" /> 요청서 다운로드
                    </a>
                  ) : null}
                </span>
              ) : null}
            </div>
          </form>
        )}
      </section>

      {/* 요청 목록 + 진행상태 */}
      <section className="space-y-2">
        <h2 className="text-text-dim text-[12px] font-bold">요청 목록 ({rows.length})</h2>
        {rows.length === 0 ? (
          <p className="text-text-faint border-line rounded-md border border-dashed p-6 text-center text-[13px]">
            아직 교재 요청이 없습니다.
          </p>
        ) : (
          <ul className="divide-line border-line divide-y overflow-hidden rounded-md border">
            {rows.map((r) => (
              <li key={r.id} className="bg-card flex items-center gap-3 px-3 py-2.5 text-[13px]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground truncate font-medium">{r.bookName}</span>
                    {r.bookDetail ? <span className="text-text-faint truncate text-[12px]">{r.bookDetail}</span> : null}
                  </div>
                  <div className="text-text-dim mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
                    {r.studentName ? <span>{r.studentName}</span> : null}
                    {r.requestDate ? <span className="text-text-faint">· {r.requestDate}</span> : null}
                    {r.notes ? <span className="text-text-faint">· {r.notes}</span> : null}
                  </div>
                </div>
                <StatusBadge row={r} />
                <a
                  href={`/textbook/${r.id}/print`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-faint hover:text-primary inline-flex shrink-0 items-center gap-1 text-[12px]"
                  title="교재 요청서 (이미지 저장·인쇄)"
                >
                  <FileDown className="size-3.5" /> 요청서
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
