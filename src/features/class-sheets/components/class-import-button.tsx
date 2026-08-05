"use client";

// ECS 반 시트 화면의 "이 반만 시트에서 가져오기" — 랜딩의 전 반 순회와 **같은 서버 액션**(importEcsClassSheet)을
// 반 1개에만 쓴다. 순회가 아니라 1회라 진행률·페이스 조절이 필요 없다(구글 콜 ~5회).
// ⚠️ 시트 병행 운영 동안의 **임시 버튼**(원장 2026-07-30) — 시트를 접으면 랜딩 다이얼로그와 함께 지운다.
import { useState } from "react";
import { AlertTriangle, Loader2, Sheet, X } from "@/components/icons/eywa-icon-compat";
import {
  beginEcsImportRun,
  endEcsImportRun,
  importEcsClassSheet,
  listEcsImportTargetForClass,
} from "../server/import-actions";
import {
  ISSUE_HINT,
  ISSUE_LABEL,
  type EcsClassImportReport,
  type EcsImportIssueKind,
} from "../import/types";

type Phase = "idle" | "previewing" | "previewed" | "applying";

export function ClassSheetImportButton({
  classId,
  className,
  beforeApply,
}: {
  classId: string;
  className: string;
  /** 반영 직전 미저장 입력 flush — false면 중단(사용자가 취소). */
  beforeApply: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<{ spreadsheetId: string; year: number } | null>(null);
  const [report, setReport] = useState<EcsClassImportReport | null>(null);

  const busy = phase === "previewing" || phase === "applying";

  function close() {
    if (busy) return;
    setOpen(false);
    setPhase("idle");
    setError(null);
    setTarget(null);
    setReport(null);
  }

  async function preview() {
    setPhase("previewing");
    setError(null);
    setReport(null);
    // 리스 선점 — 전 반 순회·새벽 자동 반영과 같은 행을 잠근다(구글 읽기 할당량이 프로젝트 공유라
    // 동시에 돌면 서로를 429로 떨어뜨린다). 결과를 읽는 시간엔 놓는다.
    const lease = await beginEcsImportRun();
    if (!lease.ok) {
      setError(lease.error);
      setPhase("idle");
      return;
    }
    try {
      const found = await listEcsImportTargetForClass(classId);
      if (!found.ok) {
        setError(found.error);
        setPhase("idle");
        return;
      }
      setTarget({ spreadsheetId: found.target.spreadsheetId, year: found.year });
      const res = await importEcsClassSheet({
        classId,
        spreadsheetId: found.target.spreadsheetId,
        year: found.year,
        dryRun: true,
      });
      if (!res.ok) {
        setError(res.error);
        setPhase("idle");
        return;
      }
      setReport(res.report);
      setPhase("previewed");
    } finally {
      await endEcsImportRun();
    }
  }

  async function apply() {
    if (!target) return;
    if (!(await beforeApply())) return;
    setPhase("applying");
    const lease = await beginEcsImportRun();
    if (!lease.ok) {
      setError(lease.error);
      setPhase("previewed");
      return;
    }
    const res = await importEcsClassSheet({ classId, ...target, dryRun: false });
    await endEcsImportRun();
    if (!res.ok) {
      setError(res.error);
      setPhase("previewed");
      return;
    }
    // 🔴 router.refresh()로는 부족하다 — 이 화면의 계획 행은 SheetClient의 useState(초기값 전용)라
    //    서버 데이터만 갱신되면 화면은 옛 줄 그대로다(페이지 key가 안 바뀌어 재마운트도 안 된다).
    //    가져오기는 드물고 무거운 조작이라 통째 새로고침이 정직하다(저장 큐는 위에서 이미 flush했다).
    window.location.reload();
  }

  const counts = report?.counts;
  const issues = report?.issues ?? [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`'${className}' 반 시트만 구글 시트에서 가져옵니다`}
        className="border-line-strong text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition"
      >
        <Sheet className="size-3" /> 시트 가져오기
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={close} aria-hidden />
          <div
            className="bg-card border-line shadow-modal fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border p-5"
            role="dialog"
            aria-label="이 반 시트에서 가져오기"
          >
            <header className="flex items-center justify-between">
              <h2 className="text-foreground truncate text-[15px] font-bold">시트에서 가져오기 — {className}</h2>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                aria-label="닫기"
                className="text-text-dim hover:text-foreground cursor-pointer disabled:opacity-40"
              >
                <X className="size-4" />
              </button>
            </header>
            <p className="text-text-dim mt-1 text-[11px]">
              이 반의 구글 <b>수업계획서/출석부</b> 시트를 읽어 수업계획·목표·학생 기록을 채웁니다.{" "}
              <b>시트에 남아 있는 주차 전체</b>가 들어옵니다(지금 보는 주만이 아닙니다).
            </p>
            <p className="text-text-faint mt-1 flex items-start gap-1 text-[11px]">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                <b>출석 체크는 가져오지 않습니다.</b> 시트가 채운 교시는 시트 내용으로 <b>교체</b>되니, 그 교시를
                eywa에서 직접 고쳤다면 시트 내용으로 덮입니다.
              </span>
            </p>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void preview()}
                disabled={busy}
                className="bg-foreground text-background inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? <Loader2 className="size-3 animate-spin" /> : <Sheet className="size-3" />}
                {phase === "idle" ? "불러오기" : "다시 불러오기"}
              </button>
              {phase === "previewing" ? <span className="text-text-dim text-[11px]">시트를 읽는 중…</span> : null}
              {phase === "applying" ? <span className="text-text-dim text-[11px]">반영하는 중…</span> : null}
            </div>

            {error ? <p className="text-chart-4 mt-3 text-[12px]">{error}</p> : null}

            {report ? (
              <div className="mt-4 flex-1 space-y-3 overflow-auto pr-1 text-[12px]">
                <section className="bg-bg-soft rounded-lg px-3 py-2">
                  <p className="text-foreground text-[12px] font-bold">
                    주차 {report.weeks.filter((w) => !w.skipped).length}개
                  </p>
                  <p className="text-text-dim mt-1">
                    수업계획 <b className="num text-foreground">{counts?.planLines ?? 0}</b>줄 · 목표{" "}
                    <b className="num text-foreground">{counts?.goals ?? 0}</b>건 · 학생 기록{" "}
                    <b className="num text-foreground">{counts?.marks ?? 0}</b>건
                  </p>
                </section>

                {issues.length > 0 ? (
                  <section>
                    <h3 className="text-foreground mb-1 text-[12px] font-bold">확인이 필요한 것</h3>
                    <div className="space-y-2">
                      {(Object.keys(ISSUE_LABEL) as EcsImportIssueKind[])
                        .map((kind) => ({ kind, rows: issues.filter((i) => i.kind === kind) }))
                        .filter((g) => g.rows.length > 0)
                        .map((g) => (
                          <div key={g.kind} className="border-line rounded-lg border px-3 py-2">
                            <p className="text-foreground text-[12px] font-medium">
                              {ISSUE_LABEL[g.kind]}{" "}
                              <span className="text-text-faint num font-normal">
                                {g.rows.reduce((a, r) => a + r.count, 0)}건
                              </span>
                            </p>
                            <p className="text-text-faint mt-0.5 text-[11px]">{ISSUE_HINT[g.kind]}</p>
                            <ul className="text-text-dim mt-1 max-h-28 space-y-0.5 overflow-auto text-[11px]">
                              {g.rows.slice(0, 20).map((r) => (
                                <li key={r.detail}>
                                  · {r.detail}
                                  {r.count > 1 ? ` ×${r.count}` : ""}
                                </li>
                              ))}
                              {g.rows.length > 20 ? <li>… 외 {g.rows.length - 20}종</li> : null}
                            </ul>
                          </div>
                        ))}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}

            {phase === "previewed" ? (
              <footer className="border-line mt-4 flex items-center justify-end gap-2 border-t pt-3">
                <button
                  type="button"
                  onClick={close}
                  className="text-text-dim hover:text-foreground cursor-pointer px-3 py-1.5 text-xs"
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={() => void apply()}
                  disabled={(counts?.planLines ?? 0) + (counts?.goals ?? 0) + (counts?.marks ?? 0) === 0}
                  className="bg-primary text-primary-foreground cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
                >
                  이 반에 반영
                </button>
              </footer>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
