"use client";
import { tipProps } from "@/components/hover-tip/tip";

import { useState, useTransition } from "react";
import { Loader2, Send } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { enqueueConsultationPush } from "@/features/integrations/server/actions";
import type { UnpushedIntakeConsultation } from "@/features/integrations/server/makeedu-sync";
import { isPushInFlight } from "@/features/integrations/push-eligibility";
import { outcomePill } from "@/features/enrollment/outcome-meta";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { phoneLabel } from "@/lib/format/phone";

/**
 * 역동기화(aywa→makeedu) 카드 — QR 공개접수로 들어온 신규 상담 중 makeedu에 아직 없는 것을
 * 골라 "makeedu로 보내기"로 큐잉. 실제 등록은 동기화 PC 워처가 신뢰 IP에서 수행(~1-2분).
 * 소비처 2곳: owner 연동 면(항상 표시, 빈 상태 포함 — 실패 건 재전송) + 콜&상담 머리글 'makeedu 보내기'
 * 버튼이 여는 다이얼로그(`inDialog` — 원장 2026-10-01, 카드 껍데기는 다이얼로그가 맡는다).
 * 서버 액션 게이트 = `canPushToMakeedu`(integrations 쓰기) — 버튼도 같은 함수로 노출을 판단한다.
 */
export function MakeeduPushCard({
  candidates,
  inDialog = false,
}: {
  candidates: UnpushedIntakeConsultation[];
  /** 다이얼로그 안 — 테두리·배경·안쪽 여백을 빼고(다이얼로그 표면이 대신) 오른쪽 위 닫기 단추 자리를 비운다. */
  inDialog?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const allSelectable = candidates.filter((c) => !isPushInFlight(c.pushStatus));
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
    <section className={inDialog ? "space-y-4" : "bg-card border-border space-y-4 rounded-2xl border p-6"}>
      <div className={`flex flex-wrap items-start justify-between gap-3 ${inDialog ? "pr-8" : ""}`}>
        <div className="min-w-0">
          <h2 className="text-foreground text-base font-bold">makeedu로 상담 보내기 (역동기화)</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            QR 공개접수로 들어온 신규 상담 중 <strong>makeedu에 아직 없는 건</strong>입니다. 선택해서 보내면
            동기화 PC가 makeedu 예비상담으로 등록합니다(1~2분). 전송된 건은 목록에서 사라집니다.
          </p>
          {/* 운영 사실 — 상주 워처가 매주 일요일 06:00(KST)에 남은 후보를 같은 큐로 넣는다(scripts/_makeedu/weekly-push.cjs).
              여기서 고르는 건 그 전에 먼저 보내고 싶은 건·실패 건 재전송이다. */}
          <p className="text-muted-foreground mt-1 text-sm">
            매주 일요일 06:00에 남은 건을 자동으로도 보냅니다(연동 PC가 꺼져 있었으면 켜질 때) — 그 전에 보내야
            하는 건만 골라 보내세요.
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
        {/* 가로만 넘치는 8열 표 — overflow-x-auto로 스크롤(overflow-y-hidden 병행: Chrome 세로 휠 삼킴 방지). */}
        <table className="w-full text-sm">
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
              <th className="px-3 py-2 text-left font-medium">상담 상태</th>
              <th className="px-3 py-2 text-left font-medium">접수일</th>
              <th className="px-3 py-2 text-left font-medium">전송 상태</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {candidates.map((c) => {
              const locked = isPushInFlight(c.pushStatus);
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
                  <td className="text-foreground px-3 py-2 font-medium whitespace-nowrap">
                    {c.prospectName}
                    {/* 등록됐는데 makeedu에 학생이 없는 건 — 왜 목록에 있는지 밝히지 않으면
                        "이미 다니는 학생이 왜 신규 문의에?"로 읽힌다(push-eligibility.ts). */}
                    {c.note ? (
                      <span className="bg-amber/15 text-amber rounded-pill ml-1.5 px-2 py-0.5 text-xs font-bold" {...tipProps(c.note)}>
                        makeedu 미등록
                      </span>
                    ) : null}
                  </td>
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">
                    {schoolGradeLabel(c.prospectSchool, c.prospectGrade) || "—"}
                  </td>
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">
                    {c.parentName ?? "—"}
                    {c.parentPhone ? <span className="text-text-faint"> · {phoneLabel(c.parentPhone)}</span> : null}
                  </td>
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">{c.consultationPath ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {/* 등록상담 진행 단계(칸반과 동일 표기) — makeedu로 보내기 전 어디까지 진행됐는지 판단용. */}
                    <Pill color={outcomePill(c.outcome).color}>{outcomePill(c.outcome).label}</Pill>
                  </td>
                  <td className="text-text-faint px-3 py-2 whitespace-nowrap tabular">
                    {new Date(c.createdAt).toLocaleDateString("ko-KR", {
                      timeZone: "Asia/Seoul",
                      month: "numeric",
                      day: "numeric",
                    })}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {locked ? (
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
      <p className="text-text-faint flex items-start gap-1.5 text-xs">
        <EyIcon name="alert" size={13} className="mt-0.5 shrink-0" />
        <span>makeedu는 정본입니다 — 전송은 <strong>새로 추가만</strong> 하고 기존 makeedu 데이터는 건드리지 않습니다.
        전송 실패 건은 원인을 확인 후 다시 선택해 보낼 수 있습니다.
        </span>
      </p>
    </section>
  );
}
