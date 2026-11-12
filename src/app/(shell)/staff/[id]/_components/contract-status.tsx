"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useActionState } from "react";
import { toast } from "sonner";
import { CalendarClock, Loader2, Plus, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { extendStaffContract, type ContractActionState } from "@/features/staff/contract/server/contract-actions";
import type { ContractFileRow } from "@/features/staff/contract/server/contract-queries";
import { ContractPdfPicker } from "./contract-pdf-picker";
import { ContractFiles } from "./contract-files";
import { ContractHistory } from "./contract-history";
import { useLicenseOn } from "@/features/owner/operations-context";
import {
  currentContract,
  daysUntil,
  nextContractDefault,
  periodLabel,
  type ContractRow,
} from "@/features/staff/contract/contract";

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

/**
 * 계약현황 — 현재계약(첫 출근일 기준 1년, 차수만큼 증감) + 계약서 파일 보관 + 히스토리(수정·삭제) + 연장.
 * 기간 계산은 순수 함수([`contract.ts`])가 단일 소스이고 여기선 그리기만 한다.
 * 히스토리 편집은 [`contract-history.tsx`], 파일 보관은 [`contract-files.tsx`]가 담당(2026-08-03 분리).
 */
export function ContractStatus({
  userId,
  hireDate,
  rows,
  files,
  today,
  canWrite,
}: {
  userId: string;
  hireDate: string | null;
  rows: ContractRow[];
  files: ContractFileRow[];
  /** 서버가 넘긴 오늘 날짜("YYYY-MM-DD") — 클라에서 new Date()를 쓰면 시간대·하이드레이션이 어긋난다. */
  today: string;
  canWrite: boolean;
}) {
  const aiOn = useLicenseOn("ai_analysis");
  const [open, setOpen] = useState(false);
  // 기간·조건 칸은 컨트롤드 — PDF에서 읽은 값을 여기에 채워 넣어야 하기 때문(uncontrolled면 못 덮는다).
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [terms, setTerms] = useState("");
  const [state, formAction] = useActionState<ContractActionState, FormData>(extendStaffContract, undefined);
  const seenRef = useRef<ContractActionState>(undefined);

  // 성공하면 입력 패널을 접는다 — **렌더 단계**에서(effect 안 setState는 금지 [[#25]]).
  const [closedFor, setClosedFor] = useState<ContractActionState>(undefined);
  if (state?.ok && state !== closedFor) {
    setClosedFor(state);
    setOpen(false);
  }

  // 토스트는 부수효과라 effect에서.
  useEffect(() => {
    if (!state || state === seenRef.current) return;
    seenRef.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success(state.notice ?? "저장했습니다");
  }, [state]);

  const current = currentContract(rows, hireDate);
  const next = nextContractDefault(rows, hireDate);
  const left = current ? daysUntil(current.endDate, today) : null;
  // 만료됐거나 60일 안에 끝나면 '갱신할 때' — 배지와 버튼이 같은 기준을 쓴다.
  // 기입된 계약이 없으면 만료 판정 자체가 무의미(계산값이라) → 갱신이 아니라 '기입'이다.
  const dueSoon = !!current?.stored && left !== null && left <= 60;
  const actionLabel = !current?.stored ? "계약 기입" : dueSoon ? "계약 갱신" : "계약 연장";

  return (
    <section className="border-line bg-card flex flex-col rounded-2xl border p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-foreground text-sm font-bold">계약현황</h2>
        {canWrite && next ? (
          // 만료됐거나 임박하면 채운 버튼 + '계약 갱신'으로 — 지난 계약을 못 보고 지나치지 않게(원장 지시).
          <Button
            variant={dueSoon ? "default" : "outline"}
            size="sm"
            onClick={() => {
              // 열 때 다음 차수 기본값을 채워 넣는다(칸이 컨트롤드라 defaultValue를 못 쓴다).
              if (!open) {
                setStart(next.startDate);
                setEnd(next.endDate);
                setTerms("");
              }
              setOpen(!open);
            }}
          >
            {open ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
            {open ? "취소" : actionLabel}
          </Button>
        ) : null}
      </div>

      {/* 현재계약 */}
      {current ? (
        <div className="border-line bg-bg-soft/40 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="micro">현재 계약</span>
            {/* 기입된 계약과 **계산값**은 절대 같아 보이면 안 된다(원장 제보 2026-07-30: "둘 다 1차인데
                왜 한 명은 히스토리가 남고 한 명은 안 남지?"). 저장된 행이 없으면 'N차'라고 단정하지 않는다 —
                그건 우리가 뒷받침할 수 없는 주장이다. */}
            {current.stored ? (
              <Pill color="primary" soft>
                {current.seq}차
              </Pill>
            ) : (
              <Pill color="neutral" soft>
                미기입
              </Pill>
            )}
            {/* 만료 배지는 **기입된 계약에만**. 계산값에 붙이면 2018년 입사자가 "만료 2900일 지남"으로
                뜨는데, 실제로는 계약을 아직 안 적은 것일 뿐이라 거짓 경보가 된다. */}
            {current.stored && left !== null ? (
              left < 0 ? (
                <Pill color="danger" soft>
                  만료 {Math.abs(left)}일 지남
                </Pill>
              ) : left <= 60 ? (
                <Pill color="amber" soft>
                  만료 {left}일 전
                </Pill>
              ) : null
            ) : null}
          </div>
          {current.stored ? (
            <p className="num text-foreground mt-1.5 text-base font-bold">{periodLabel(current)}</p>
          ) : (
            <>
              <p className="num text-text-dim mt-1.5 text-base font-bold">{periodLabel(current)}</p>
              <p className="text-text-faint mt-1 text-xs">
                아직 기입된 계약이 없어 <b>입사일({hireDate}) + 1년</b>으로 계산한 값입니다 — 실제 계약서를
                &lsquo;{actionLabel}&rsquo;으로 넣으면 이 자리와 히스토리에 함께 남습니다.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="border-line rounded-xl border border-dashed p-4 text-center">
          <CalendarClock className="text-text-faint mx-auto size-5" />
          <p className="text-text-dim mt-1.5 text-xs">
            입사일이 없어 계약 기간을 계산할 수 없습니다 — 이력서에서 입사일을 먼저 입력하세요.
          </p>
        </div>
      )}

      {/* 연장 폼 */}
      {open && next ? (
        <form action={formAction} className="border-line mt-4 rounded-xl border p-4">
          <input type="hidden" name="userId" value={userId} />
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="micro">{next.seq}차 계약 기입</p>
            {/* 계약서 PDF에서 기간·조건을 읽어 아래 칸을 채우고, 파일은 아래 '계약서 파일'에 함께 보관된다.
                **저장은 사람이** — 돈 정보라 확인 단계를 둔다. */}
            {aiOn ? <ContractPdfPicker
              userId={userId}
              onExtract={(d) => {
                if (d.startDate) setStart(d.startDate);
                if (d.endDate) setEnd(d.endDate);
                if (d.terms) setTerms(d.terms);
              }}
            /> : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="c-start" className="micro mb-1 block">
                시작일
              </label>
              <input
                id="c-start"
                name="startDate"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="c-end" className="micro mb-1 block">
                종료일
              </label>
              <input
                id="c-end"
                name="endDate"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <label htmlFor="c-terms" className="micro mt-3 mb-1 block">
            계약조건
          </label>
          <input
            id="c-terms"
            name="terms"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            placeholder="예: 급여제 강사"
            className={inputClass}
          />
          <label htmlFor="c-memo" className="micro mt-3 mb-1 block">
            메모
          </label>
          <input id="c-memo" name="memo" placeholder="선택" className={inputClass} />
          <div className="mt-3 flex justify-end">
            <SubmitButton label="계약 기입" />
          </div>
        </form>
      ) : null}

      {/* 계약서 파일 보관 — 원본 PDF를 직원에게 붙여 둔다(2026-08-03). 올리기는 보관만(원장 2026-08-05
          역할 분리) — 추출·폼 채움은 위 기입 폼의 '계약서 PDF 불러오기'(ContractPdfPicker)가 전담. */}
      <ContractFiles userId={userId} files={files} canWrite={canWrite} aiOn={aiOn} />

      {/* 히스토리 — 전 줄 수정·삭제 가능(2026-08-03). */}
      <ContractHistory userId={userId} rows={rows} canWrite={canWrite} />
    </section>
  );
}
