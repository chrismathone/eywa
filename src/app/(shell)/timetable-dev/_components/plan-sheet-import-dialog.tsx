"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
 * 🔴 이 화면은 `timetable_plan_slots`(0232a)에만 쓴다 — 실제 시간표(`class_schedules`)는 한 행도 안 바뀐다.
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
  triggerLabel = "시트에서 가져오기",
}: {
  /** 지금 보고 있는 계획 달(YYYY-MM) — 가져올 달의 기본값. */
  month: string;
  /** 계획 쓰기 권한. 없으면 아무 것도 그리지 않는다(서버 액션도 같은 게이트로 막힌다 — #77). */
  canManage: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  /** 트리거 글자 — '다음 달 만들기'처럼 같은 다이얼로그를 다른 뜻으로 열 때(대상 달만 다름). */
  triggerLabel?: string;
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

  /**
   * 🔴 주소를 붙여넣으면 **자동으로** 탭을 다시 읽는다(원장 제보 2026-08-31:
   * *"다음달 만들기해도 똑같은 그냥 기존 시트만 계속 가져와지지"*).
   *
   * 종전엔 열자마자 **연동 시트(기존 시간표 시트)**의 탭이 채워지고 탭까지 미리 골라져 있었고,
   * 주소를 붙여넣어도 '탭 불러오기'를 따로 누르지 않으면 목록이 그대로였다. 그 상태로 미리보기를
   * 누르면 **기존 시트가 그대로** 들어온다 — 새 달 자료를 넣으러 온 사람이 옛 시간표를 복제하게 된다.
   * 사람이 눌러야만 반영되는 단계는 결국 안 눌린다 → 값이 바뀌면 코드가 따라가게 한다.
   */
  const lastLoadedRef = useRef<string>("");
  useEffect(() => {
    if (!open) return;
    const key = url.trim();
    if (key === lastLoadedRef.current) return;
    const t = setTimeout(() => {
      lastLoadedRef.current = key;
      loadTabs();
    }, 500); // 붙여넣기 중간 상태로 매 글자 조회하지 않게
    return () => clearTimeout(t);
    // loadTabs는 매 렌더 새로 만들어지므로 의존성에 넣지 않는다(넣으면 무한 재조회).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, open]);

  // 🔴 조기 반환은 **모든 훅 아래**에 둔다 — 위로 올리면 권한 없는 렌더에서 훅 개수가 달라져
  //    rules-of-hooks 위반이다(권한 없으면 트리거를 안 그린다는 동작 자체는 그대로).
  if (!canManage) return null;

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
  /**
   * 적용 가능 여부와 **못 누르는 사유**를 한 곳에서 만든다 — 비활성 버튼은 이유를 말해야 쓸모가 있다.
   * 통째 교체가 켜져 있으면 '시트에 없는 칸을 지우는 것'만으로도 할 일이 있으므로 orphan도 센다.
   */
  const applyBlockedReason = !plan
    ? "먼저 미리보기를 눌러 무엇이 들어오는지 확인하세요"
    : changes === 0 && !(replace && plan.counts.orphan > 0)
      ? "시트 내용이 지금 계획과 같습니다 — 바뀔 것이 없습니다"
      : null;
  const canApply = !applyBlockedReason;
  const busy = loadingTabs || previewing || applying;

  return (
    <>
      {hideTrigger ? null : (
        <button type="button" onClick={() => setOpen(true)} className={BTN} title="구글 시트 탭 하나를 그 달 계획으로 가져옵니다">
          <Sheet size={11} strokeWidth={1.8} />
          {triggerLabel}
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
              <h2 className="text-foreground text-base font-bold">시트에서 계획 가져오기</h2>
              <button type="button" onClick={close} aria-label="닫기" className="text-text-dim hover:text-foreground">
                <X className="size-4" />
              </button>
            </header>
            <p className="text-text-dim mt-1 text-xs break-keep">
              구글 시트에서 <b>그 탭 주소를 통째로 복사</b>해 붙여넣으면 그 탭의 배치를 <b>고른 달의 계획</b>으로 가져옵니다.
              실제 시간표(출결·급여가 보는 표)는 <b>바뀌지 않습니다</b>.
            </p>
            {email ? (
              <p className="text-text-faint mt-1 flex items-start gap-1 text-xs break-keep">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  처음 쓰는 시트라면 <b className="text-text-dim break-all">{email}</b> 계정에 <b>보기 권한</b>으로 공유한 뒤 다시 시도하세요.
                </span>
              </p>
            ) : null}

            <div className="mt-3 space-y-2">
              {/* 🔴 출처를 눈에 보이게 — 이게 없으면 "무엇이 들어오는지 모른 채" 적용하게 된다.
                  주소가 비어 있으면 **기존 연동 시트**를 읽는다는 사실을 그 자리에서 말한다. */}
              <p
                className={`rounded-lg border px-2 py-1.5 text-xs break-keep ${
                  url.trim()
                    ? "border-primary/30 bg-primary-soft text-foreground"
                    : "border-amber/30 bg-amber-soft text-foreground"
                }`}
              >
                {url.trim() ? (
                  <>
                    <b>붙여넣은 시트</b>에서 가져옵니다 — 아래 탭 목록도 그 문서의 것입니다.
                  </>
                ) : (
                  <>
                    지금은 <b>기존 연동 시트</b>(본 시간표가 쓰는 문서)에서 가져옵니다. 9월·10월처럼{" "}
                    <b>새 자료</b>를 넣으려면 그 시트 주소를 아래에 붙여넣으세요.
                  </>
                )}
              </p>
              <div className="flex items-end gap-2">
                <label className="flex-1">
                  <span className="text-text-faint text-xs">시트 주소</span>
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/…/edit?gid=…"
                    className={FIELD}
                  />
                </label>
                {/* 자동 조회가 기본이고, 이 버튼은 실패했을 때의 수동 재시도다(공유 권한을 그 사이에 준 경우). */}
                <button type="button" onClick={loadTabs} disabled={busy} className={`${BTN} py-1.5`} title="자동으로 읽지 못했을 때 다시 시도">
                  {loadingTabs ? <Loader2 size={11} strokeWidth={1.8} className="animate-spin" /> : <Sheet size={11} strokeWidth={1.8} />}
                  다시 읽기
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-text-faint text-xs">가져올 탭</span>
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
                  <span className="text-text-faint text-xs">계획을 담을 달</span>
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
              <label className="text-text-dim flex items-start gap-1.5 text-xs break-keep">
                <input type="checkbox" checked={replace} onChange={(e) => { setReplace(e.target.checked); }} className="mt-0.5" />
                <span>
                  이 달 계획을 <b>통째로 교체</b>합니다(시트에 없는 칸은 지움). 꺼두면 시트에 있는 칸만 더하거나 고치고 나머지는 그대로 둡니다.
                </span>
              </label>
              {/* 🔴 두 단계를 **둘 다 보이게** 둔다(원장 제보 2026-08-31: *"서브밋 할수있는 방법이 없는데"*).
                  종전엔 '적용'이 미리보기 성공 뒤에야, 그것도 변경분이 있을 때만 렌더돼서 — 미리보기를
                  누르기 전에는 제출 수단이 **아예 없는 화면**으로 보였고, 변경분이 0이면 끝내 안 나타났다.
                  버튼을 감추는 대신 **왜 못 누르는지 말하는 비활성 버튼**으로 둔다. */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={preview}
                  disabled={busy || !tabName}
                  className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition disabled:opacity-40"
                  title={tabName ? undefined : "가져올 탭을 먼저 고르세요"}
                >
                  {previewing ? <Loader2 className="size-3 animate-spin" /> : <Sheet className="size-3" />}
                  ① 미리보기
                </button>
                <button
                  type="button"
                  onClick={apply}
                  disabled={busy || !canApply}
                  className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold transition disabled:opacity-40"
                  title={applyBlockedReason ?? `${planMonthLabel(target)} 계획에 적용합니다`}
                >
                  {applying ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                  ② 적용
                </button>
                {applyBlockedReason ? (
                  <span className="text-text-faint text-xs break-keep">{applyBlockedReason}</span>
                ) : null}
              </div>
            </div>

            {msg ? (
              <p className="text-danger mt-3 text-xs break-keep" title={msg.detail}>
                {msg.text}
              </p>
            ) : null}
            {applied ? (
              <p className="bg-green-soft text-green mt-3 flex items-start gap-1 rounded-lg p-2 text-xs break-keep">
                <Check size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                {applied}
              </p>
            ) : null}

            {plan ? (
              <div className="mt-4 flex-1 space-y-3 overflow-auto pr-1 text-xs">
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
                  <p className="bg-bg-soft text-text-dim rounded-lg p-2 text-xs">
                    더하거나 고칠 칸이 없습니다 — 시트와 계획이 이미 같습니다.
                  </p>
                )}

                {plan.counts.orphan > 0 ? (
                  <p className="text-text-faint text-xs break-keep">
                    시트에 없는 계획 칸 {plan.counts.orphan}개
                    {replace ? " — 통째 교체라 지워집니다." : " — 그대로 둡니다(통째 교체를 켜면 지워집니다)."}
                  </p>
                ) : null}

                {plan.skipped.length > 0 ? (
                  <div className="bg-danger-soft text-danger rounded-lg p-2 text-xs">
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
                  <div className="bg-amber-soft text-amber rounded-lg p-2 text-xs">
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

                {/* 적용 버튼은 위 ①② 줄로 올렸다 — 미리보기 결과를 끝까지 스크롤해야 제출할 수 있으면
                    긴 목록에서 "제출 버튼이 없다"가 된다. */}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
