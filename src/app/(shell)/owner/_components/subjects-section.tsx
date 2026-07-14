"use client";

// 과목 운영 면 — 좌: 과목 목록(이름·색·요일병합) ┃ 우: 과목별 설정(접이식 — 평일 교시 전용표·강사뷰 가로줄/격자).
// 운영 체계 면과 **같은 operations 섹션**에 저장(face→section 매핑은 UI 레벨) — payload는 full
// operations(여기선 subjects만 편집, 나머지는 initial 통과). 동시편집 가드 scope도 동일해 두 면 커버.
// 과목별 편집기는 native <details>(기본 접힘 + 요약 배지) — 과목 수만큼 빈 풀폭 카드가 늘어지는 것 방지.
import { useEffect, useRef, useState } from "react";
import { Plus, X } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import {
  DEFAULT_TEACHER_VIEW_PX_PER_MIN,
  TEACHER_VIEW_STEPS,
  type BreakRangeSetting,
  type OperationsSettings,
  type SubjectSetting,
} from "@/features/owner/settings-types";
import { ENGLISH_WEEKDAY_PERIOD_LIST } from "@/features/timetable/lib/periods";
import {
  absorbSubject,
  getSubjectUsage,
  removeUnusedSubject,
  type SubjectUsage,
} from "@/features/owner/server/subject-actions";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SectionForm, SettingsCard } from "./section-form";
import { PeriodListEditor, SubjectListEditor } from "./list-editors";

const cellCls =
  "border-line text-foreground rounded-md border bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:border-primary";
const ghostBtnCls =
  "border-line text-text-dim hover:text-foreground hover:border-primary inline-flex items-center gap-1 rounded-md border border-dashed px-3 py-1.5 text-[12px]";
const badgeCls =
  "text-text-dim border-line rounded border px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap";

export function SubjectsSection({
  initial,
  teacherLabels = {},
}: {
  initial: OperationsSettings;
  /** 과목별 강사 라벨(강사뷰 '가로줄 제외 강사' 칩 선택지) — getTeacherLabelsBySubject. */
  teacherLabels?: Record<string, string[]>;
}) {
  const [o, setO] = useState<OperationsSettings>(initial);
  const setSubjects = (v: SubjectSetting[]) => setO((prev) => ({ ...prev, subjects: v }));
  const patchSubject = (i: number, patch: Partial<SubjectSetting>) =>
    setSubjects(o.subjects.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  // 삭제 = 흡수 다이얼로그(조건부 마운트 — 닫히면 언마운트로 state 리셋, #67 안전)
  const [removing, setRemoving] = useState<{ index: number; key: string; label: string } | null>(null);
  const removeRowLocal = (index: number) =>
    setO((prev) => ({ ...prev, subjects: prev.subjects.filter((_, j) => j !== index) }));
  // 흡수/미사용 삭제는 서버 즉시 확정 → SectionForm baseline 재스냅샷 신호(거짓 '미저장' 확인 방지).
  const [savedNonce, setSavedNonce] = useState(0);

  return (
    <SectionForm section="operations" payload={o} savedNonce={savedNonce}>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <SettingsCard
          title="운영 과목"
          description="과목명과 색만 정하면 됩니다. 색은 전 화면의 과목 배지·시간표·엑셀에 적용됩니다. 내부 ID는 데이터 보존용으로 자동 생성·고정(편집 불가). 삭제 시 그 과목의 데이터를 다른 과목에 흡수시킵니다."
        >
          <SubjectListEditor
            value={o.subjects}
            onChange={setSubjects}
            onRemove={(i) => {
              const s = o.subjects[i];
              setRemoving({ index: i, key: s.key, label: s.label.trim() || s.key });
            }}
          />
        </SettingsCard>

        <SettingsCard
          title="과목별 설정"
          description="과목을 펼쳐 그 과목에만 적용되는 평일 교시와 강사별시간표(강사뷰) 표시를 설정합니다."
        >
          <div className="divide-line divide-y">
            {o.subjects.map((s, i) => (
              <details key={s.key || `row-${i}`} className="group py-1">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded px-1 py-2 select-none [&::-webkit-details-marker]:hidden">
                  <EyIcon name="chevronRight" size={12} className="text-text-faint transition-transform group-open:rotate-90" />
                  <span className="text-foreground text-[13px] font-bold">{s.label.trim() || s.key}</span>
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    <span className={badgeCls}>
                      {s.weekdayPeriods?.length ? `전용 ${s.weekdayPeriods.length}교시` : "전역 교시"}
                    </span>
                    <span className={badgeCls}>
                      {s.teacherViewLines?.length
                        ? `강사뷰 가로줄 ${s.teacherViewLines.length} · ${s.teacherViewStep ?? 10}분`
                        : "강사뷰 미설정"}
                    </span>
                    {s.teacherViewBreaks?.length ? (
                      <span className={badgeCls}>쉬는 시간 {s.teacherViewBreaks.length}</span>
                    ) : null}
                    {s.teacherViewLineExcluded?.length ? (
                      <span className={badgeCls}>제외 강사 {s.teacherViewLineExcluded.length}</span>
                    ) : null}
                  </span>
                </summary>

                <div className="space-y-5 px-1 pt-1 pb-4">
                  {/* 수업 보고서 — 원스크린 일일·확인테스트 만점(문항 수). 기본 5. */}
                  <div className="space-y-2">
                    <h4 className="text-foreground text-[12px] font-bold">수업 보고서 · 테스트</h4>
                    <label className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="text-text-dim w-[90px] shrink-0">테스트 문항수</span>
                      <input
                        type="number"
                        className={`${cellCls} w-[90px]`}
                        min={1}
                        max={100}
                        step={1}
                        value={s.testMax ?? 5}
                        onChange={(e) =>
                          patchSubject(i, {
                            testMax: Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 5))),
                          })
                        }
                        aria-label={`${s.label.trim() || s.key} 테스트 문항수`}
                      />
                      <span className="text-text-faint text-[11px]">일일·확인테스트 만점(/N). 기본 5</span>
                    </label>
                  </div>

                  {/* 평일 교시(과목 전용) — 미설정이면 전역(운영 체계 탭) 폴백. 주말 교시는 전역 공통. */}
                  <div className="space-y-2">
                    <h4 className="text-foreground text-[12px] font-bold">평일 교시 (과목 전용)</h4>
                    {s.weekdayPeriods?.length ? (
                      <>
                        <PeriodListEditor
                          value={s.weekdayPeriods}
                          onChange={(v) => patchSubject(i, { weekdayPeriods: v })}
                        />
                        <button
                          type="button"
                          className={ghostBtnCls}
                          onClick={() =>
                            patchSubject(i, {
                              weekdayPeriods:
                                s.key === "english" ? [...ENGLISH_WEEKDAY_PERIOD_LIST] : undefined,
                            })
                          }
                        >
                          {s.key === "english"
                            ? "내장 기본(영어 11교시)으로 되돌리기"
                            : "전역 평일 교시 사용 (전용 해제)"}
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-text-dim text-[12px]">
                          전역 평일 교시(운영 체계 탭)를 사용 중입니다.
                        </p>
                        <button
                          type="button"
                          className={ghostBtnCls}
                          onClick={() =>
                            patchSubject(i, { weekdayPeriods: o.weekdayPeriods.map((p) => ({ ...p })) })
                          }
                        >
                          <Plus className="size-3.5" /> 과목 전용 교시 만들기 (전역 복사로 시작)
                        </button>
                      </>
                    )}
                  </div>

                  {/* 강사별시간표(강사뷰) — 가로줄(큰 섹션 경계 진한 선) + 격자 단위(분). */}
                  <div className="space-y-3">
                    <h4 className="text-foreground text-[12px] font-bold">강사별시간표(강사뷰)</h4>
                    <label className="flex items-center gap-2 text-[12px]">
                      <span className="text-text-dim w-[90px] shrink-0">격자 단위(분)</span>
                      <select
                        className={`${cellCls} w-[100px]`}
                        value={s.teacherViewStep ?? 10}
                        onChange={(e) =>
                          patchSubject(i, {
                            teacherViewStep: Number(e.target.value) as SubjectSetting["teacherViewStep"],
                          })
                        }
                        aria-label="강사뷰 격자 단위(분)"
                      >
                        {TEACHER_VIEW_STEPS.map((v) => (
                          <option key={v} value={v}>
                            {v}분
                          </option>
                        ))}
                      </select>
                    </label>
                    {/* 격자 한 칸(=격자 단위 분) 높이(px). 내부는 "분당 px"로 저장(스텝 무관 밀도) — 스텝을 바꾸면
                        칸 높이는 비례로 재계산된다. 비우면 기본값(placeholder) 사용. 숫자 입력하는 대로 강사뷰 세로 간격이 바뀐다. */}
                    <label className="flex items-center gap-2 text-[12px]">
                      <span className="text-text-dim w-[90px] shrink-0">한 칸 높이(px)</span>
                      <RowHeightInput
                        pxPerMin={s.teacherViewPxPerMin}
                        step={s.teacherViewStep ?? 10}
                        onChange={(v) => patchSubject(i, { teacherViewPxPerMin: v })}
                      />
                      <span className="text-text-faint text-[11px]">
                        {s.teacherViewStep ?? 10}분 한 칸의 세로 높이 (비우면 기본)
                      </span>
                    </label>
                    <div className="space-y-1.5">
                      <span className="text-text-dim block text-[12px]">가로줄(큰 섹션 경계) 시각</span>
                      <TimeListEditor
                        value={s.teacherViewLines ?? []}
                        onChange={(v) => patchSubject(i, { teacherViewLines: v })}
                      />
                    </div>
                    <p className="text-text-faint text-[11px]">
                      강사뷰는 영어 또는 가로줄이 설정된 과목에서 노출됩니다. 가로줄 시각은 격자 단위에
                      맞춰 표시됩니다(예: 30분 격자에서 16:10은 16:00 선으로).
                    </p>

                    {/* 가로줄 제외 강사 — 이 강사 컬럼엔 큰 섹션 가로줄 미표시(예: LAB의 JJ·이주희). */}
                    <div className="space-y-1.5 pt-1">
                      <span className="text-text-dim block text-[12px]">가로줄 제외 강사</span>
                      <ExcludeTeacherChips
                        options={teacherLabels[s.key] ?? []}
                        value={s.teacherViewLineExcluded ?? []}
                        onChange={(v) =>
                          patchSubject(i, { teacherViewLineExcluded: v.length ? v : undefined })
                        }
                      />
                    </div>

                    {/* 쉬는 시간 — 앞뒤로 수업이 붙은 강사 컬럼에만 "쉬는 시간" 셀로 표시. */}
                    <div className="space-y-1.5 pt-1">
                      <span className="text-text-dim block text-[12px]">쉬는 시간</span>
                      <BreakListEditor
                        value={s.teacherViewBreaks ?? []}
                        onChange={(v) =>
                          patchSubject(i, { teacherViewBreaks: v.length ? v : undefined })
                        }
                      />
                      <p className="text-text-faint text-[11px]">
                        설정한 시간대 앞에 끝나고 뒤에 시작하는 수업이 모두 있는 강사에게만 &lsquo;쉬는 시간&rsquo;
                        칸으로 표시됩니다(수업 사이). 앞뒤가 비어 있으면 표시되지 않습니다.
                      </p>
                    </div>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </SettingsCard>
      </div>

      {removing ? (
        <AbsorbDialog
          from={removing}
          targets={o.subjects
            .filter((s) => s.key !== removing.key)
            .map((s) => ({ value: s.key, label: s.label.trim() || s.key }))}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            removeRowLocal(removing.index);
            setRemoving(null);
            setSavedNonce(Date.now());
          }}
        />
      ) : null}
    </SectionForm>
  );
}

/**
 * 과목 삭제 다이얼로그 — 사용 데이터가 있으면 다른 과목으로 **흡수 후 삭제**, 없으면 **미사용 삭제**.
 * 둘 다 서버에서 즉시 확정(폼 저장 버튼과 무관 — 미사용 삭제도 실행 시점 사용량 재검증, TOCTOU 차단).
 * native <dialog> + showModal — 배경 inert(키보드로 뒤 폼 조작 불가)·Esc(cancel)·포커스 격리를
 * 브라우저가 제공. SectionForm(form) 안이라 중첩 form 금지 — 서버 액션을 버튼 핸들러에서 직접
 * 호출(전 버튼 type="button", SearchableSelect 검색창은 컴포넌트 레벨 Enter 가드).
 */
function AbsorbDialog({
  from,
  targets,
  onClose,
  onRemoved,
}: {
  from: { key: string; label: string };
  targets: { value: string; label: string }[];
  onClose: () => void;
  onRemoved: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [usage, setUsage] = useState<SubjectUsage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let alive = true;
    getSubjectUsage(from.key)
      .then((res) => {
        if (!alive) return;
        if ("error" in res) setLoadError(res.error);
        else setUsage(res);
      })
      .catch(() => {
        if (alive) setLoadError("사용량 조회에 실패했습니다 — 닫았다가 다시 시도해 주세요.");
      });
    return () => {
      alive = false;
    };
  }, [from.key]);

  // 실행 공통 래퍼 — 네트워크 단절 등 reject에도 busy가 고착되지 않게(취소 불능 방지).
  const run = async (fn: () => Promise<{ ok?: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (res.error) {
        setError(res.error);
        return;
      }
      onRemoved();
    } catch {
      setError("실행 결과를 확인하지 못했습니다(네트워크 오류 등). 다시 시도해 주세요 — 재실행은 안전합니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        // Esc — 실행 중엔 닫힘 방지(핸들러는 최신 렌더 클로저라 busy 직접 참조 안전)
        if (busy) e.preventDefault();
        else onClose();
      }}
      className="bg-card border-line backdrop:bg-ink/40 m-auto w-full max-w-md rounded-lg border p-5 shadow-lg"
    >
      <h3 className="text-foreground text-sm font-bold">‘{from.label}’ 과목 삭제</h3>

      {loadError ? (
        <p className="text-danger mt-3 text-[12px]">{loadError}</p>
      ) : !usage ? (
        <p className="text-text-dim mt-3 text-[12px]">사용 데이터 확인 중…</p>
      ) : usage.total === 0 ? (
        <p className="text-text-dim mt-3 text-[13px]">
          이 과목을 쓰는 데이터가 없습니다. 삭제하면 즉시 적용됩니다.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-text-dim text-[13px]">
            이 과목을 쓰는 데이터 <b className="text-foreground">{usage.total}건</b>이 있습니다. 삭제하려면
            아래에서 선택한 과목으로 <b className="text-foreground">모두 흡수</b>됩니다(즉시 적용).
          </p>
          <ul className="text-text-dim flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
            {usage.items.map((it) => (
              <li key={it.label} className="whitespace-nowrap">
                {it.label} <b className="text-foreground">{it.count}</b>
              </li>
            ))}
          </ul>
          <div className="space-y-1">
            <span className="text-text-dim block text-[12px]">흡수할 과목</span>
            <SearchableSelect
              options={targets}
              value={target}
              onValueChange={setTarget}
              placeholder="과목 선택"
              ariaLabel="흡수할 과목"
            />
          </div>
        </div>
      )}

      {error ? <p className="text-danger mt-3 text-[12px]">{error}</p> : null}

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          취소
        </Button>
        {usage && usage.total === 0 ? (
          <Button type="button" onClick={() => void run(() => removeUnusedSubject(from.key))} disabled={busy}>
            {busy ? "삭제 중…" : "삭제"}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => void run(() => absorbSubject({ from: from.key, to: target }))}
            disabled={!usage || !target || busy}
          >
            {busy ? "흡수 중…" : "모두 흡수하고 삭제"}
          </Button>
        )}
      </div>
    </dialog>
  );
}

/** "HH:MM" 시각 목록 편집기 — 강사뷰 가로줄 위치. */
function TimeListEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((t, i) => (
        <span key={i} className="flex items-center gap-1">
          <input
            type="time"
            className={`${cellCls} w-[120px]`}
            value={t}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button
            type="button"
            aria-label="가로줄 삭제"
            className="text-text-faint hover:text-danger shrink-0 rounded p-1"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X className="size-4" />
          </button>
        </span>
      ))}
      <button type="button" className={ghostBtnCls} onClick={() => onChange([...value, ""])}>
        <Plus className="size-3.5" /> 가로줄 추가
      </button>
    </div>
  );
}

/**
 * 강사뷰 한 칸 높이(px) 입력 — **로컬 문자열 상태**라 필드를 완전히 비울 수 있다(비워도 14로 스냅백 안 함).
 * 비우면 placeholder로 기본값을 보여주고 teacherViewPxPerMin=undefined(=기본 사용). 내부 저장은 "분당 px"(스텝 무관 밀도).
 * ⚠️ 스텝 변경(외부 요인)일 때만 표시값을 재동기 — 사용자 타이핑/클램프 중엔 draft를 안 건드려 커서·값 튐이 없다.
 */
function RowHeightInput({
  pxPerMin,
  step,
  onChange,
}: {
  pxPerMin: number | undefined;
  step: number;
  onChange: (pxPerMin: number | undefined) => void;
}) {
  const defaultPx = Math.round(DEFAULT_TEACHER_VIEW_PX_PER_MIN * step);
  const [draft, setDraft] = useState(pxPerMin != null ? String(Math.round(pxPerMin * step)) : "");
  // 스텝이 바뀌면(다른 외부 요인) 표시 px 재계산. 렌더 중 prev 비교 = effect-setState 룰 회피(#25).
  const [prevStep, setPrevStep] = useState(step);
  if (step !== prevStep) {
    setPrevStep(step);
    setDraft(pxPerMin != null ? String(Math.round(pxPerMin * step)) : "");
  }
  return (
    <input
      type="number"
      className={`${cellCls} w-[100px]`}
      min={5}
      max={120}
      step={1}
      value={draft}
      placeholder={String(defaultPx)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw); // 빈 문자열 허용 — 스냅백 없음
        const px = Number(raw);
        if (raw.trim() === "" || !Number.isFinite(px) || px <= 0) {
          onChange(undefined); // 비우면 기본값 사용
        } else {
          onChange(Math.min(6, Math.max(0.5, px / step))); // px(한 칸)→분당 px + 스키마 범위 클램프
        }
      }}
      aria-label="강사뷰 격자 한 칸 높이(px)"
    />
  );
}

/** 쉬는 시간(시작~종료) 목록 편집기 — 강사뷰 수업 사이 휴식 밴드. */
function BreakListEditor({
  value,
  onChange,
}: {
  value: BreakRangeSetting[];
  onChange: (v: BreakRangeSetting[]) => void;
}) {
  const patch = (i: number, p: Partial<BreakRangeSetting>) =>
    onChange(value.map((b, j) => (j === i ? { ...b, ...p } : b)));
  return (
    <div className="space-y-1.5">
      {value.map((b, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="time"
            aria-label="쉬는 시간 시작"
            className={`${cellCls} w-[110px]`}
            value={b.start}
            onChange={(e) => patch(i, { start: e.target.value })}
          />
          <span className="text-text-faint text-[12px]">~</span>
          <input
            type="time"
            aria-label="쉬는 시간 종료"
            className={`${cellCls} w-[110px]`}
            value={b.end}
            onChange={(e) => patch(i, { end: e.target.value })}
          />
          <button
            type="button"
            aria-label="쉬는 시간 삭제"
            className="text-text-faint hover:text-danger shrink-0 rounded p-1"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className={ghostBtnCls}
        onClick={() => onChange([...value, { start: "", end: "" }])}
      >
        <Plus className="size-3.5" /> 쉬는 시간 추가
      </button>
    </div>
  );
}

/**
 * 가로줄 제외 강사 = 토글 칩. 선택지 = 이 과목의 실제 강사 라벨(options) ∪ 이미 저장된 값(value).
 * 강사가 빠져 options에 없더라도 저장값은 해제 가능하도록 함께 노출.
 */
function ExcludeTeacherChips({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const names = Array.from(new Set([...options, ...value]));
  if (names.length === 0) {
    return (
      <p className="text-text-faint text-[11px]">
        이 과목에 배정된 강사가 아직 없습니다. 시간표에 강사가 배정되면 여기서 선택할 수 있습니다.
      </p>
    );
  }
  const selected = new Set(value);
  const toggle = (name: string) =>
    onChange(selected.has(name) ? value.filter((v) => v !== name) : [...value, name]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {names.map((name) => {
        const on = selected.has(name);
        return (
          <button
            key={name}
            type="button"
            onClick={() => toggle(name)}
            aria-pressed={on}
            className={`rounded-md border px-2.5 py-1 text-[12px] transition ${
              on
                ? "border-primary bg-primary/10 text-primary font-semibold"
                : "border-line text-text-dim hover:border-primary/60"
            }`}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
