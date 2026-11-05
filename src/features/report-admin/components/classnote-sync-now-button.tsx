"use client";

/**
 * **지금 반 보드 동기화** 버튼 — 보고서 설정·발송 큐·반 단체 공지·원스크린 '보낼 반' 고르기 공용(원장 2026-09-30).
 *
 * - 상태는 DB 한 행(0313a)이 정한다 — 어느 화면에서 눌러도 모든 화면의 이 버튼이 '요청됨'·'동기화 중…'으로 잠긴다
 *   (진짜 자물쇠는 DB 부분 유니크 + 서버 액션 쿨다운. 여기 잠금은 연타·표시용).
 * - 대기·실행 중엔 10초마다 상태를 다시 묻고, 끝나면 멈춘다.
 * - 🔴 선생님(보고서 쓰기 권한이 없는 강사)에게는 그리지 않는다(원장 2026-10-06 *"선생님 버튼은 자동 동기화 요청에 의한 건
 *   아니면 누를 수 없게"*) — 서버가 상태를 숨기고(`available:false`) 직접 요청도 거절한다. 화면에서 감추는 것만으로는
 *   게이트가 아니다([[#77]]).
 * - ClassNote 모듈이 꺼졌거나·권한이 없거나·0313a 적용 전이거나·반 보드를 안 쓰는 지점이면 **아무것도 그리지 않는다**
 *   (원장 *"꺼지면 있었는지조차 모르게"*).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deriveSyncView, kstHhmm, SYNC_COOLDOWN_MIN, type SyncButtonView } from "@/features/report-admin/classnote-sync";
import { reportAttention as countReportAttention } from "@/features/report-admin/classnote-sync-report";
import {
  getClassnoteSyncStatus,
  requestClassnoteBoardSync,
  type ClassnoteSyncStatus,
} from "@/features/report-admin/server/classnote-sync-actions";
import { downloadClassnoteSyncReport } from "@/features/report-admin/server/classnote-sync-report-actions";

const EXPLAIN_TAIL = `바뀐 반만(한 번에 최대 15개) 동기화합니다. 한 번 누르면 끝날 때까지 모든 화면에서 잠기고, 끝난 뒤 ${SYNC_COOLDOWN_MIN}분 동안은 다시 누를 수 없습니다.`;
const EXPLAIN = "평소에는 매일 새벽 5시에 연동 PC가 ClassNote 반 보드를 aywa 반에 맞춥니다. 새 반·반 이름 변경·신입 배정을 지금 바로 맞추려면 누르세요 — " + EXPLAIN_TAIL;
// 연동 PC가 자동 동기화를 하는 지점에서만 이 설명을 쓴다(연동 PC를 바꾸기 전·꺼 둔 지점에 없는 기능을 말하지 않는다).
const EXPLAIN_AUTO =
  "연동 PC가 낮 동안 달라진 반을 몇 분 안에 스스로 맞추고, 매일 새벽 5시에 전체 반을 다시 맞춥니다. 기다리지 않고 지금 바로 맞추거나, 방금 가입한 학부모를 확인해 바로 배정하려면 누르세요 — " +
  EXPLAIN_TAIL;

const POLL_ACTIVE_MS = 10_000;
const TICK_MS = 30_000;

export function ClassnoteSyncNowButton({
  classIds,
  studentIds,
  source,
  className,
}: {
  /** 지목할 반 — 없으면 바뀐 반 전부(차이 계산). */
  classIds?: string[];
  /** 지목할 학생 — 그 학생이 다니는 반 + 가입 확인(원아 연결 갱신). 1인 보드는 만들지도 배정하지도 않는다(2026-11-04). */
  studentIds?: string[];
  /** 감사로그용 누른 자리(한글 아님 — 화면에 안 나간다). */
  source: string;
  className?: string;
}) {
  const [status, setStatus] = useState<ClassnoteSyncStatus | null>(null);
  const [clicking, setClicking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const skew = useRef(0); // 서버 시각 - 브라우저 시각(쿨다운·멈춤 판정을 서버 시계로)

  const accept = useCallback((s: ClassnoteSyncStatus) => {
    skew.current = s.nowMs - Date.now();
    setNowMs(s.nowMs);
    setStatus(s);
  }, []);

  useEffect(() => {
    let alive = true;
    getClassnoteSyncStatus()
      .then((s) => alive && accept(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [accept]);

  const view: SyncButtonView = status ? deriveSyncView({ ...status, nowMs: nowMs || status.nowMs }) : { kind: "hidden" };
  const active = view.kind === "pending" || view.kind === "running";
  const waiting = view.kind === "cooldown" || (view.kind === "failed" && view.leftMin > 0);

  // 대기·실행 중이면 10초마다 다시 묻는다(끝나면 멈춘다). 쿨다운·실패 대기는 시계만 넘긴다(서버를 안 부른다).
  useEffect(() => {
    if (!active && !waiting) return;
    const id = setInterval(
      () => {
        if (active) getClassnoteSyncStatus().then(accept).catch(() => {});
        else setNowMs(Date.now() + skew.current);
      },
      active ? POLL_ACTIVE_MS : TICK_MS,
    );
    return () => clearInterval(id);
  }, [active, waiting, accept]);

  if (view.kind === "hidden") return null;

  async function onClick() {
    if (clicking) return;
    setClicking(true); // 누르는 즉시 잠근다(응답 전 연타 방지)
    try {
      const res = await requestClassnoteBoardSync({ classIds, studentIds, source });
      if (res.ok) {
        toast.success(res.message);
        accept(res.status);
      } else {
        toast.error(res.error);
        getClassnoteSyncStatus().then(accept).catch(() => {});
      }
    } catch {
      toast.error("동기화를 요청하지 못했습니다 — 잠시 뒤 다시 시도하세요");
    } finally {
      setClicking(false);
    }
  }

  // 동기화 보고서(0329a) — 가장 최근 동기화의 변동·실패·보류(이유 포함)와 전 반의 해제 대상을 txt로. 글은 서버가 만든다(권한·감사로그).
  async function onDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await downloadClassnoteSyncReport();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // BOM — 옛 메모장도 한글을 깨뜨리지 않게. 파일 이름의 한글은 a.download가 그대로 받는다(HTTP 헤더가 아니다, B1 무관).
      const url = URL.createObjectURL(new Blob(["\uFEFF", res.text], { type: "text/plain;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("동기화 보고서를 내려받았습니다");
    } catch {
      toast.error("동기화 보고서를 내려받지 못했습니다 — 잠시 뒤 다시 시도하세요");
    } finally {
      setDownloading(false);
    }
  }
  const report = status?.report ?? null;
  const reportTitle = report
    ? `가장 최근 동기화(${kstHhmm(report.finishedAt)}${report.ok ? "" : " · 도중에 멈춤"}) — 변동 ${report.changed}건 · 실패 ${report.failed}건 · 보류 ${report.held}건 · ` +
      `해제 확인이 필요한 원아 ${report.releaseNames}명(${report.releaseClasses}개 반).` +
      (report.dailyFailed || report.dailyStopped
        ? ` 가장 최근 전체 동기화: ${report.dailyStopped ? "도중에 멈춤 · " : ""}실패 ${report.dailyFailed}건.`
        : "") +
      " 무엇이 바뀌었고 무엇이 왜 안 됐는지 이유와 함께 txt로 받습니다."
    : "";
  // 사람이 봐야 할 것(실패·멈춤·직접 해제)이 있으면 버튼에 숫자를 붙인다 — 내려받기 전에도 '볼 것이 있다'가 보이게.
  // (바뀐 반만 본 '지금 동기화'가 맨 위여도 가장 최근 전체 동기화의 실패·멈춤을 함께 센다 — 새벽 실패가 가려지지 않게.)
  const reportAttention = report ? countReportAttention(report) : 0;

  let label = "지금 반 보드 동기화";
  let note: string | null = null;
  let noteTitle: string | null = null;
  let tone = "text-text-faint";
  let disabled = clicking;
  switch (view.kind) {
    case "pending":
      label = "요청됨 · 연동 PC 대기 중";
      note = `${view.since} 요청`;
      disabled = true;
      break;
    case "running":
      label = "동기화 중…";
      note = `${view.since} 시작`;
      disabled = true;
      break;
    case "cooldown":
      note = `${view.last} · ${view.leftMin}분 뒤 다시`;
      noteTitle = view.lastTitle;
      disabled = true;
      break;
    case "failed":
      label = view.leftMin > 0 ? label : "다시 동기화";
      note = view.leftMin > 0 ? `${view.reason} · ${view.leftMin}분 뒤 다시` : view.reason;
      noteTitle = view.raw;
      tone = "text-danger";
      disabled = disabled || view.leftMin > 0;
      break;
    case "offline":
      note = view.reason;
      disabled = true;
      break;
    case "idle":
      note = view.last;
      noteTitle = view.lastTitle;
      break;
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className ?? ""}`}>
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onClick} title={status?.autoSync ? EXPLAIN_AUTO : EXPLAIN} aria-busy={active || clicking}>
        <RefreshCw className={`size-3.5 shrink-0 ${view.kind === "running" ? "animate-spin" : ""}`} aria-hidden />
        {label}
      </Button>
      {report ? (
        <Button type="button" size="sm" variant="outline" disabled={downloading} onClick={onDownload} title={reportTitle} aria-busy={downloading}>
          <EyIcon name="download" size={14} aria-hidden />
          동기화 보고서 다운로드
          {reportAttention ? <span className="num text-amber font-bold">{reportAttention}</span> : null}
        </Button>
      ) : null}
      {note ? (
        <span className={`${tone} break-keep text-xs`} title={noteTitle ?? undefined}>
          {note}
        </span>
      ) : null}
    </div>
  );
}
