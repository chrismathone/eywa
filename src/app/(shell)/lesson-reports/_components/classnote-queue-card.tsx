"use client";

// 원장 보고서 관리 > ClassNote 발송 큐(5단계-2 Part A) — 상태 집계 + 주의 목록(재발송/멈춤복구) + 워커 상태.
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { classnoteBadge } from "@/features/onescreen/components/report-card";
import { humanizeClassnoteError } from "@/features/report-admin/classnote-error";
import { sanitizeErrorText } from "@/lib/text/sanitize-error";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { resetStuckClassnote, retryClassnote } from "@/features/report-admin/server/actions";
import type { ClassnoteQueueView } from "@/features/report-admin/server/queries";

// 처리 시작 시각의 시:분(KST) — 대기·처리중 목록에서 언제 잡혔는지 표시. 값 없으면 "—".
function hhmmKst(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// 세부 상태 칩(알약) — 위계는 위 BigStatInline 3개가 잡고, 여기는 내역 분해용 보조 라벨.
function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-full px-3 py-1 ${tone}`}>
      <span className="num text-[13px] font-bold">{value}</span>
      <span className="ml-1 text-[11.5px] font-medium">{label}</span>
    </div>
  );
}

// 핵심 3계열 빅 스탯(문법 ② 인라인 변형) — 큰 num 숫자 + 작은 dim 라벨.
function BigStatInline({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: number;
  valueClass?: string;
}) {
  return (
    <div>
      <p className="text-text-dim text-[12px] font-medium">{label}</p>
      <p className={`num mt-1 text-[26px] font-bold leading-none ${valueClass ?? "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

export function ClassnoteQueueCard({ view }: { view: ClassnoteQueueView }) {
  const router = useRouter();
  const { summary, items, pending, workers, days } = view;
  const subjects = useSubjectMaps(); // 과목 표시는 한글 라벨(raw 키 노출 금지)
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // **일괄** 재발송 대상 — 동명이인(이름 수정 선행)·공유 보드 차단(ClassNote 정리 또는 발송 예외 등재 선행)은
  // 원인을 안 고친 채 일괄로 밀어봐야 그대로 다시 막혀 헛돌기만 하므로 제외(버튼 제목이 범위를 명시).
  // ⚠️ 단 **개별 '선택 재발송'은 열어둔다**(체크박스 활성) — 원장이 원인을 고친 뒤 보류된 건을 내보낼 길이
  // 없으면 그 보고서는 영영 못 나가는 막다른 길이 된다. 공유 보드 게이트는 **매 시도마다 재평가**하므로
  // 아직 안 고쳐졌으면 안전하게 다시 막힌다 = 개별 재발송을 열어둬도 위험하지 않다.
  const retriable = items.filter((i) => i.status !== "name_conflict" && i.status !== "blocked_shared");
  const toggle = (id: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function doRetry(ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    const res = await retryClassnote(ids);
    setBusy(false);
    if (res.ok && res.dryRun) {
      toast.message("dry-run — 승인 전이라 실제 재발송 안 함. 원장 설정(보고서)에서 'ClassNote 실제 발송'을 켜야 전송됩니다");
      setChecked(new Set());
    } else if (res.ok) {
      toast.success(`${res.requeued ?? 0}건 재발송 대기${res.skipped ? ` · ${res.skipped}건 제외(오래된 보고서)` : ""}`);
      setChecked(new Set());
      router.refresh();
    } else toast.error(res.error ?? "재발송에 실패했습니다");
  }

  async function doResetStuck() {
    setBusy(true);
    const res = await resetStuckClassnote();
    setBusy(false);
    if (res.ok) {
      toast.success(`멈춘 발송 ${res.reset ?? 0}건 복구(재처리 대기)`);
      router.refresh();
    } else toast.error(res.error ?? "멈춤복구에 실패했습니다");
  }

  // 주의 = 사람이 손대야 할 계열 합(실패·오래됨·동명이인·공유 보드·멈춤) — 큰 숫자 하나로 위계.
  const attention =
    summary.failed + summary.tooOld + summary.nameConflict + summary.blockedShared + summary.stuck;

  return (
    <section className="bg-card shadow-card rounded-2xl px-5 py-5">
      {!view.sendEnabled ? (
        <div className="border-danger bg-danger/5 text-danger mb-3 rounded-md border px-3 py-2 text-[12px]">
          <b>dry-run 모드</b> — 재발송을 눌러도 실제 전송되지 않습니다(저장/큐잉 안 함). 학원 설정 &gt; 보고서에서{" "}
          <b>‘ClassNote 실제 발송’</b>을 켜야 전송됩니다.
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-foreground text-[15px] font-bold">ClassNote 발송 큐</h2>
          <p className="text-text-faint text-[12px]">최근 {days}일 · 발송 요청된 보고서 상태</p>
        </div>
        {/* 발송 담당 PC(워커) 상태 — 큐가 실제로 처리될지 한눈에. */}
        <div className="flex flex-col items-end gap-0.5 text-[11px]">
          {workers.length === 0 ? (
            <span className="text-text-faint">발송 PC 미등록 — 로컬 워커 실행 필요</span>
          ) : (
            workers.map((w) => (
              <div key={w.hostname} className="flex flex-col items-end gap-0.5">
                <span className={w.online ? "text-primary" : "text-danger"}>
                  발송 PC {w.hostname} · {w.online ? "온라인" : `오프라인(${w.lastSeenMinutes}분 전)`}
                </span>
                {/* 폴러별 마지막 실행(0123a) — 하트비트는 살아도 특정 폴러만 조용히 실패하는 걸 여기서 잡는다. */}
                {w.results.length > 0 ? (
                  <span
                    className="text-text-faint max-w-[300px] truncate"
                    title={w.results.map((r) => `${r.label} ${r.text}`).join(" · ")}
                  >
                    {w.results.map((r, i) => (
                      <span key={r.key} className={r.error ? "text-danger" : undefined}>
                        {i > 0 ? " · " : ""}
                        {r.label} {r.text}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 상태 집계 — 핵심 3계열(발송완료·대기/처리중·주의)은 큰 숫자로 위계화(문법 ②),
          세부 분해(대기·처리중·실패·오래됨·동명이인·공유 보드·멈춤)는 아래 알약 칩으로 유지. */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <BigStatInline label="발송완료" value={summary.success} valueClass="text-primary" />
        <BigStatInline label="대기·처리중" value={summary.queued + summary.processing} />
        <BigStatInline label="주의" value={attention} valueClass={attention > 0 ? "text-danger" : undefined} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Stat label="대기" value={summary.queued} tone="border-line text-text-dim border" />
        <Stat label="처리중" value={summary.processing} tone="border-line text-text-dim border" />
        <Stat label="실패" value={summary.failed} tone="bg-danger/10 text-danger" />
        <Stat label="오래됨" value={summary.tooOld} tone="bg-amber-soft text-amber" />
        <Stat label="동명이인" value={summary.nameConflict} tone="bg-amber-soft text-amber" />
        <Stat label="공유 보드" value={summary.blockedShared} tone="bg-amber-soft text-amber" />
        {summary.stuck > 0 ? <Stat label="멈춤" value={summary.stuck} tone="bg-danger/10 text-danger" /> : null}
      </div>

      {/* 관리 버튼 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || checked.size === 0} onClick={() => doRetry([...checked])}>
          선택 재발송 {checked.size > 0 ? `(${checked.size})` : ""}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || retriable.length === 0}
          onClick={() => doRetry(retriable.map((i) => i.id))}
          title="실패·오래됨·멈춤 전체를 재발송 대기로"
        >
          주의 항목 전체 재발송 ({retriable.length})
        </Button>
        {summary.stuck > 0 ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={doResetStuck}>
            멈춤복구 ({summary.stuck})
          </Button>
        ) : null}
      </div>

      {/* 주의 목록 */}
      {items.length === 0 ? (
        <p className="text-text-faint mt-3 text-[13px]">주의가 필요한 발송이 없습니다 — 모두 정상입니다.</p>
      ) : (
        <div className="border-line mt-3 overflow-x-auto rounded-md border">
          <table className="w-full min-w-[560px] text-left text-[12px]">
            <thead>
              <tr className="border-line text-text-faint border-b">
                <th className="w-8 px-2 py-2"></th>
                <th className="px-3 py-2 font-bold">학생 · 과목</th>
                <th className="px-3 py-2 font-bold">날짜</th>
                <th className="px-3 py-2 font-bold">상태</th>
                <th className="px-3 py-2 font-bold">사유</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const badge = classnoteBadge(it.status ?? undefined);
                return (
                  <tr key={it.id} className="border-line border-b last:border-b-0">
                    <td className="px-2 py-2.5">
                      {/* 공유 보드 차단(blocked_shared)분은 **선택 가능** — 원장이 발송 예외 등재/보드 정리 후
                          '선택 재발송'으로 내보낼 길이 있어야 한다(막으면 영영 못 나가는 막다른 길).
                          게이트가 매 시도 재평가하므로 미해결이면 그대로 다시 안전하게 막힌다. */}
                      <input
                        type="checkbox"
                        checked={checked.has(it.id)}
                        onChange={() => toggle(it.id)}
                        aria-label={`${it.studentName} 선택`}
                        disabled={it.status === "name_conflict"}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-foreground font-bold">{it.studentName}</span>
                      {it.subject ? (
                        <span className="text-text-faint ml-1.5">{subjects.labelOf(it.subject)}</span>
                      ) : null}
                    </td>
                    <td className="text-text-dim px-3 py-2.5">{it.reportDate}</td>
                    <td className="px-3 py-2.5">
                      {/* 미지의 상태 코드도 raw 노출 금지 — 원문은 툴팁으로만. */}
                      {badge ? (
                        <span className={`text-[11px] font-bold ${badge.cls}`}>{badge.label}</span>
                      ) : (
                        <span className="text-text-dim text-[11px]" title={it.status ?? ""}>
                          기타
                        </span>
                      )}
                    </td>
                    {/* 사유 = 한글 요약(기술 원문은 마우스 오버 툴팁) — 원장이 바로 읽게.
                        ⚠️ blocked_shared는 워커가 이미 한글 안내문(연결 가족 포함)을 넣어주므로 그대로 노출한다
                        — humanizeClassnoteError를 태우면 '발송 실패…' 일반 문구로 뭉개진다. */}
                    <td className="text-text-faint max-w-[260px] truncate px-3 py-2.5" title={sanitizeErrorText(it.error)}>
                      {it.status === "blocked_shared"
                        ? (it.error ?? "—")
                        : (humanizeClassnoteError(it.error) ?? "—")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 진행 중 목록 — 대기·처리중(정상 흐름). 재발송 대상이 아니라 관찰용(발송이 실제로 도는지 확인). */}
      {pending.length > 0 ? (
        <div className="mt-3">
          <p className="text-text-faint mb-1.5 text-[12px] font-bold">진행 중 · 대기 {summary.queued} · 처리중 {summary.processing}</p>
          <div className="border-line overflow-x-auto rounded-md border">
            <table className="w-full min-w-[480px] text-left text-[12px]">
              <thead>
                <tr className="border-line text-text-faint border-b">
                  <th className="px-3 py-2 font-bold">학생 · 과목</th>
                  <th className="px-3 py-2 font-bold">날짜</th>
                  <th className="px-3 py-2 font-bold">상태</th>
                  <th className="px-3 py-2 font-bold">처리 시작</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((it) => {
                  const badge = classnoteBadge(it.status ?? undefined);
                  return (
                    <tr key={it.id} className="border-line border-b last:border-b-0">
                      <td className="px-3 py-2">
                        <span className="text-foreground font-bold">{it.studentName}</span>
                        {it.subject ? <span className="text-text-faint ml-1.5">{subjects.labelOf(it.subject)}</span> : null}
                      </td>
                      <td className="text-text-dim px-3 py-2">{it.reportDate}</td>
                      <td className="px-3 py-2">
                        {badge ? (
                          <span className={`text-[11px] font-bold ${badge.cls}`}>{badge.label}</span>
                        ) : (
                          <span className="text-text-dim text-[11px]" title={it.status ?? ""}>기타</span>
                        )}
                      </td>
                      {/* 처리중이면 클레임 시각, 대기면 아직 안 잡혀 "—". */}
                      <td className="text-text-faint px-3 py-2">{it.status === "processing" ? hhmmKst(it.processingAt) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
