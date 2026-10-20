"use client";
import { useEffect, useRef, useState, useTransition, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { checkEnrollmentHistory } from "./server/actions";
import type { Identity } from "./evidence";
import { HistoryResult } from "./history-result";

type Result = Awaited<ReturnType<typeof checkEnrollmentHistory>>;
export function EnrollmentHistoryCheck({ identity, formRef }: {
  identity?: Identity; formRef?: RefObject<HTMLFormElement | null>;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const initialized = useRef(false);
  const sequence = useRef(0);
  function check(value: Identity) {
    const request = ++sequence.current;
    start(async () => {
      try { const next = await checkEnrollmentHistory(value); if (request === sequence.current) setResult(next); }
      catch { if (request === sequence.current) setResult({ error: "과거 이력을 확인하지 못했습니다. 다시 확인해 주세요." }); }
    });
  }
  useEffect(() => {
    if (identity && !initialized.current) { initialized.current = true; check(identity); }
  }, [identity]);
  useEffect(() => {
    const form = formRef?.current;
    function clear(event: Event) {
      if (!(event.target instanceof HTMLInputElement) || !["prospectName", "parentPhone", "studentPhone"].includes(event.target.name)) return;
      sequence.current++; setResult(null);
    }
    form?.addEventListener("input",clear);
    return () => form?.removeEventListener("input",clear);
  }, [formRef]);
  function run() {
    if (identity) return check(identity);
    const form = formRef?.current;
    if (!form) return;
    const data = new FormData(form);
    check({ name: String(data.get("prospectName") ?? ""),
      phones: [String(data.get("parentPhone") ?? ""),String(data.get("studentPhone") ?? "")] });
  }
  return <section className="border-line bg-card space-y-3 rounded-2xl border p-4" aria-label="상담 전 과거 이력 확인">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-bold">상담 전 · 이전 문의 확인</h2>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={run}>
        {pending ? "과거 기록 확인 중…" : "이전 상담 확인"}
      </Button>
    </div>
    <p className="text-text-dim text-sm">신규 문의로 안내하기 전에 구글캘린더의 과거 상담·입학 일정과 에이와 등록 근거를 확인합니다.</p>
    <div aria-live="polite">{result ? "error" in result ? <p role="alert" className="text-sm">{result.error}</p>
      : <HistoryResult result={result} /> : <p className="text-sm">{pending ? "여러 해의 기록을 확인하고 있습니다." : "이름과 연락처를 입력한 뒤 확인해 주세요. 아직 신규 여부를 확인하지 않았습니다."}</p>}</div>
  </section>;
}
