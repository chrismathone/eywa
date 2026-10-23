"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmbedLink as Link } from "@/components/embed-link";
import { generateStudentRecordSummary } from "../server/summary-actions";
import type { getStudentRecordSummary } from "../server/summary-query";
import { kstDateOf } from "@/lib/date-kst";

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
      setMessage(result.error ? `${result.error}${data.state === "ready" ? " 아래에는 이전에 저장한 내용을 표시합니다." : ""}` : "요약을 저장했습니다.");
      if (result.ok) router.refresh();
    } catch { setMessage("요약 결과를 확인하지 못해 저장된 내용을 다시 확인합니다. 결과가 바뀌지 않았다면 잠시 후 다시 시도해 주세요."); router.refresh(); }
    finally { inFlight.current = false; setPending(false); }
  };
  return <section className="space-y-3 rounded-xl border border-line p-5" aria-label="최근 기록 요약">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">최근 기록 요약</h2>
      <p className="mt-1 text-xs">현재 수강과 최근 상담의 핵심입니다. 각 항목에서 근거와 원본을 확인할 수 있습니다.</p></div>
      {data.canWrite && <Button size="sm" variant="outline" disabled={pending} onClick={generate}>{pending ? "요약하는 중…" : data.state === "ready" ? "다시 요약" : "최근 기록 요약하기"}</Button>}
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
    {data.state === "ready" ? <>
      {data.legacy && <p className="rounded-lg bg-primary-softer px-3 py-2 text-sm">이전 방식으로 저장된 원문 발췌입니다.{data.canWrite ? " 다시 요약하면 핵심 문장으로 정리합니다." : ""}</p>}
      <ul className="divide-y divide-line-faint">{data.items.map((item) => <li key={item.itemId} className="grid gap-x-6 gap-y-2 py-4 first:pt-1 md:grid-cols-[10rem_minmax(0,1fr)]">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 md:block"><p className="text-sm font-semibold">{item.title}</p>{item.date && <p className="text-xs tabular-nums md:mt-1">{kstDateOf(item.date) ?? item.date}</p>}</div>
        <div className="min-w-0"><p className="max-w-4xl whitespace-pre-wrap break-words text-base leading-relaxed">{item.summary ?? item.excerpt}</p>
          {item.summary ? <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium text-primary">근거 확인</summary>
            <blockquote className="mt-2 max-w-4xl rounded-md bg-bg-soft/60 px-3 py-2 text-sm leading-relaxed">{item.excerpt}</blockquote><Link href={item.href} className="mt-2 inline-block text-primary underline underline-offset-4">{item.title} 원본 보기</Link></details>
            : <Link href={item.href} className="mt-2 inline-block text-xs text-primary underline underline-offset-4">{item.title} 원본 보기</Link>}
        </div>
      </li>)}</ul><p className="border-t border-line-faint pt-3 text-xs">{data.generatedAt ? new Date(data.generatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : ""} 저장 · {data.model ?? "Claude"}{data.partial ? " · 일부 자료는 확인하지 못했습니다." : ""}</p></>
      : <p className="text-sm">{data.state === "stale" ? `기준 날짜·원본·열람 범위가 달라져 이전 요약을 표시하지 않습니다.${data.canWrite ? " 다시 요약해 주세요." : ""}`
        : data.state === "unavailable" ? "현재 근거를 확인할 수 없어 요약을 표시하지 않습니다."
          : data.canWrite ? "아직 생성한 요약이 없습니다. 버튼을 누르면 현재 확인 가능한 기록으로 요약합니다." : "저장된 요약이 없습니다."}</p>}
  </section>;
}
