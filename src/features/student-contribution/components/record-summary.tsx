"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmbedLink as Link } from "@/components/embed-link";
import { generateStudentRecordSummary } from "../server/summary-actions";
import type { getStudentRecordSummary } from "../server/summary-query";

export function RecordSummary({ studentId, data }: { studentId: string; data: NonNullable<Awaited<ReturnType<typeof getStudentRecordSummary>>> }) {
  const [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const router = useRouter();
  const generate = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true);
    setMessage("");
    try {
      const result = await generateStudentRecordSummary(studentId);
      setMessage(result.error ?? "요약을 저장했습니다.");
      if (result.ok) router.refresh();
    } catch { setMessage("요약을 불러오지 못했습니다. 다시 시도해 주세요."); }
    finally { inFlight.current = false; setPending(false); }
  };
  return <section className="space-y-3 rounded-xl border border-line p-5" aria-label="최근 기록 요약">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">최근 기록 요약</h2>
      <p className="mt-1 text-xs">Claude가 최근 기록에서 핵심 내용을 골라 원문과 함께 정리합니다.</p></div>
      {data.canWrite && <Button size="sm" variant="outline" disabled={pending} onClick={generate}>{pending ? "요약하는 중…" : data.state === "ready" ? "다시 요약" : "최근 기록 요약하기"}</Button>}
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
    {data.state === "ready" ? <><ul className="grid grid-cols-1 gap-4 md:grid-cols-2">{data.items.map((item) => <li key={item.itemId} className="rounded-lg bg-secondary p-4">
      <Link href={item.href} className="text-xs font-semibold text-primary underline">{item.title} 원본</Link><blockquote className="mt-2 text-sm leading-relaxed">{item.excerpt}</blockquote>
    </li>)}</ul><p className="text-xs">{data.generatedAt ? new Date(data.generatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : ""}에 저장 · {data.model ?? "Claude"}{data.partial ? " · 일부 자료는 확인하지 못했습니다." : ""}</p></>
      : <p className="text-sm">{data.state === "stale" ? `기준 날짜·원본·열람 범위가 달라져 이전 요약을 표시하지 않습니다.${data.canWrite ? " 다시 요약해 주세요." : ""}`
        : data.state === "unavailable" ? "현재 근거를 확인할 수 없어 요약을 표시하지 않습니다."
          : data.canWrite ? "아직 생성한 요약이 없습니다. 버튼을 누르면 현재 확인 가능한 기록으로 요약합니다." : "저장된 요약이 없습니다."}</p>}
  </section>;
}
