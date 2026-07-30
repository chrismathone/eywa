"use client";

// ECS "시트에서 가져오기" — 마스터 시트에 링크된 반별 수업계획서/출석부를 eywa로 당긴다.
// ⚠️ 시트 병행 운영 동안의 **임시 버튼**(원장 2026-07-30). 시트를 접으면 이 컴포넌트와 액션을 함께 지운다.
//
// 반복을 **여기서** 한 반씩 도는 이유: 구글 Sheets 읽기 할당량이 분당 60회라(실측 429) 서버에서 28반을
// 한 번에 훑으면 초과한다. 반마다 2콜이라 사이에 쉼을 두고 진행률을 보여준다.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Sheet, X } from "@/components/icons/eywa-icon-compat";
import {
  beginEcsImportRun,
  endEcsImportRun,
  importEcsClassSheet,
  isEcsImportBusy,
  listEcsImportTargets,
} from "@/features/class-sheets/server/import-actions";
import {
  ISSUE_HINT,
  ISSUE_LABEL,
  type EcsClassImportReport,
  type EcsImportIssue,
  type EcsImportIssueKind,
  type EcsSheetTarget,
} from "@/features/class-sheets/import/types";

/** 반 사이 간격 — 분당 60콜(반당 2콜) 한도 아래로 유지. */
const PACE_MS = 700;

type Phase = "idle" | "listing" | "previewing" | "previewed" | "applying" | "applied";

function mergeIssues(reports: EcsClassImportReport[]): EcsImportIssue[] {
  const out: EcsImportIssue[] = [];
  for (const r of reports)
    for (const i of r.issues) {
      const hit = out.find((x) => x.kind === i.kind && x.detail === i.detail);
      if (hit) hit.count += i.count;
      else out.push({ ...i });
    }
  return out;
}

function totals(reports: EcsClassImportReport[]) {
  return reports.reduce(
    (a, r) => ({
      planLines: a.planLines + r.counts.planLines,
      goals: a.goals + r.counts.goals,
      marks: a.marks + r.counts.marks,
      weeks: a.weeks + r.weeks.filter((w) => !w.skipped).length,
    }),
    { planLines: 0, goals: 0, marks: 0, weeks: 0 },
  );
}

export function EcsSheetImportDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [targets, setTargets] = useState<EcsSheetTarget[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [reports, setReports] = useState<EcsClassImportReport[]>([]);
  const [done, setDone] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);
  /** 다른 관리자(또는 새벽 자동 반영)가 시트를 잡고 있는가 — 서버 리스를 폴링해 선제 비활성. */
  const [othersBusy, setOthersBusy] = useState(false);
  const cancelRef = useRef(false);
  const runningRef = useRef(false);

  function reset() {
    setPhase("idle");
    runningRef.current = false;
    setError(null);
    setTargets([]);
    setUnmatched([]);
    setReports([]);
    setDone(0);
    setCurrent(null);
    cancelRef.current = false;
  }
  /** 내가 순회 중이 아닐 때만 남의 점유를 확인한다(내 리스를 '남이 잡았다'고 오표시하지 않게). */
  const refreshBusy = useCallback(async () => {
    if (runningRef.current) return;
    setOthersBusy(await isEcsImportBusy());
  }, []);

  // 창이 열려 있는 동안만 폴링 — 15초. 창=iframe이라 다른 창/다른 사람의 실행도 여기서 잡힌다.
  useEffect(() => {
    if (!open) return;
    void refreshBusy();
    const id = setInterval(() => void refreshBusy(), 15_000);
    return () => clearInterval(id);
  }, [open, refreshBusy]);

  // 순회 중 창이 닫히거나 페이지를 떠나도 리스를 놓는다(실패해도 3분 stale로 자가 회복).
  useEffect(
    () => () => {
      if (runningRef.current) {
        runningRef.current = false;
        void endEcsImportRun();
      }
    },
    [],
  );

  function close() {
    cancelRef.current = true;
    if (runningRef.current) {
      runningRef.current = false;
      void endEcsImportRun();
    }
    setOpen(false);
    reset();
  }

  async function runAll(list: EcsSheetTarget[], yr: number, dryRun: boolean) {
    const acc: EcsClassImportReport[] = [];
    setDone(0);
    for (const t of list) {
      if (cancelRef.current) break;
      if (!t.classId) continue;
      setCurrent(t.className);
      const res = await importEcsClassSheet({
        classId: t.classId,
        spreadsheetId: t.spreadsheetId,
        year: yr,
        dryRun,
      });
      if (!res.ok) {
        // 한 반이 실패해도 나머지는 계속 — 실패 사유는 이슈로 남겨 화면에 보인다.
        acc.push({
          classId: t.classId,
          className: t.className ?? t.sheetLabel,
          spreadsheetId: t.spreadsheetId,
          weeks: [],
          counts: { planLines: 0, goals: 0, marks: 0 },
          written: null,
          issues: [{ kind: "save-failed", detail: `${t.className} — ${res.error}`, count: 1 }],
        });
      } else {
        acc.push(res.report);
      }
      setDone((n) => n + 1);
      setReports([...acc]);
      await new Promise((r) => setTimeout(r, PACE_MS));
    }
    setCurrent(null);
    return acc;
  }

  async function startPreview() {
    reset();
    setPhase("listing");
    // 리스 선점 — 두 사람이 동시에 돌면 같은 구글 할당량을 나눠 쓰다 서로를 429로 떨어뜨린다.
    const lease = await beginEcsImportRun();
    if (!lease.ok) {
      setError(lease.error);
      setOthersBusy(true);
      setPhase("idle");
      return;
    }
    runningRef.current = true;
    setOthersBusy(false);
    const listed = await listEcsImportTargets();
    if (!listed.ok) {
      setError(listed.error);
      setPhase("idle");
      runningRef.current = false;
      await endEcsImportRun();
      return;
    }
    setYear(listed.year);
    setTargets(listed.targets);
    setUnmatched(listed.unmatched);
    if (listed.targets.length === 0) {
      setError("마스터 시트에서 eywa 반과 이름이 맞는 반 시트를 찾지 못했습니다.");
      setPhase("idle");
      runningRef.current = false;
      await endEcsImportRun();
      return;
    }
    setPhase("previewing");
    await runAll(listed.targets, listed.year, true);
    setPhase("previewed");
    // 결과를 읽는 시간엔 API를 안 쓰므로 리스를 놓는다 — 남을 필요 이상으로 막지 않는다.
    runningRef.current = false;
    await endEcsImportRun();
  }

  async function apply() {
    if (year == null) return;
    setPhase("applying");
    // 반영도 별도 회차 — 미리보기 이후 남이 먼저 잡았으면 여기서 멈춘다(겹쳐 쓰지 않는다).
    const lease = await beginEcsImportRun();
    if (!lease.ok) {
      setError(lease.error);
      setOthersBusy(true);
      setPhase("previewed");
      return;
    }
    runningRef.current = true;
    setOthersBusy(false);
    await runAll(targets, year, false);
    setPhase("applied");
    runningRef.current = false;
    await endEcsImportRun();
    router.refresh();
  }

  const t = totals(reports);
  const issues = mergeIssues(reports);
  const busy = phase === "listing" || phase === "previewing" || phase === "applying";
  const written = reports.reduce(
    (a, r) => ({
      planLines: a.planLines + (r.written?.planLines ?? 0),
      goals: a.goals + (r.written?.goals ?? 0),
      marks: a.marks + (r.written?.marks ?? 0),
    }),
    { planLines: 0, goals: 0, marks: 0 },
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition"
      >
        <Sheet className="size-3.5" /> 시트에서 가져오기
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={busy ? undefined : close} aria-hidden />
          <div
            className="bg-card border-line shadow-modal fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border p-5"
            role="dialog"
            aria-label="ECS 시트에서 가져오기"
          >
            <header className="flex items-center justify-between">
              <h2 className="text-foreground text-[15px] font-bold">시트에서 가져오기</h2>
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
              원장님 마스터 시트에 연결된 <b>반별 수업계획서/출석부</b>를 읽어 수업계획·목표·학생 기록을 채웁니다.
              시트에 남아 있는 주차만 들어옵니다.
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
                onClick={startPreview}
                disabled={busy || othersBusy}
                title={othersBusy ? "다른 관리자가 시트를 작업 중입니다" : undefined}
                className="bg-foreground text-background inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? <Loader2 className="size-3 animate-spin" /> : <Sheet className="size-3" />}
                {phase === "idle" ? "불러오기" : "다시 불러오기"}
              </button>
              {othersBusy && !busy ? (
                <span className="text-text-dim text-[11px]">
                  다른 관리자가 시트를 작업 중입니다 — 끝나면 자동으로 다시 눌릴 수 있게 됩니다.
                </span>
              ) : null}
              {busy && targets.length > 0 ? (
                <span className="text-text-dim text-[11px]">
                  {done}/{targets.length} {current ? `· ${current}` : ""}
                </span>
              ) : null}
              {phase === "listing" ? <span className="text-text-dim text-[11px]">반 시트 목록을 읽는 중…</span> : null}
            </div>

            {error ? <p className="text-chart-4 mt-3 text-[12px]">{error}</p> : null}

            {reports.length > 0 ? (
              <div className="mt-4 flex-1 space-y-4 overflow-auto pr-1 text-[12px]">
                <section className="bg-bg-soft rounded-lg px-3 py-2">
                  <p className="text-foreground text-[12px] font-bold">
                    반 {reports.length}개 · 주차 {t.weeks}개
                  </p>
                  <p className="text-text-dim mt-1">
                    수업계획 <b className="num text-foreground">{t.planLines}</b>줄 · 목표{" "}
                    <b className="num text-foreground">{t.goals}</b>건 · 학생 기록{" "}
                    <b className="num text-foreground">{t.marks}</b>건
                  </p>
                  {phase === "applied" ? (
                    <p className="text-primary mt-1 font-medium">
                      반영 완료 — 수업계획 {written.planLines} · 목표 {written.goals} · 학생 기록 {written.marks}
                    </p>
                  ) : null}
                </section>

                {unmatched.length > 0 ? (
                  <section>
                    <h3 className="text-foreground mb-1 text-[12px] font-bold">
                      eywa 반과 못 맞춘 시트 <span className="text-text-faint font-normal">{unmatched.length}건</span>
                    </h3>
                    <p className="text-text-faint mb-1 text-[11px]">
                      반 이름이 정확히 같아야 들어옵니다. 반을 새로 만들지는 않습니다.
                    </p>
                    <ul className="text-text-dim space-y-0.5">
                      {unmatched.map((u) => (
                        <li key={u}>· {u}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

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
                            <ul className="text-text-dim mt-1 max-h-32 space-y-0.5 overflow-auto text-[11px]">
                              {g.rows.slice(0, 40).map((r) => (
                                <li key={r.detail}>
                                  · {r.detail}
                                  {r.count > 1 ? ` ×${r.count}` : ""}
                                </li>
                              ))}
                              {g.rows.length > 40 ? <li>… 외 {g.rows.length - 40}종</li> : null}
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
                  onClick={apply}
                  disabled={t.planLines + t.goals + t.marks === 0 || othersBusy}
                  title={othersBusy ? "다른 관리자가 시트를 작업 중입니다" : undefined}
                  className="bg-primary text-primary-foreground cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
                >
                  eywa에 반영
                </button>
              </footer>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
