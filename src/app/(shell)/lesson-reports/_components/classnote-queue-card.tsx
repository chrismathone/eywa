"use client";

// 원장 보고서 관리 > ClassNote 발송 큐(5단계-2 Part A) — 상태 집계 + 주의 목록(재발송/멈춤복구) + 워커 상태.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { classnoteBadge } from "@/features/onescreen/components/report-card";
import { humanizeClassnoteError } from "@/features/report-admin/classnote-error";
import { sanitizeErrorText } from "@/lib/text/sanitize-error";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { refreshClassnoteQueue, resetStuckClassnote, retryClassnote } from "@/features/report-admin/server/actions";
import { attentionCount, queuePollIntervalMs, shouldAutoRefreshQueue } from "@/features/report-admin/classnote-queue";
import type { ClassnoteQueueView } from "@/features/report-admin/server/queries";

// 자동 갱신 상한 — **"변화가 없는 채로" 10분**이면 중지(창을 열어둔 채 밤새 폴링 금지).
// ⚠️ 총 시간이 아니라 '무변화 시간'인 게 핵심 — 100건 일괄 발송처럼 오래 걸리는 정상 드레인 중에
//    멋대로 멈춰서 "중지"라고 거짓 표시하면 안 된다(진행이 보이면 계속 따라간다).
const MAX_IDLE_MS = 10 * 60_000;
// 탭 전환을 연타해도 조회가 터지지 않게 하는 최소 간격.
const MIN_GAP_MS = 3_000;

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

export function ClassnoteQueueCard({ view: served }: { view: ClassnoteQueueView }) {
  const router = useRouter();
  const subjects = useSubjectMaps(); // 과목 표시는 한글 라벨(raw 키 노출 금지)
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // 자동 갱신으로 받아온 최신 큐 + 그때 깔려 있던 서버값(base). 서버가 새 값을 내려주면(탭 이동·router.refresh·
  // 재발송) base가 달라지므로 **폴링 스냅샷을 자동으로 버린다** — 안 그러면 낡은 스냅샷이 서버 최신값을 영구히
  // 가려 새로 올라온 발송이 카드에 안 잡힌다.
  const [live, setLive] = useState<{ base: ClassnoteQueueView; data: ClassnoteQueueView } | null>(null);
  const [stalled, setStalled] = useState(false); // 상한 도달로 자동 갱신을 멈춘 상태
  const [failing, setFailing] = useState(false); // 조회가 연속 실패 중(화면은 직전 값 — '갱신 중'이라고 말하면 안 됨)
  // 큐를 바꾼 시점 표식 — 재발송/멈춤복구를 누르면 올라간다. **이미 날아간 조회의 응답을 버리기 위한 것**:
  // 재발송 직전에 출발한 응답에는 방금 큐잉한 건이 없어, 그대로 반영하면 "발송 대기가 모두 처리되었습니다"라는
  // 거짓 완료를 띄우고 자동 갱신까지 꺼 버린다(적대 검수 확정 결함).
  const [epoch, setEpoch] = useState(0);
  const view = live && live.base === served ? live.data : served;
  const { summary, items, pending, workers, days } = view;

  // 자동 갱신 조건·주기는 순수 함수 단일 소스 — 표시 문구도 같은 판정을 쓴다.
  const workerOnline = workers.some((w) => w.online);
  const polling = shouldAutoRefreshQueue({ pendingCount: pending.length, stalled });
  const periodMs = queuePollIntervalMs(workerOnline);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let timer = 0;
    let inFlight = false; // 조회가 느릴 때 다음 주기와 겹쳐 도는 것 방지
    let lastPollAt = 0;
    let quietSince = Date.now(); // 마지막으로 '변화'가 보인 시각(진행이 보이면 갱신)
    let lastSignature = ""; // 남은 건수·발송완료·주의 — 하나라도 움직이면 '진행 중'으로 본다
    // 큐가 비기 직전의 주의 건수(새로 생긴 것만 알리려고). **감시를 시작한 시점 값으로 시드** —
    // 첫 조회가 곧바로 '큐 빔'이면 시드가 없어 실패가 생겼는데도 "모두 처리"라고 말하게 된다(적대 검수 확정).
    let attentionBefore = attentionCount(served.summary);
    let fails = 0;
    let hiddenAt = 0; // 화면이 가려진 시각 — 안 보던 시간은 '무변화' 시간으로 세지 않는다
    const tick = async () => {
      // 백그라운드 탭은 건너뛴다(창 N개 × 폴링 비용, B6). 다시 보이는 순간 즉시 1회 조회.
      if (inFlight || document.visibilityState === "hidden") return;
      if (Date.now() - lastPollAt < MIN_GAP_MS) return; // 탭 전환 연타 방어
      if (Date.now() - quietSince > MAX_IDLE_MS) {
        window.clearInterval(timer);
        setStalled(true);
        return;
      }
      inFlight = true;
      lastPollAt = Date.now();
      const next = await refreshClassnoteQueue(days).catch(() => null);
      inFlight = false;
      if (cancelled) return;
      if (!next) {
        // 조회 실패(네트워크·서버 오류·권한) — 직전 값은 그대로 두되, **'갱신 중'이라고 말하지 않는다**
        // (멈춘 화면 위에 '자동 갱신 중'이 떠 있으면 거짓 안심). 재시도는 계속한다.
        if (++fails >= 2) setFailing(true);
        return;
      }
      fails = 0;
      setFailing(false);
      setLive({ base: served, data: next });
      // 주의 목록이 바뀌면 사라진 행의 체크는 버린다 — 안 그러면 '선택 재발송 (3)'이 화면에 없는 행까지
      // 세어, 원장이 보고 있는 것과 실제 대상이 어긋난다(적대 검수 확정).
      setChecked((prev) => {
        if (prev.size === 0) return prev;
        const alive = new Set(next.items.map((i) => i.id));
        const kept = new Set([...prev].filter((id) => alive.has(id)));
        return kept.size === prev.size ? prev : kept;
      });
      // 진행이 보이면(남은 건수·발송완료·주의 중 하나라도 움직이면) 상한 타이머를 리셋한다 —
      // 100건 일괄 발송처럼 10분을 넘기는 정상 드레인을 '멈춤'으로 오판하지 않기 위해.
      const signature = `${next.pending.length}:${next.summary.success}:${attentionCount(next.summary)}`;
      if (signature !== lastSignature) {
        lastSignature = signature;
        quietSince = Date.now();
      }
      // 더 볼 게 없으면 **이 자리에서 즉시** 멈춘다 — 재렌더→이펙트 정리를 기다리는 사이 한 주기가 더 도는 걸 막는다
      // (받아온 결과가 판정의 진실이다). 새 발송이 생기면 이펙트가 다시 켜진다.
      if (shouldAutoRefreshQueue({ pendingCount: next.pending.length, stalled: false })) {
        attentionBefore = attentionCount(next.summary);
        return;
      }
      window.clearInterval(timer);
      // 큐가 다 빠졌다 — 페이지 나머지(목록 탭 상태 열 등)도 이때 딱 한 번만 서버에서 다시 받는다.
      // ⚠️ '큐가 비었다 = 다 잘 나갔다'가 아니다(실패·동명이인도 진행 중에서 빠진다) — **이번에 새로 생긴**
      //    주의만 알린다(원래 있던 잔여까지 세면 매번 경보가 떠 아무도 안 읽는다).
      const added = Math.max(0, attentionCount(next.summary) - attentionBefore);
      if (added > 0) toast.message(`발송 대기가 모두 끝났습니다 — ${added}건은 확인이 필요합니다`);
      else toast.success("발송 대기가 모두 처리되었습니다");
      router.refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      // 안 보던 시간만큼 '무변화' 시계를 뒤로 민다 — 가려 둔 20분 때문에 돌아오자마자 "10분째 변화 없음"으로
      // 멈춰 버리면, 그 사이 정작 발송이 끝났는지조차 확인 못 한다(적대 검수 확정).
      if (hiddenAt) {
        quietSince += Date.now() - hiddenAt;
        hiddenAt = 0;
      }
      void tick();
    };
    timer = window.setInterval(() => void tick(), periodMs);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // served가 deps에 있어야 tick이 **현재** 서버값을 base로 기록한다(낡은 base로 저장하면 즉시 무효화되어 헛돈다).
    // epoch가 deps에 있어야 큐를 바꾼 순간 이 이펙트가 정리되고(cancelled), 이미 날아간 응답이 버려진다.
  }, [polling, periodMs, days, router, served, epoch]);

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
      toast.success(
        `${res.requeued ?? 0}건 재발송 대기${res.skipped ? ` · ${res.skipped}건 제외(오래된 보고서)` : ""}${res.absentSkipped ? ` · ${res.absentSkipped}건 결석 제외` : ""}`,
      );
      setChecked(new Set());
      resync();
    } else toast.error(res.error ?? "재발송에 실패했습니다");
  }

  async function doResetStuck() {
    setBusy(true);
    const res = await resetStuckClassnote();
    setBusy(false);
    if (res.ok) {
      toast.success(`멈춘 발송 ${res.reset ?? 0}건 복구(재처리 대기)`);
      resync();
    } else toast.error(res.error ?? "멈춤복구에 실패했습니다");
  }

  // 큐를 바꾼 직후 / '다시 확인' — 폴링 캐시를 버리고(그게 이기면 방금 큐잉한 건이 안 보인다) 서버에서 다시 받는다.
  // 상한으로 멈춰 있었다면 자동 갱신도 다시 켠다.
  function resync() {
    setEpoch((e) => e + 1); // 진행 중이던 조회 응답 폐기(낡은 결과가 '완료'로 오인되지 않게)
    setLive(null);
    setStalled(false);
    setFailing(false);
    router.refresh();
  }

  // 주의 = 사람이 손대야 할 계열 합(실패·오래됨·동명이인·공유 보드·멈춤) — 큰 숫자 하나로 위계.
  const attention = attentionCount(summary);

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
        {/* stuck은 processing의 하위집합 — '주의'로 분리 계상하므로 여기선 제외(3분할 합=전체 유지) */}
        <BigStatInline label="대기·처리중" value={summary.queued + summary.processing - summary.stuck} />
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
          {/* 갱신 상태를 말로 적어준다 — 발송이 안 끝난 채 화면이 멈춰 보이면 "고장인가"로 읽히기 때문.
              화면을 못 보는 사용자에게도 상태 전환이 전달되도록 aria-live. */}
          <p className="text-text-faint mb-1.5 text-[12px] font-bold" aria-live="polite">
            진행 중 · 대기 {summary.queued} · 처리중 {summary.processing}
            {polling && failing ? (
              // 조회가 계속 실패하는데 '갱신 중'이라고 두면 멈춘 숫자를 최신으로 오해한다.
              <span className="text-danger ml-1.5 font-medium">· 갱신에 실패해 다시 시도하는 중입니다</span>
            ) : polling && workerOnline ? (
              <span className="text-primary ml-1.5 font-medium">· 자동 갱신 중(10초마다)</span>
            ) : polling ? (
              // 워커가 꺼져 있어도 멈추지 않는다 — 켜지는 순간 스스로 이어받는다(사람에게 새로고침 안 시킴).
              <span className="text-amber ml-1.5 font-medium">
                · 발송 PC {workers.length === 0 ? "미등록" : "꺼짐"} — 켜지면 자동으로 이어서 갱신합니다(1분마다 확인)
              </span>
            ) : stalled ? (
              <span className="text-amber ml-1.5 font-medium">
                · 10분째 변화가 없어 자동 갱신을 멈췄습니다{" "}
                <Button variant="link" size="sm" className="h-auto p-0 text-[12px]" onClick={resync}>
                  다시 확인
                </Button>
              </span>
            ) : null}
          </p>
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
