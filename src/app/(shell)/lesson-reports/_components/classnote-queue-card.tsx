"use client";

// 원장 보고서 관리 > ClassNote 발송 큐(5단계-2 Part A) — 상태 집계 + 주의 목록(재발송/멈춤 재시도) + 워커 상태.
import { useEffect, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { UNSENT_FILTER } from "@/features/report-admin/report-filters";
import { AlertTriangle } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { classnoteBadge } from "@/features/onescreen/components/report-card";
import { humanizeClassnoteError } from "@/features/report-admin/classnote-error";
import { formatWorkerLogLines, isWorkerLogStale, workerLogAgeLabel } from "@/features/report-admin/worker-log";
import { sanitizeErrorText } from "@/lib/text/sanitize-error";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { refreshClassnoteQueue, resetStuckClassnote, retryClassnote } from "@/features/report-admin/server/actions";
import { attentionCount, queuePollIntervalMs, shouldAutoRefreshQueue } from "@/features/report-admin/classnote-queue";
import { classnoteRetryDeadline } from "@/features/onescreen/classnote-guard";
import type { ClassnoteQueueView } from "@/features/report-admin/server/queries";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { ClassnoteSyncNowButton } from "@/features/report-admin/components/classnote-sync-now-button";

// 자동 갱신 상한 — **"변화가 없는 채로" 10분**이면 중지(창을 열어둔 채 밤새 폴링 금지).
// ⚠️ 총 시간이 아니라 '무변화 시간'인 게 핵심 — 100건 일괄 발송처럼 오래 걸리는 정상 드레인 중에
//    멋대로 멈춰서 "중지"라고 거짓 표시하면 안 된다(진행이 보이면 계속 따라간다).
const MAX_IDLE_MS = 10 * 60_000;
// 탭 전환을 연타해도 조회가 터지지 않게 하는 최소 간격.
const MIN_GAP_MS = 3_000;
// 알림이 '지난 기록'으로 보이기 시작하는 나이(시간) — 판정은 worker-log.ts WORKER_LOG_STALE_MS.
const WORKER_STALE_HOURS = 2;

/**
 * 재발송 기한 배지 — "이 건은 언제까지 손 쓸 수 있나".
 *
 * 🔴 실패 건은 사람이 ClassNote에서 원인을 고쳐야만 풀리는데(보드 배정·구분 이름), 발송 창이 7일이라
 * 고치는 사이 조용히 만료된다. 2026-08-11 실측: 실패 16건 중 11건이 이미 만료(영영 못 나감).
 * 그래서 **임박할수록 세게** 표시한다 — 남은 날이 곧 원장이 움직여야 하는 이유다.
 */
function deadlineBadge(reportDate: string, todayKst: string): { text: string; cls: string } | null {
  const d = classnoteRetryDeadline(reportDate, todayKst);
  if (d.expired) return { text: "기한 만료", cls: "text-text-faint" };
  if (d.daysLeft === 0) return { text: "오늘까지", cls: "text-danger font-bold" };
  if (d.daysLeft === 1) return { text: "내일까지", cls: "text-danger" };
  const [, m, day] = d.lastDate.split("-");
  return { text: `${Number(m)}/${Number(day)}까지`, cls: "text-text-faint" };
}

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
    <div className={`rounded-md px-2 py-0.5 ${tone}`}>
      <span className="num text-sm font-bold">{value}</span>
      <span className="ml-1 text-xs font-medium">{label}</span>
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
    <div className="flex items-baseline gap-2">
      <p className="text-text-dim text-sm font-medium">{label}</p>
      <p className={`num text-xl font-bold leading-none ${valueClass ?? "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

/**
 * 발송 PC 최근 경고 — 원문 로그를 한글로 정리해 보여준다. 변환은 formatWorkerLogLines(순수).
 * ⚠️ 예전엔 title 툴팁 하나에 원문을 통째로 넣었는데, ANSI 제어문자·UTC 시각·영문 스택이 뒤섞여
 * 읽을 수가 없었고 툴팁 자체가 안 뜨기도 했다(2026-07-21 원장 제보) → 화면에 정리해 노출.
 * ⚠️ 목록을 **인라인으로 펴면 카드(배경)가 길어진다**(2026-07-22 원장 제보) → base-ui Popover(포털)로
 * **떠 있는 팝업**으로 낸다 — 레이아웃 흐름 밖이라 배경 높이를 안 밀고, 밖을 누르면 닫힌다.
 */
function WorkerIssues({ lines, now }: { lines: string[]; now: number }) {
  const items = formatWorkerLogLines(lines);
  // ⚠️ 워커의 '최근 경고'는 **5칸 링버퍼**라 새 문제가 없으면 옛 줄이 그대로 남는다(데몬 재시작 전까지).
  //    경과를 안 보여주면 몇 시간 전 해결된 오류가 **지금 문제로 읽힌다**(2026-07-22 원장 문의의 실제 원인).
  //    `now`는 **서버가 준 시각**(뷰 생성 시점) — 렌더 중 Date.now()는 purity 룰 위반이고 시계도 갈린다.
  const stale = items.filter((it) => isWorkerLogStale(it.at, now)).length;
  if (items.length === 0) return null;
  return (
    <Popover.Root>
      <Popover.Trigger className="text-danger data-[popup-open]:underline text-xs font-bold underline-offset-2 hover:underline">
        발송 PC 알림 {items.length}건 보기
      </Popover.Trigger>
      <Popover.Portal>
        {/* 오른쪽 정렬(align=end) — 트리거가 카드 우상단이라 팝업이 화면 밖으로 안 넘치게. 좁은 창에선 max-w로 접힘. */}
        <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card max-h-[60vh] w-[420px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border p-2 text-left outline-none">
            <p className="text-text-faint mb-1.5 px-1 text-xs font-bold">발송 PC 최근 알림 {items.length}건</p>
            {/* 전부 오래된 알림이면 "지금 문제"로 오해하지 않게 먼저 말해 준다. 워커가 살아 있어도 이 목록은
                새 문제가 생겨야 바뀐다(링버퍼) — 그 사실을 모르면 해결된 오류를 계속 쫓게 된다. */}
            {stale === items.length ? (
              <p className="text-text-faint mb-1.5 px-1 text-xs leading-snug break-keep">
                모두 <b>{WORKER_STALE_HOURS}시간 이상 지난 기록</b>입니다 — 이미 해결됐을 수 있습니다(새 문제가
                생길 때까지 이 목록은 그대로 남습니다).
              </p>
            ) : null}
            <ul className="space-y-1">
              {items.map((it, i) => (
                <li
                  key={i}
                  className={`border-line/60 text-text-dim rounded-md border px-2 py-1.5 text-xs leading-snug break-keep ${
                    isWorkerLogStale(it.at, now) ? "opacity-60" : ""
                  }`}
                >
                  {it.time ? <span className="text-text-faint num mr-1">{it.time}</span> : null}
                  {workerLogAgeLabel(it.at, now) ? (
                    <span className="text-text-faint mr-1 opacity-80">({workerLogAgeLabel(it.at, now)})</span>
                  ) : null}
                  {it.label ? <span className="text-foreground mr-1 font-bold">{it.label}</span> : null}
                  {it.summary}
                  {it.raw ? <span className="text-text-faint mt-0.5 block break-all opacity-70">{it.raw}</span> : null}
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * 실패 사유 셀 — 한 줄 요약 + (원문이 더 길면) '자세히'로 그 자리 펼침.
 * ⚠️ 이전엔 `title` 툴팁 하나에 의존했는데 **실제로 안 보였다**(2026-07-21 원장 제보). 네이티브 툴팁은
 * 지연·마우스 유지·터치 환경에 좌우되고 표 셀에서 특히 놓치기 쉬워, 화면에 남는 펼침으로 바꿨다.
 * title은 보조로 남긴다(뜨면 좋고 안 떠도 무방).
 */
function ReasonCell({ summary, raw }: { summary: string; raw: string }) {
  const [open, setOpen] = useState(false);
  // 요약이 원문을 이미 다 담고 있으면(워커 한글 안내문 통과분) '자세히'는 노이즈 — 그때만 숨긴다.
  const hasMore = !!raw && raw !== summary;
  return (
    <td className="text-text-faint max-w-[280px] px-3 py-2.5 align-top">
      {/* ⚠️ **자르지 않는다** — 잘린 뒤를 볼 수단이 툴팁뿐이었고 그게 안 보였다(2026-07-21). 사유는 원장이
          다음 행동을 정하는 정보라 몇 줄 늘어나도 다 보여주는 쪽이 맞다. 한글은 어절 단위로 끊는다. */}
      <div className="break-keep whitespace-normal" title={raw || undefined}>
        {summary}
      </div>
      {hasMore ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-primary mt-0.5 text-xs font-bold underline-offset-2 hover:underline"
        >
          {open ? "접기" : "자세히"}
        </button>
      ) : null}
      {open && hasMore ? (
        <p className="text-text-dim border-line mt-1 break-keep border-t pt-1 text-xs whitespace-normal">
          {raw}
        </p>
      ) : null}
    </td>
  );
}

/**
 * `canSend` = 서버 재발송 게이트와 같은 판정(`canWriteTenant(role, "lesson_reports")`, page.tsx가 계산).
 * 읽기 권한이면 재발송·멈춤 재시도 단추와 행 선택 칸을 **그리지 않는다** — 눌러야 "권한이 없습니다"가 뜨던 자리(원장 2026-11-05).
 */
export function ClassnoteQueueCard({ view: served, canSend }: { view: ClassnoteQueueView; canSend: boolean }) {
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
  // 큐를 바꾼 시점 표식 — 재발송/멈춤 재시도를 누르면 올라간다. **이미 날아간 조회의 응답을 버리기 위한 것**:
  // 재발송 직전에 출발한 응답에는 방금 큐잉한 건이 없어, 그대로 반영하면 "발송 대기가 모두 처리되었습니다"라는
  // 거짓 완료를 띄우고 자동 갱신까지 꺼 버린다(적대 검수 확정 결함).
  const [epoch, setEpoch] = useState(0);
  const view = live && live.base === served ? live.data : served;
  const { summary, items, pending, workers, days, expiredUnsent, todayKst, unsentSendable, unsentOldestDate } = view;
  // 창(embed) 안이면 embed=1을 유지해야 크롬리스가 안 깨진다(FaceTabs와 같은 규약).
  const embed = useEmbed();
  const unsentHref = `/lesson-reports?tab=list&status=${encodeURIComponent(UNSENT_FILTER)}`;

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
  // ⚠️ 기한이 지난 건도 뺀다 — 눌러도 서버(too_old 게이트)가 거부해 헛돌 뿐이다. 개별 체크박스는
  //    그대로 열어 둔다(규칙·예외가 바뀌어도 화면이 길을 막지 않게. 최종 판단은 언제나 서버).
  // ⚠️ 멈춘 '처리 중'은 재발송이 아니라 **멈춤 재시도**가 담당한다(서버 retryClassnote는 끝나지 못한 상태만 받는다 —
  //    게시 도중일 수 있는 행을 다시 큐에 올리면 학부모에게 두 번 나간다).
  const retriable = items.filter(
    (i) =>
      i.status !== "processing" &&
      i.status !== "name_conflict" &&
      i.status !== "blocked_shared" &&
      !classnoteRetryDeadline(i.reportDate, todayKst).expired,
  );
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
        `${res.requeued ?? 0}건 재발송 대기${res.skipped ? ` · ${res.skipped}건 제외(오래된 보고서)` : ""}${res.absentSkipped ? ` · ${res.absentSkipped}건 결석 제외` : ""}${res.noClass ? ` · ${res.noClass}건 보낼 반 미지정 제외(원스크린·직접 작성에서 반을 골라 발송)` : ""}${res.makeupUnchecked ? ` · ${res.makeupUnchecked}건 보강 진행 여부 확인 전 제외` : ""}`,
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
      toast.success(
        `멈춘 발송 ${res.reset ?? 0}건 복구(재처리 대기)${res.noClass ? ` · ${res.noClass}건은 보낼 반이 없어 실패로 내림` : ""}`,
      );
      resync();
    } else toast.error(res.error ?? "멈춤 재시도에 실패했습니다");
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
    <section className="bg-card border-line rounded-lg border px-3 py-3">
      {!view.sendEnabled ? (
        <div className="border-danger bg-danger/5 text-danger mb-3 rounded-md border px-3 py-2 text-xs">
          <b>dry-run 모드</b> — 재발송을 눌러도 실제 전송되지 않습니다(저장/큐잉 안 함). 학원 설정 &gt; 보고서에서{" "}
          <b>‘ClassNote 실제 발송’</b>을 켜야 전송됩니다.
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-foreground text-base font-bold">ClassNote 발송 큐</h2>
          {/* ⚠️ 창을 정직하게 적는다 — 집계는 최근 N일이지만 **아직 손 쓸 수 있는 실패·보류는 창과 무관하게**
              전부 싣는다(그러라고 만든 예외다). 예전 문구는 "최근 3일"만 말해, 창 밖으로 밀려난 실패가
              화면에서 사라진 것을 원장이 "미발송분이 사라졌다"로 겪게 했다(2026-08-11). */}
          <p className="text-text-faint text-xs">
            최근 {days}일 집계 · 조치가 필요한 건은 기간과 무관하게 모두 표시
          </p>
        </div>
        {/* 발송 담당 PC(워커) 상태 — 큐가 실제로 처리될지 한눈에. */}
        <div className="flex flex-col items-end gap-0.5 text-xs">
          {workers.length === 0 ? (
            <span className="text-text-faint">발송 PC 미등록 — 로컬 워커 실행 필요</span>
          ) : (
            workers.map((w) => (
              <div key={w.hostname} className="flex flex-col items-end gap-0.5">
                <span className={w.online ? "text-primary" : "text-danger"}>
                  발송 PC {w.hostname} · {w.online ? "온라인" : `오프라인(${w.lastSeenMinutes}분 전)`}
                </span>
                {/* 구워커 경고(2026-07-29) — 자체 게시 버전이 아니면 옛 Edutrix 서버로 게시한다. 화면상 정상으로
                    보이다가 그 서버를 끄는 순간 전 발송이 실패하므로, 이관 전까지 여기서만 드러난다. */}
                {!w.nativePublish ? (
                  <span
                    className="text-danger inline-flex items-center gap-1"
                    title="이 PC는 옛 버전 워커입니다 — 새 zip을 전달해 주세요"
                  >
                    <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                    구버전 워커(옛 서버로 게시) — 업데이트 필요
                  </span>
                ) : null}
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
                {/* 실행환경(로그 위치·최근 경고) — 연동 PC는 물리적으로 다른 컴퓨터라 파일을 열어볼 수 없다.
                    2026-07-21: 로그 폴더를 못 만들어 watch.log가 한 줄도 안 남았고, 같은 이유로 프로비저닝
                    마커까지 죽어 하루 1회 작업이 15초마다 돌았다 — 그때 웹에 아무 단서가 없었다. */}
                <div className="flex flex-wrap justify-end gap-3">
                  {w.env.logDir ? (
                    <details className="max-w-[300px] text-right">
                      <summary className="cursor-pointer">로그 위치</summary>
                      <span className="break-all text-xs">{w.env.logDir}</span>
                    </details>
                  ) : null}
                  {w.env.recent.length > 0 ? <WorkerIssues lines={w.env.recent} now={view.nowMs} /> : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 상태 집계 — 핵심 3계열(발송완료·대기/처리중·주의)은 큰 숫자로 위계화(문법 ②),
          세부 분해(대기·처리중·실패·오래됨·동명이인·공유 보드·멈춤)는 아래 알약 칩으로 유지. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-line py-2">
        <BigStatInline label="발송완료" value={summary.success} valueClass="text-green" />
        {/* stuck은 processing의 하위집합 — '주의'로 분리 계상하므로 여기선 제외(3분할 합=전체 유지) */}
        <BigStatInline label="대기·처리중" value={summary.queued + summary.processing - summary.stuck} />
        <BigStatInline label="주의" value={attention} valueClass={attention > 0 ? "text-danger" : undefined} />
        {/* 🔴 위 셋은 **큐에 들어온 것**만 센다 — 저장만 하고 발송을 안 누른 건은 구조적으로 0이라,
            알림이 "미발송 5건"이라 해도 이 카드는 "0 대기"였다(원장 2026-09-09 *"알림이 틀린거야?"* —
            알림이 옳았다). 그래서 같은 줄에 세우고, 누르면 목록에서 그 건만 걸러 보여 준다.
            ⚠️ 조회 실패(-1)면 줄을 감춘다 — 0으로 그리면 "미발송 없음"이라는 거짓 안심이 된다. */}
        {(unsentSendable ?? 0) > 0 ? (
          <Link
            href={embed ? withEmbed(unsentHref) : unsentHref}
            className="rounded-md outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/55"
            title="저장만 되고 아직 발송 이력이 없는 보고서 — 눌러서 목록에서 확인·발송"
          >
            <BigStatInline label="미발송(저장만)" value={unsentSendable ?? 0} valueClass="text-amber" />
          </Link>
        ) : null}
      </div>
      <details className="mt-2"><summary className="cursor-pointer text-xs">상태별 상세 집계</summary><div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Stat label="대기" value={summary.queued} tone="border-line text-text-dim border" />
        <Stat label="처리중" value={summary.processing} tone="border-line text-text-dim border" />
        <Stat label="실패" value={summary.failed} tone="bg-danger/10 text-danger" />
        <Stat label="오래됨" value={summary.tooOld} tone="bg-amber-soft text-amber" />
        <Stat label="동명이인" value={summary.nameConflict} tone="bg-amber-soft text-amber" />
        <Stat label="공유 보드" value={summary.blockedShared} tone="bg-amber-soft text-amber" />
        {summary.stuck > 0 ? <Stat label="멈춤" value={summary.stuck} tone="bg-danger/10 text-danger" /> : null}
      </div></details>

      {/* 관리 버튼 — 재발송·멈춤 재시도는 쓰기 권한자만(읽기 권한엔 그리지 않는다). 동기화 단추는 서버가 스스로 숨긴다. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canSend ? (
          <>
            <Button size="sm" disabled={busy || checked.size === 0} onClick={() => doRetry([...checked])}>
              선택 재발송 {checked.size > 0 ? `(${checked.size})` : ""}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || retriable.length === 0}
              onClick={() => doRetry(retriable.map((i) => i.id))}
              title="아직 기한이 남은 실패·멈춤 전체를 재발송 대기로(기한 지난 건은 보낼 수 없어 제외)"
            >
              주의 항목 전체 재발송 ({retriable.length})
            </Button>
            {summary.stuck > 0 ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={doResetStuck}>
                멈춤 재시도 ({summary.stuck})
              </Button>
            ) : null}
          </>
        ) : null}
        {/* 지금 반 보드 동기화(0313a) — '보낼 반 없음'으로 막힌 행은 대개 새벽 동기화 전의 새 반·신입이다. */}
        <ClassnoteSyncNowButton source="lesson_reports_queue" className="ml-auto" />
      </div>

      {/* 기한을 넘겨 잃은 건 — 되살릴 수 없으므로 목록이 아니라 한 줄 경고로만(원장이 볼 곳은 위 주의 목록).
          같은 학생이 계속 쌓인다면 원인(ClassNote 보드 배정·구분 이름)이 아직 안 고쳐졌다는 뜻이다. */}
      {(unsentSendable ?? 0) > 0 ? (
        <p className="bg-amber-soft text-amber mt-3 rounded-md px-3 py-2 text-xs break-keep">
          <b>{unsentSendable}건</b>은 선생님이 저장만 하고 발송을 누르지 않은 보고서입니다
          {unsentOldestDate ? ` (가장 오래된 것 ${unsentOldestDate.slice(5).replace("-", "/")})` : ""} — 위 대기·처리중에는
          아직 들어오지 않은 건이라 이 카드의 다른 숫자에는 잡히지 않습니다.{" "}
          <Link href={embed ? withEmbed(unsentHref) : unsentHref} className="font-bold underline underline-offset-2">
            목록에서 보기
          </Link>
        </p>
      ) : null}

      {expiredUnsent > 0 ? (
        <p className="bg-amber-soft text-amber mt-3 rounded-md px-3 py-2 text-xs">
          최근 30일 <b>{expiredUnsent}건</b>은 재발송 기한(7일)을 넘겨 학부모에게 나가지 못했습니다 — 같은 학생이
          반복된다면 ClassNote 보드 배정·구분 이름을 먼저 바로잡아 주세요.
        </p>
      ) : null}

      {/* 주의 목록 */}
      {items.length === 0 ? (
        <p className="text-text-faint mt-3 text-sm">큐에 조치가 필요한 발송이 없습니다.</p>
      ) : (
        <DragScrollArea className="border-line mt-3 rounded-md border">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead>
              <tr className="border-line text-text-faint border-b">
                {/* 선택 칸은 재발송 대상 고르기라 쓰기 권한자만 — 읽기 권한엔 열 자체가 없다. */}
                {canSend ? <th className="w-8 px-2 py-2"></th> : null}
                <th className="px-3 py-2 font-bold">학생 · 과목</th>
                <th className="px-3 py-2 font-bold">날짜</th>
                <th className="px-3 py-2 font-bold">상태</th>
                <th className="px-3 py-2 font-bold">사유</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const badge = classnoteBadge(it.status ?? undefined);
                const dl = deadlineBadge(it.reportDate, todayKst);
                return (
                  <tr key={it.id} className="border-line border-b last:border-b-0">
                    {canSend ? <td className="px-2 py-2.5">
                      {/* 사람이 푸는 상태(blocked_shared·name_conflict)는 **둘 다 선택 가능** — 원장이 원인을
                          고친 뒤(예외 등재·보드 정리·구분 이름 지정·가드 수정) 보류분을 내보낼 길이 없으면
                          영영 못 나가는 막다른 길이 된다. 워커 프리플라이트가 매 시도 재평가하므로 미해결이면
                          그대로 다시 안전하게 막힌다.
                          🔴 예전엔 name_conflict만 disabled였다 — 위 주석이 "개별은 열어둔다"인데 코드가
                          반대여서, 동명이인으로 막힌 보고서를 원장이 화면에서 되살릴 방법이 없었다
                          (2026-07-29 실제로 김수아 건에서 막혀 수동 재큐잉으로 내보냄). 다시 막지 말 것. */}
                      <input
                        type="checkbox"
                        checked={checked.has(it.id)}
                        onChange={() => toggle(it.id)}
                        disabled={it.status === "processing"}
                        title={it.status === "processing" ? "처리 중에 멈춘 건은 '멈춤 재시도'로 되돌린 뒤 재발송합니다" : undefined}
                        aria-label={`${it.studentName} 선택`}
                      />
                    </td> : null}
                    <td className="px-3 py-2.5">
                      <span className="text-foreground font-bold">{it.studentName}</span>
                      {it.subject ? (
                        <span className="text-text-faint ml-1.5">{subjects.labelOf(it.subject)}</span>
                      ) : null}
                    </td>
                    <td className="text-text-dim px-3 py-2.5">
                      <span className="block">{it.reportDate}</span>
                      {/* 재발송 기한 — 이 줄이 없으면 "나중에 고치지"가 곧 영구 미발송이 된다(위 deadlineBadge 주석). */}
                      {dl ? <span className={`mt-0.5 block text-xs ${dl.cls}`}>{dl.text}</span> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      {/* 미지의 상태 코드도 raw 노출 금지 — 원문은 툴팁으로만. */}
                      {badge ? (
                        <span className={`text-xs font-bold ${badge.cls}`}>{badge.label}</span>
                      ) : (
                        <span className="text-text-dim text-xs" title={it.status ?? ""}>
                          기타
                        </span>
                      )}
                    </td>
                    {/* 사유 — ⚠️ **네이티브 title 툴팁에 의존하지 않는다**(2026-07-21 원장 제보: "마우스를 올려
                        확인"이라 써 있는데 올려도 안 보임). 요약이 잘렸을 때만 '자세히' 버튼을 띄우고, 누르면
                        원문을 그 자리에서 펼친다 — 마우스 유지·지연·터치 환경에 좌우되지 않는다.
                        ⚠️ blocked_shared는 워커가 이미 한글 안내문(연결 가족 포함)을 넣어주므로 그대로 노출. */}
                    <ReasonCell
                      summary={
                        it.status === "blocked_shared"
                          ? (it.error ?? "—")
                          : (humanizeClassnoteError(it.error) ?? "—")
                      }
                      raw={sanitizeErrorText(it.error)}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* ⚠️ 목록은 상한 100 — 넘치면 **조용히 잘린다**(빅스탯 '주의' 숫자는 전건이라 둘이 어긋난다).
              말없이 자르면 표에 보이는 게 전부인 줄 알게 된다(#89) → 잘린 수를 그 자리에서 밝힌다. */}
          {attention > items.length ? (
            <p className="text-text-faint border-line border-t px-3 py-2 text-xs">
              주의 {attention}건 중 {items.length}건만 표시했습니다 — 나머지 {attention - items.length}건은 위 항목을
              처리하면 이어서 나타납니다.
            </p>
          ) : null}
        </DragScrollArea>
      )}

      {/* 진행 중 목록 — 대기·처리중(정상 흐름). 재발송 대상이 아니라 관찰용(발송이 실제로 도는지 확인). */}
      {pending.length > 0 ? (
        <div className="mt-3">
          {/* 갱신 상태를 말로 적어준다 — 발송이 안 끝난 채 화면이 멈춰 보이면 "고장인가"로 읽히기 때문.
              화면을 못 보는 사용자에게도 상태 전환이 전달되도록 aria-live. */}
          <p className="text-text-faint mb-1.5 text-xs font-bold" aria-live="polite">
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
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={resync}>
                  다시 확인
                </Button>
              </span>
            ) : null}
          </p>
          <DragScrollArea className="border-line rounded-md border">
            <table className="w-full min-w-[480px] text-left text-xs">
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
                          <span className={`text-xs font-bold ${badge.cls}`}>{badge.label}</span>
                        ) : (
                          <span className="text-text-dim text-xs" title={it.status ?? ""}>기타</span>
                        )}
                      </td>
                      {/* 처리중이면 클레임 시각, 대기면 아직 안 잡혀 "—". */}
                      <td className="text-text-faint px-3 py-2">{it.status === "processing" ? hhmmKst(it.processingAt) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DragScrollArea>
        </div>
      ) : null}
    </section>
  );
}
