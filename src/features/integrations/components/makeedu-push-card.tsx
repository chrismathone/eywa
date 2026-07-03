"use client";

import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { enqueueConsultationPush } from "@/features/integrations/server/actions";
import type { UnpushedIntakeConsultation } from "@/features/integrations/server/makeedu-sync";

/**
 * 역동기화(eywa→makeedu) 카드 — QR 공개접수로 들어온 신규 상담 중 makeedu에 아직 없는 것을
 * 골라 "makeedu로 보내기"로 큐잉. 실제 등록은 동기화 PC 워처가 신뢰 IP에서 수행(~1-2분).
 * 소비처 2곳: owner 연동 면(항상 표시, 빈 상태 포함) + 등록상담 화면(후보 있을 때만 — 부모가 판단).
 * 서버 액션 게이트 = `integrations` 권한 키(기본 master/admin/manager) — 부모도 같은 키로 노출 판단.
 */
export function MakeeduPushCard({ candidates }: { candidates: UnpushedIntakeConsultation[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const allSelectable = candidates.filter((c) => c.pushStatus !== "pending" && c.pushStatus !== "running");
  const allChecked = allSelectable.length > 0 && allSelectable.every((c) => selected.has(c.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(allSelectable.map((c) => c.id)));
  }

  function push() {
    if (pending || selected.size === 0) return;
    setMsg(null);
    const ids = [...selected];
    start(async () => {
      const res = await enqueueConsultationPush(ids);
      if (res?.error) setMsg({ ok: false, text: res.error });
      else {
        setMsg({ ok: true, text: res?.message ?? "전송 대기열에 넣었습니다." });
        setSelected(new Set());
      }
    });
  }

  return (
    <section className="bg-card border-border space-y-4 rounded-md border p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-foreground text-base font-semibold">makeedu로 상담 보내기 (역동기화)</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            QR 공개접수로 들어온 신규 상담 중 <strong>makeedu에 아직 없는 건</strong>입니다. 선택해서 보내면
            동기화 PC가 makeedu 예비상담으로 등록합니다(1~2분). 전송된 건은 목록에서 사라집니다.
          </p>
        </div>
        <Button onClick={push} disabled={pending || selected.size === 0}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          makeedu로 보내기{selected.size > 0 ? ` (${selected.size})` : ""}
        </Button>
      </div>

      {msg ? (
        <p className={`text-sm ${msg.ok ? "text-primary" : "text-chart-4"}`}>{msg.text}</p>
      ) : null}

      {candidates.length === 0 ? (
        // 빈 상태 — 후보가 없어도 카드는 남겨 발견성 유지(어디서 보내는지 항상 노출). 버튼은 비활성.
        <div className="border-border text-text-dim flex items-center justify-center rounded-md border border-dashed px-4 py-8 text-center text-sm">
          지금 makeedu로 보낼 새 QR 접수 상담이 없습니다.
          <br className="hidden sm:block" />
          <span className="text-text-faint"> 새 공개접수가 들어오면(이미 등록·전송된 건 제외) 여기에 표시됩니다.</span>
        </div>
      ) : (
      <div className="border-border overflow-x-auto overflow-y-hidden rounded-md border">
        {/* 가로만 넘치는 7열 표 — overflow-x-auto로 스크롤(overflow-y-hidden 병행: Chrome 세로 휠 삼킴 방지). */}
        <table className="w-full text-[13px]">
          <thead className="bg-bg-soft text-text-dim">
            <tr>
              <th className="w-10 px-3 py-2 text-left">
                <input
                  type="checkbox"
                  aria-label="전체 선택"
                  checked={allChecked}
                  onChange={toggleAll}
                  disabled={allSelectable.length === 0}
                />
              </th>
              <th className="px-3 py-2 text-left font-medium">학생</th>
              <th className="px-3 py-2 text-left font-medium">학교·학년</th>
              <th className="px-3 py-2 text-left font-medium">보호자</th>
              <th className="px-3 py-2 text-left font-medium">경로</th>
              <th className="px-3 py-2 text-left font-medium">접수일</th>
              <th className="px-3 py-2 text-left font-medium">상태</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {candidates.map((c) => {
              const locked = c.pushStatus === "pending" || c.pushStatus === "running";
              return (
                <tr key={c.id} className={selected.has(c.id) ? "bg-primary-soft/40" : undefined}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`${c.prospectName} 선택`}
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      disabled={locked}
                    />
                  </td>
                  <td className="text-foreground px-3 py-2 font-medium whitespace-nowrap">{c.prospectName}</td>
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">
                    {[c.prospectSchool, c.prospectGrade].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">
                    {c.parentName ?? "—"}
                    {c.parentPhone ? <span className="text-text-faint"> · {c.parentPhone}</span> : null}
                  </td>
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">{c.consultationPath ?? "—"}</td>
                  <td className="text-text-faint px-3 py-2 whitespace-nowrap tabular">
                    {new Date(c.createdAt).toLocaleDateString("ko-KR", {
                      timeZone: "Asia/Seoul",
                      month: "numeric",
                      day: "numeric",
                    })}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {c.pushStatus === "pending" || c.pushStatus === "running" ? (
                      <Pill color="blue">전송 대기</Pill>
                    ) : c.pushStatus === "error" ? (
                      <Pill color="danger" className="cursor-help" >전송 실패</Pill>
                    ) : (
                      <Pill color="neutral">미전송</Pill>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      <p className="text-text-faint text-[11px]">
        ⚠️ makeedu는 정본입니다 — 전송은 <strong>새로 추가만</strong> 하고 기존 makeedu 데이터는 건드리지 않습니다.
        전송 실패 건은 원인을 확인 후 다시 선택해 보낼 수 있습니다.
      </p>
    </section>
  );
}
