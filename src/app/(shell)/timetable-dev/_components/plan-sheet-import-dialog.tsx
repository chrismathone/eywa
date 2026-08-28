"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, Sheet, X } from "@/components/icons/eywa-icon-compat";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { addMonths, planMonthLabel } from "@/features/timetable-dev/types";
import type { PlanSheetImportPlan, SheetTab } from "@/features/timetable-dev/lib/sheet-plan";
import {
  applyPlanSheetImport,
  listPlanImportTabs,
  previewPlanSheetImport,
} from "@/features/timetable-dev/server/sheet-import-actions";

/**
 * 시트 탭 하나를 **그 달 계획**으로 가져오는 다이얼로그(시간표(개발중) 전용).
 *
 * 🔴 이 화면은 `timetable_plan_slots`(0231a)에만 쓴다 — 실제 시간표(`class_schedules`)는 한 행도 안 바뀐다.
 *    그 사실을 화면에도 적어 둔다(원장이 누르기 전에 알아야 하는 유일한 것).
 * ⚠️ 부모는 **조건부 마운트**로 쓸 것 — 항상 마운트한 채 open만 false로 만들면 close()의 상태 리셋을
 *    우회해 지난 미리보기·결과가 다음 열기에 남는다([[#67]]).
 * ⚠️ 에러는 한글 요약만 보여주고 기술 원문은 `title` 툴팁으로만(UI에 raw 에러 원문 노출 금지 규약).
 */
const BTN =
  "border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-50";
const FIELD = "border-line bg-card text-foreground w-full rounded-lg border px-2 py-1.5 text-xs";
const KO_DAY: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

type Msg = { text: string; detail?: string };

export function PlanSheetImportDialog({
  month,
  canManage,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  /** 지금 보고 있는 계획 달(YYYY-MM) — 가져올 달의 기본값. */
  month: string;
  /** 계획 쓰기 권한. 없으면 아무 것도 그리지 않는다(서버 액션도 같은 게이트로 막힌다 — #77). */
  canManage: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v);
    onOpenChange?.(v);
  };

  const [url, setUrl] = useState("");
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [tabName, setTabName] = useState("");
  const [target, setTarget] = useState(month);
  const [replace, setReplace] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanSheetImportPlan | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [loadingTabs, startTabs] = useTransition();
  const [previewing, startPreview] = useTransition();
  const [applying, startApply] = useTransition();

  // 열릴 때 연동 설정의 시트 탭을 먼저 채워 둔다(주소를 붙여넣으면 그게 이긴다).
  useEffect(() => {
    if (!open) return;
    void listPlanImportTabs()
      .then((res) => {
        setEmail(res.serviceAccountEmail);
        if (res.ok) {
          setTabs(res.tabs);
          setTabName((cur) => cur || res.tabName || "");
        }
      })
      .catch(() => {
        /* 기본 시트가 없는 건 정상 — 사람이 주소를 붙여넣으면 된다 */
      });
  }, [open]);

  const monthOptions = useMemo(
    () => [-1, 0, 1, 2, 3].map((n) => addMonths(month, n)).map((m) => ({ value: m, label: planMonthLabel(m) })),
    [month],
  );
  const tabOptions = useMemo(() => tabs.map((t) => ({ value: t.title, label: t.title })), [tabs]);

  if (!canManage) return null;

  const clearResult = () => {
    setPlan(null);
    setApplied(null);
    setMsg(null);
  };
  const close = () => {
    setOpen(false);
    clearResult();
  };

  /** 주소의 문서에서 탭 목록을 다시 읽는다(주소를 바꿔 붙여넣었을 때). */
  const loadTabs = () => {
    clearResult();
    startTabs(async () => {
      const res = await listPlanImportTabs(url.trim() || undefined);
      setEmail(res.serviceAccountEmail);
      if (!res.ok) {
        setTabs([]);
        setMsg({ text: res.error, detail: res.detail });
        return;
      }
      setTabs(res.tabs);
      setTabName(res.tabName || res.tabs[0]?.title || "");
    });
  };

  const preview = () => {
    clearResult();
    startPreview(async () => {
      const res = await previewPlanSheetImport({ month: target, source: url.trim() || undefined, tabName });
      setEmail(res.serviceAccountEmail);
      if (!res.ok) {
        setMsg({ text: res.error, detail: res.detail });
        return;
      }
      setPlan(res.plan);
    });
  };

  const apply = () => {
    if (!plan) return;
    if (
      replace &&
      !window.confirm(
        `${planMonthLabel(target)} 계획을 통째로 지우고 '${tabName}' 탭 내용으로 다시 채웁니다.\n손으로 고쳐 둔 칸도 사라지며 되돌릴 수 없습니다. 계속할까요?`,
      )
    )
      return;
    setMsg(null);
    startApply(async () => {
      const res = await applyPlanSheetImport({
        month: target,
        source: url.trim() || undefined,
        tabName,
        mode: replace ? "replace" : "merge",
        expectedHash: plan.hash,
      });
      if (!res.ok) {
        setMsg({ text: res.error, detail: res.detail });
        if (res.stale) setPlan(null);
        return;
      }
      const a = res.applied;
      setApplied(
        `${planMonthLabel(res.month)} 계획에 반영했습니다 — 추가 ${a.added} · 변경 ${a.updated} · 그대로 ${a.kept}` +
          (a.removed ? ` · 지움 ${a.removed}` : "") +
          (a.skipped ? ` · 제외 ${a.skipped}` : ""),
      );
      setPlan(null);
      router.refresh();
    });
  };

  const changes = plan ? plan.counts.add + plan.counts.update : 0;
  const busy = loadingTabs || previewing || applying;

  return (
    <>
      {hideTrigger ? null : (
        <button type="button" onClick={() => setOpen(true)} className={BTN} title="구글 시트 탭 하나를 그 달 계획으로 가져옵니다">
          <Sheet size={11} strokeWidth={1.8} />
          시트에서 가져오기
        </button>
      )}

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={close} aria-hidden />
          <div
            className="bg-card border-line shadow-modal fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border p-5"
            role="dialog"
            aria-label="시트에서 계획 가져오기"
          >
            <header className="flex items-center justify-between">
              <h2 className="text-foreground text-[15px] font-bold">시트에서 계획 가져오기</h2>
              <button type="button" onClick={close} aria-label="닫기" className="text-text-dim hover:text-foreground">
                <X className="size-4" />
              </button>
            </header>
            <p className="text-text-dim mt-1 text-[11px] break-keep">
              구글 시트에서 <b>그 탭 주소를 통째로 복사</b>해 붙여넣으면 그 탭의 배치를 <b>고른 달의 계획</b>으로 가져옵니다.
              실제 시간표(출결·급여가 보는 표)는 <b>바뀌지 않습니다</b>.
            </p>
            {email ? (
              <p className="text-text-faint mt-1 flex items-start gap-1 text-[11px] break-keep">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  처음 쓰는 시트라면 <b className="text-text-dim break-all">{email}</b> 계정에 <b>보기 권한</b>으로 공유한 뒤 다시 시도하세요.
                </span>
              </p>
            ) : null}

            <div className="mt-3 space-y-2">
              <div className="flex items-end gap-2">
                <label className="flex-1">
                  <span className="text-text-faint text-[11px]">시트 주소</span>
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/…/edit?gid=…"
                    className={FIELD}
                  />
                </label>
                <button type="button" onClick={loadTabs} disabled={busy} className={`${BTN} py-1.5`}>
                  {loadingTabs ? <Loader2 size={11} strokeWidth={1.8} className="animate-spin" /> : <Sheet size={11} strokeWidth={1.8} />}
                  탭 불러오기
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-text-faint text-[11px]">가져올 탭</span>
                  <SearchableSelect
                    options={tabOptions}
                    value={tabName}
                    onValueChange={(v) => {
                      setTabName(v);
                      clearResult();
                    }}
                    ariaLabel="가져올 시트 탭"
                    placeholder={tabs.length ? "탭 선택..." : "먼저 탭을 불러오세요"}
                    triggerClassName="border-line bg-card text-foreground rounded-lg border px-2 py-1.5 text-xs"
                  />
                </label>
                <label className="block">
                  <span className="text-text-faint text-[11px]">계획을 담을 달</span>
                  <SearchableSelect
                    options={monthOptions}
                    value={target}
                    onValueChange={(v) => {
                      setTarget(v);
                      clearResult();
                    }}
                    ariaLabel="계획을 담을 달"
                    triggerClassName="border-line bg-card text-foreground rounded-lg border px-2 py-1.5 text-xs"
                  />
                </label>
              </div>
              <label className="text-text-dim flex items-start gap-1.5 text-[11px] break-keep">
                <input type="checkbox" checked={replace} onChange={(e) => { setReplace(e.target.checked); }} className="mt-0.5" />
                <span>
                  이 달 계획을 <b>통째로 교체</b>합니다(시트에 없는 칸은 지움). 꺼두면 시트에 있는 칸만 더하거나 고치고 나머지는 그대로 둡니다.
                </span>
              </label>
              <button
                type="button"
                onClick={preview}
                disabled={busy || !tabName}
                className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition disabled:opacity-40"
                title={tabName ? undefined : "가져올 탭을 먼저 고르세요"}
              >
                {previewing ? <Loader2 className="size-3 animate-spin" /> : <Sheet className="size-3" />}
                미리보기
              </button>
            </div>

            {msg ? (
              <p className="text-danger mt-3 text-[12px] break-keep" title={msg.detail}>
                {msg.text}
              </p>
            ) : null}
            {applied ? (
              <p className="bg-green-soft text-green mt-3 flex items-start gap-1 rounded-lg p-2 text-[12px] break-keep">
                <Check size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                {applied}
              </p>
            ) : null}

            {plan ? (
              <div className="mt-4 flex-1 space-y-3 overflow-auto pr-1 text-[12px]">
                <div className="num flex flex-wrap gap-3">
                  <span className="text-blue">추가 {plan.counts.add}</span>
                  <span className="text-primary">변경 {plan.counts.update}</span>
                  <span className="text-text-faint">그대로 {plan.counts.keep}</span>
                  <span className="text-amber">시트에 없음 {plan.counts.orphan}</span>
                  {plan.counts.skipped ? <span className="text-danger">제외 {plan.counts.skipped}</span> : null}
                </div>

                {changes > 0 ? (
                  <div className="border-line divide-line max-h-44 divide-y overflow-auto rounded-lg border">
                    {plan.rows
                      .filter((r) => r.action !== "keep")
                      .map((r, i) => (
                        <p key={i} className="text-text-dim px-2 py-1 break-keep">
                          <span className={r.action === "add" ? "text-blue" : "text-primary"}>
                            {r.action === "add" ? "+" : "↻"}
                          </span>{" "}
                          <b className="text-foreground">{r.className}</b> {KO_DAY[r.input.dayOfWeek] ?? r.input.dayOfWeek}{" "}
                          {r.input.startTime}~{r.input.endTime}
                          {r.input.slotTeacherLabel ? ` · ${r.input.slotTeacherLabel}` : ""}
                          {r.input.slotRoomLabel ? ` · ${r.input.slotRoomLabel}` : ""}
                          {r.before ? (
                            <span className="text-text-faint">
                              {" "}
                              (이전 {r.before.endTime}
                              {r.before.teacherLabel ? ` · ${r.before.teacherLabel}` : ""}
                              {r.before.roomLabel ? ` · ${r.before.roomLabel}` : ""})
                            </span>
                          ) : null}
                        </p>
                      ))}
                  </div>
                ) : (
                  <p className="bg-bg-soft text-text-dim rounded-lg p-2 text-[11px]">
                    더하거나 고칠 칸이 없습니다 — 시트와 계획이 이미 같습니다.
                  </p>
                )}

                {plan.counts.orphan > 0 ? (
                  <p className="text-text-faint text-[11px] break-keep">
                    시트에 없는 계획 칸 {plan.counts.orphan}개
                    {replace ? " — 통째 교체라 지워집니다." : " — 그대로 둡니다(통째 교체를 켜면 지워집니다)."}
                  </p>
                ) : null}

                {plan.skipped.length > 0 ? (
                  <div className="bg-danger-soft text-danger rounded-lg p-2 text-[11px]">
                    <p className="mb-1 font-bold">계획에 담지 못한 칸 {plan.counts.skipped}개</p>
                    <div className="max-h-20 space-y-0.5 overflow-auto">
                      {plan.skipped.slice(0, 20).map((s, i) => (
                        <p key={i} className="break-keep">
                          · {s.className} {s.count > 1 ? `(${s.count}칸)` : ""} — {s.reason}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}

                {plan.warnings.length > 0 ? (
                  <div className="bg-amber-soft text-amber rounded-lg p-2 text-[11px]">
                    <p className="mb-1 flex items-center gap-1 font-bold">
                      <AlertTriangle className="size-3" /> 확인 필요 {plan.warnings.length}건
                    </p>
                    <div className="max-h-20 space-y-0.5 overflow-auto">
                      {plan.warnings.slice(0, 20).map((w, i) => (
                        <p key={i} className="break-keep">
                          · {w}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}

                {changes > 0 || (replace && plan.counts.orphan > 0) ? (
                  <button
                    type="button"
                    onClick={apply}
                    disabled={applying}
                    className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-bold transition disabled:opacity-40"
                  >
                    {applying ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                    {planMonthLabel(target)} 계획에 적용
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
