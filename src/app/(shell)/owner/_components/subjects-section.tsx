"use client";

// 과목 운영 면 — 한 카드에 과목 목록(이름·색·요일병합) + 과목별 상세(접이식: 평일 교시·강사뷰·**세션 기간**).
// 2026-08-07 원장 지시로 두 카드를 합치고 세션 기간을 여기로 들였다(별도 탭 폐지).
// 운영 체계 면과 **같은 operations 섹션**에 저장(face→section 매핑은 UI 레벨) — payload는 full
// operations(여기선 subjects만 편집, 나머지는 initial 통과). 동시편집 가드 scope도 동일해 두 면 커버.
// 과목별 편집기는 native <details>(기본 접힘 + 요약 배지) — 과목 수만큼 빈 풀폭 카드가 늘어지는 것 방지.
import { useEffect, useRef, useState } from "react";
import { Plus, X } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import {
  DEFAULT_TEACHER_VIEW_PX_PER_MIN,
  SUBJECT_COLORS,
  TEACHER_VIEW_STEPS,
  type BreakRangeSetting,
  type MonthPlanTextsSetting,
  type OperationsSettings,
  type SkillAreaSetting,
  type SubjectSetting,
} from "@/features/owner/settings-types";
import { SUBJECT_COLOR_LABEL } from "@/features/owner/subject-color-label";
import { DEFAULT_MONTH_PLAN_TEXTS, MONTH_PLAN_SUBJECT_KEY } from "@/features/owner/month-plan-texts";
import { useModuleOn } from "@/features/owner/operations-context";
import { DEFAULT_ENGLISH_SKILL_AREAS, skillAreaColorOf } from "@/features/owner/skill-areas";
import { SUBJECT_SOLID } from "@/features/owner/subjects";
import { ENGLISH_WEEKDAY_PERIOD_LIST } from "@/features/timetable/lib/periods";
import {
  absorbSubject,
  getSubjectUsage,
  removeUnusedSubject,
  type AbsorbResult,
  type SubjectUsage,
} from "@/features/owner/server/subject-actions";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SectionForm, SettingsCard } from "./section-form";
import { useSectionDraft } from "./use-section-draft";
import { PeriodListEditor, SubjectListEditor } from "./list-editors";
import { WeekdayGroupingEditor } from "./weekday-grouping-editor";
import { weekdayGroupingChoices } from "@/features/timetable/lib/weekday-groups";
import { SubjectSessionEditor } from "./subject-session-editor";
import { useLockedPlaceholder, useWriteLock } from "./write-lock-context";
import type { PeriodDef } from "@/features/periods/resolve";

const cellCls =
  "border-line text-foreground rounded-md border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-primary";
const ghostBtnCls =
  "border-line text-text-dim hover:text-foreground hover:border-primary inline-flex items-center gap-1 rounded-md border border-dashed px-3 py-1.5 text-xs";
const badgeCls =
  "text-text-dim border-line rounded border px-1.5 py-0.5 text-xs whitespace-nowrap";

export function SubjectsSection({
  initial,
  teacherLabels = {},
  periodDefs = [],
  sessionYear,
  holidays = [],
  readOnly = false,
  baselineToken,
  baselineVersion,
}: {
  /**
   * 운영 섹션 **전체**(여기선 과목만 고치고 나머지는 그대로 통과시켜 저장한다).
   * 🔴 읽기 전용 열람자에게는 자리 PIN 값이 지워진 사본이 온다(서버 `operationsForViewer`) — 이 객체가 폼의 숨은
   *    입력에 통째로 실리기 때문이다. 편집자는 실제 값을 받아 그대로 되돌려 보내므로 과목만 고쳐 저장해도 PIN이 보존된다.
   */
  initial: OperationsSettings;
  /** 과목별 강사 라벨(강사뷰 '가로줄 제외 강사' 칩 선택지) — getTeacherLabelsBySubject. */
  teacherLabels?: Record<string, string[]>;
  /** 그 해 세션 기간(0189a) — 과목별 상세에서 달력으로 편집한다. */
  periodDefs?: PeriodDef[];
  sessionYear: number;
  /** 공휴일·휴원일(운영 체계 탭) — 세션 수업 횟수 검산에서 뺀다. */
  holidays?: string[];
  /** 운영 설정 저장 권한이 없는 열람자 — 저장 바가 없고 제출도 막힌다. */
  readOnly?: boolean;
  /** 이 면(과목 운영)이 맡는 값의 기준 token — 저장 요청에 실린다. 서버가 저장할 수 있는 사람에게만 내려준다. */
  baselineToken?: string;
  /** 이 값을 읽은 문서의 저장 순번 — 내 저장보다 먼저 읽힌 값이 뒤늦게 내려와도 받지 않는다(useSectionDraft). */
  baselineVersion?: number;
}) {
  // 🔴 저장은 이 면이 맡는 칸(과목·요일 병합)만 반영된다. 과목 행의 시간표 칸(강사 순서·통합뷰 그룹)과
  //    운영 체계 면의 칸은 서버가 방금 읽은 값을 그대로 둔다(operations-slice.ts).
  const { draft: o, setDraft: setO, baseline, isDirty, noteSubmitted, confirmSaved, noteSaveFailed, adopt, adoptions } =
    useSectionDraft(initial, baselineToken, baselineVersion);
  // 월간 계획서 문구 편집 칸은 영어 강사 시트 기능이 켜져 있을 때만 선다(읽는 화면이 그 기능의 것이다).
  const ecsOn = useModuleOn("ecs");
  // 삭제는 서버에서 즉시 확정된다 — 다른 미저장 변경이 섞여 있으면 먼저 저장하게 한다(아래 onRemove).
  const [removeBlocked, setRemoveBlocked] = useState(false);
  const setSubjects = (v: SubjectSetting[]) => setO((prev) => ({ ...prev, subjects: v }));
  const patchSubject = (i: number, patch: Partial<SubjectSetting>) =>
    setSubjects(o.subjects.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  // 삭제 = 흡수 다이얼로그(조건부 마운트 — 닫히면 언마운트로 state 리셋, #67 안전)
  const [removing, setRemoving] = useState<{ index: number; key: string; label: string } | null>(null);
  // 흡수/미사용 삭제는 서버 즉시 확정 → SectionForm baseline 재스냅샷 신호(거짓 '미저장' 확인 방지).
  const [savedNonce, setSavedNonce] = useState(0);
  // 펼쳐진 과목 — 세션 달력을 그 과목에만 마운트하기 위해(성능).
  const [openSubjects, setOpenSubjects] = useState<Set<string>>(new Set());

  return (
    <SectionForm
      section="operations"
      payload={o}
      savedNonce={savedNonce}
      readOnly={readOnly}
      extraFields={{ operationsFace: "subjects", operationsBaseline: baseline }}
      onSubmit={noteSubmitted}
      onSaved={(state) => {
        confirmSaved(state.operations?.tokens.subjects, state.version);
        setRemoveBlocked(false);
      }}
      onSaveFailed={noteSaveFailed}
      rebaselineNonce={adoptions}
    >
      <div className="space-y-5">
        <SettingsCard
          title="요일 병합 묶음"
          description="월·화, 수·목, 토·일처럼 원하는 요일을 묶어 두면 과목의 시간표 요일 병합 목록에 나타납니다. 묶음에 넣지 않은 평일은 수업이 있는 날 혼자 섭니다."
        >
          <WeekdayGroupingEditor
            groupings={o.weekdayGroupings ?? []}
            hiddenBuiltins={o.hiddenBuiltinWeekdayGroupings ?? []}
            subjects={o.subjects}
            onChange={({ groupings, hiddenBuiltins, subjects }) =>
              setO((prev) => ({ ...prev, weekdayGroupings: groupings, hiddenBuiltinWeekdayGroupings: hiddenBuiltins, subjects }))
            }
          />
        </SettingsCard>
        {/* 원장 지시(2026-08-07): *"운영 과목-과목 설정도 하나로 합쳐도 되겠는데 굳이 다른 섹션으로 있을 필요 없을듯."*
            과목 목록과 그 과목의 상세 설정은 같은 대상이라 한 카드에서 위(목록) → 아래(과목별 상세)로 잇는다. */}
        <SettingsCard
          title="과목 운영"
          description="과목명과 색만 정하면 됩니다. 색은 전 화면의 과목 배지·시간표·엑셀에 적용됩니다. 내부 ID는 데이터 보존용으로 자동 생성·고정(편집 불가). 삭제 시 그 과목의 데이터를 다른 과목에 흡수시킵니다. 아래에서 과목을 펼치면 그 과목의 교시·강사뷰·세션 기간을 설정합니다."
        >
          <SubjectListEditor
            value={o.subjects}
            onChange={setSubjects}
            groupingChoices={weekdayGroupingChoices(o.weekdayGroupings, o.hiddenBuiltinWeekdayGroupings)}
            onRemove={(i) => {
              // 삭제는 서버에서 즉시 확정되고 화면은 그 결과를 통째로 받는다 — 작성 중인 변경이 있으면 그게 사라진다.
              if (isDirty()) {
                setRemoveBlocked(true);
                return;
              }
              setRemoveBlocked(false);
              const s = o.subjects[i];
              setRemoving({ index: i, key: s.key, label: s.label.trim() || s.key });
            }}
          />
          {removeBlocked ? (
            <p role="alert" className="text-danger mt-2 text-xs">
              저장하지 않은 변경이 있습니다. 먼저 저장한 뒤 삭제해 주세요.
            </p>
          ) : null}

          <div className="border-line divide-line mt-5 divide-y border-t pt-2">
            {o.subjects.map((s, i) => (
              <details
                key={s.key || `row-${i}`}
                className="group py-1"
                onToggle={(e) => {
                  // 🔴 펼친 과목만 세션 달력을 마운트한다 — 12판 × 42칸 = 504개 버튼이라
                  //    과목 5개면 2,520개가 접힌 채로도 렌더·하이드레이션된다(반응속도 1순위).
                  const open = (e.currentTarget as HTMLDetailsElement).open;
                  setOpenSubjects((prev) => {
                    const next = new Set(prev);
                    if (open) next.add(s.key);
                    else next.delete(s.key);
                    return next;
                  });
                }}
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded px-1 py-2 select-none [&::-webkit-details-marker]:hidden">
                  <EyIcon name="chevronRight" size={12} className="text-text-faint transition-transform group-open:rotate-90" />
                  <span className="text-foreground text-sm font-bold">{s.label.trim() || s.key}</span>
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
                    {s.skillAreas?.length ? (
                      <span className={badgeCls}>수업계획 영역 {s.skillAreas.length}</span>
                    ) : s.key === "english" ? (
                      <span className={badgeCls}>수업계획 기본 6영역</span>
                    ) : null}
                  </span>
                </summary>

                <div className="space-y-5 px-1 pt-1 pb-4">
                  {/* 수업 보고서 — 원스크린 일일·확인테스트 만점(문항 수). 기본 5. */}
                  <div className="space-y-2">
                    <h4 className="text-foreground text-xs font-bold">수업 보고서 · 테스트</h4>
                    <label className="flex flex-wrap items-center gap-2 text-xs">
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
                      <span className="text-text-faint text-xs">일일·확인테스트 만점(/N). 기본 5</span>
                    </label>
                  </div>

                  {/* 수업계획(ECS) '구분' 영역 — English Class Sheet 계획 행의 영역 선택지. 저장은 영문 ID(불변),
                      라벨만 편집. english는 미설정 시 기본 6영역(Vocab~Speaking) 자동 사용(resolveSkillAreas). */}
                  <div className="space-y-2">
                    <h4 className="text-foreground text-xs font-bold">수업계획(영어 강사 시트) 영역</h4>
                    {s.skillAreas?.length ? (
                      <>
                        <SkillAreaListEditor
                          value={s.skillAreas}
                          onChange={(v) => patchSubject(i, { skillAreas: v })}
                        />
                        {readOnly ? null : (
                          <button
                            type="button"
                            className={ghostBtnCls}
                            onClick={() =>
                              patchSubject(i, {
                                skillAreas: s.key === "english" ? undefined : [],
                              })
                            }
                          >
                            {s.key === "english"
                              ? "기본 6영역(Vocab~Speaking)으로 되돌리기"
                              : "영역 전체 해제 (수업계획 대상 제외)"}
                          </button>
                        )}
                        <p className="text-text-faint text-xs">
                          영역을 삭제해도 이미 저장된 수업계획 행은 사라지지 않고 &lsquo;미등록 영역&rsquo;으로
                          표시됩니다.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-text-dim text-xs">
                          {s.key === "english"
                            ? "기본 6영역(Vocab · Listening · Reading · Grammar · Writing · Speaking)을 사용 중입니다."
                            : "이 과목은 수업계획(ECS) 대상이 아닙니다."}
                        </p>
                        {readOnly ? null : (
                          <button
                            type="button"
                            className={ghostBtnCls}
                            onClick={() =>
                              patchSubject(i, {
                                skillAreas:
                                  s.key === "english"
                                    ? DEFAULT_ENGLISH_SKILL_AREAS.map((a) => ({ ...a }))
                                    : [{ key: "area_1", label: "" }],
                              })
                            }
                          >
                            <Plus className="size-3.5" />{" "}
                            {s.key === "english" ? "영역 직접 편집 (기본 복사로 시작)" : "영역 만들기"}
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* 월간 계획서(MP) 인쇄물 문구 — 반이 달라도 같은 문구라 과목 단위(원본 구글 시트 그대로).
                      🔴 소비처 = (print)/ecs/[classId]/month-plan · 계획(MP) 화면 — 둘 다 **영어 과목의 값**만 읽는다
                         (month-plan-chrome.ts). 그래서 편집 칸도 영어 과목에만, 영어 강사 시트 기능이 켜져 있을 때만 세운다 —
                         다른 과목에 세우면 적어도 어디에도 안 나오는 칸이 된다. 다른 과목에 이미 저장된 값은 지우지 않는다. */}
                  {s.key === MONTH_PLAN_SUBJECT_KEY && ecsOn ? (
                    <MonthPlanTextsEditor
                      value={s.monthPlan}
                      onChange={(v) => patchSubject(i, { monthPlan: v })}
                    />
                  ) : null}

                  {/* 평일 교시(과목 전용) — 미설정이면 전역(운영 체계 탭) 폴백. 주말 교시는 전역 공통. */}
                  <div className="space-y-2">
                    <h4 className="text-foreground text-xs font-bold">평일 교시 (과목 전용)</h4>
                    {s.weekdayPeriods?.length ? (
                      <>
                        <PeriodListEditor
                          value={s.weekdayPeriods}
                          onChange={(v) => patchSubject(i, { weekdayPeriods: v })}
                        />
                        {readOnly ? null : (
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
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-text-dim text-xs">
                          전역 평일 교시(운영 체계 탭)를 사용 중입니다.
                        </p>
                        {readOnly ? null : (
                          <button
                            type="button"
                            className={ghostBtnCls}
                            onClick={() =>
                              patchSubject(i, { weekdayPeriods: o.weekdayPeriods.map((p) => ({ ...p })) })
                            }
                          >
                            <Plus className="size-3.5" /> 과목 전용 교시 만들기 (전역 복사로 시작)
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* 강사별시간표(강사뷰) — 가로줄(큰 섹션 경계 진한 선) + 격자 단위(분). */}
                  <div className="space-y-3">
                    <h4 className="text-foreground text-xs font-bold">강사별시간표(강사뷰)</h4>
                    <label className="flex items-center gap-2 text-xs">
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
                    <label className="flex items-center gap-2 text-xs">
                      <span className="text-text-dim w-[90px] shrink-0">한 칸 높이(px)</span>
                      <RowHeightInput
                        pxPerMin={s.teacherViewPxPerMin}
                        step={s.teacherViewStep ?? 10}
                        onChange={(v) => patchSubject(i, { teacherViewPxPerMin: v })}
                      />
                      <span className="text-text-faint text-xs">
                        {s.teacherViewStep ?? 10}분 한 칸의 세로 높이 (비우면 기본)
                      </span>
                    </label>
                    <div className="space-y-1.5">
                      <span className="text-text-dim block text-xs">가로줄(큰 섹션 경계) 시각</span>
                      <TimeListEditor
                        value={s.teacherViewLines ?? []}
                        onChange={(v) => patchSubject(i, { teacherViewLines: v })}
                      />
                    </div>
                    <p className="text-text-faint text-xs">
                      강사뷰는 영어 또는 가로줄이 설정된 과목에서 노출됩니다. 가로줄 시각은 격자 단위에
                      맞춰 표시됩니다(예: 30분 격자에서 16:10은 16:00 선으로).
                    </p>

                    {/* 가로줄 제외 강사 — 이 강사 컬럼엔 큰 섹션 가로줄 미표시(예: LAB의 JJ·이주희). */}
                    <div className="space-y-1.5 pt-1">
                      <span className="text-text-dim block text-xs">가로줄 제외 강사</span>
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
                      <span className="text-text-dim block text-xs">쉬는 시간</span>
                      <BreakListEditor
                        value={s.teacherViewBreaks ?? []}
                        onChange={(v) =>
                          patchSubject(i, { teacherViewBreaks: v.length ? v : undefined })
                        }
                      />
                      <p className="text-text-faint text-xs">
                        설정한 시간대 앞에 끝나고 뒤에 시작하는 수업이 모두 있는 강사에게만 &lsquo;쉬는 시간&rsquo;
                        칸으로 표시됩니다(수업 사이). 앞뒤가 비어 있으면 표시되지 않습니다.
                      </p>
                    </div>
                  </div>

                  {/* 세션 기간 — 이 과목이 실제로 운영되는 구간(달력월이 아니다). 원장 지시로 과목 운영 안에 둔다. */}
                  <div className="space-y-2">
                    <h4 className="text-foreground text-xs font-bold">
                      세션 기간 <span className="text-text-faint font-normal">· {sessionYear}년</span>
                    </h4>
                    {openSubjects.has(s.key) ? (
                      // key에 연도 — 연도 칩(searchParam 소프트 네비)은 클라 컴포넌트를 **재사용**하므로
                      // 키가 없으면 작년에 칠한 날짜가 새 해 세션으로 저장된다(적대 리뷰 확인).
                      <SubjectSessionEditor
                        key={`${s.key}:${sessionYear}`}
                        subjectKey={s.key}
                        subjectLabel={s.label.trim() || s.key}
                        year={sessionYear}
                        defs={periodDefs}
                        holidays={holidays}
                      />
                    ) : (
                      <p className="text-text-faint text-xs">달력을 불러오는 중…</p>
                    )}
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
          onRemoved={(result) => {
            setRemoving(null);
            // 🔴 자기 목록에서 행만 빼지 않는다 — 서버가 확정한 이 면의 값과 그 값의 token을 **함께** 받는다.
            //    화면이 깨끗해 보여도 그사이 다른 창이 다른 과목을 고쳤을 수 있고, 옛 목록에 새 token을 붙이면
            //    다음 저장이 그 변경을 되돌린다.
            if (!result.subjectsFace) {
              window.location.reload();
              return;
            }
            adopt({ ...o, ...result.subjectsFace.snapshot }, result.subjectsFace.token, result.subjectsFace.version);
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
  onRemoved: (result: AbsorbResult) => void;
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
  const run = async (fn: () => Promise<AbsorbResult>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (res.error) {
        setError(res.error);
        return;
      }
      onRemoved(res);
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
        <p className="text-danger mt-3 text-xs">{loadError}</p>
      ) : !usage ? (
        <p className="text-text-dim mt-3 text-xs">사용 데이터 확인 중…</p>
      ) : usage.total === 0 ? (
        <p className="text-text-dim mt-3 text-sm">
          이 과목을 쓰는 데이터가 없습니다. 삭제하면 즉시 적용됩니다.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-text-dim text-sm">
            이 과목을 쓰는 데이터 <b className="text-foreground">{usage.total}건</b>이 있습니다. 삭제하려면
            아래에서 선택한 과목으로 <b className="text-foreground">모두 흡수</b>됩니다(즉시 적용).
          </p>
          <ul className="text-text-dim flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {usage.items.map((it) => (
              <li key={it.label} className="whitespace-nowrap">
                {it.label} <b className="text-foreground">{it.count}</b>
              </li>
            ))}
          </ul>
          <div className="space-y-1">
            <span className="text-text-dim block text-xs">흡수할 과목</span>
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

      {error ? <p className="text-danger mt-3 text-xs">{error}</p> : null}

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

/**
 * 월간 계획서(MP) 인쇄물 문구 편집기 — 머리말(교재 약어 범례 · 안내)과 꼬리말(Prep 안내).
 *
 * 🔴 **소비처가 곧 존재 이유다**: 계획(MP) 화면과 `(print)/ecs/[classId]/month-plan`이 **같은 값**을
 *    읽어 같은 문서를 그린다(소비처 없는 설정 금지 — CLAUDE.md 학원 설정 절).
 * ⚠️ **빈 칸 = 미설정**이다(그 블록이 빠지는 게 아니라 **코드 기본값**이 들어간다 — 기본값이 원본 시트
 *    문구라 그게 맞는 동작이다). 블록을 정말 없애야 하는 요구가 생기면 끄는 길을 따로 낼 것.
 * ⚠️ 저장은 **다섯 칸을 함께** 담는다(부분 객체를 저장하면 Zod가 거절한다). 다섯 칸이 전부 비면 키를
 *    지워 미설정으로 되돌린다 — 그래야 나중에 코드 기본값을 고쳤을 때 옛 계정만 옛 값에 묶이지 않는다.
 * ⚠️ `slogan`은 나중에 생긴 칸이라 스키마에서 `.optional()`이다 — 옛 저장 행엔 없을 수 있으니
 *    읽을 때 `?? ""`로 받는다(안 그러면 controlled/uncontrolled가 뒤바뀐다).
 */
function MonthPlanTextsEditor({
  value,
  onChange,
}: {
  value: MonthPlanTextsSetting | undefined;
  onChange: (v: MonthPlanTextsSetting | undefined) => void;
}) {
  const cur: MonthPlanTextsSetting = value ?? DEFAULT_MONTH_PLAN_TEXTS;
  const patch = (key: keyof MonthPlanTextsSetting, v: string) => {
    const next = { ...cur, [key]: v };
    const allEmpty = (Object.keys(next) as (keyof MonthPlanTextsSetting)[]).every(
      (k) => (next[k] ?? "").trim() === "",
    );
    onChange(allEmpty ? undefined : next);
  };
  const fields: {
    key: keyof MonthPlanTextsSetting;
    label: string;
    hint: string;
    rows: number;
  }[] = [
    {
      key: "bookLegend",
      label: "교재 약어 범례",
      hint: "표 위 오른쪽. 한 줄에 하나씩. 비우면 기본 문구가 들어갑니다",
      rows: 2,
    },
    { key: "notices", label: "표 위 안내", hint: "한 줄에 하나씩. 비우면 기본 문구가 들어갑니다", rows: 4 },
    {
      key: "slogan",
      label: "꼬리말 한 줄",
      hint: "세션 기간 줄 바로 아래. 예: 발음은 정확하게! 큰 소리로! 자신감있게!",
      rows: 1,
    },
    { key: "prepTitle", label: "꼬리말 제목", hint: "예: Prep 안내", rows: 1 },
    { key: "prepNotes", label: "꼬리말 본문", hint: "한 줄에 하나씩. 비우면 기본 문구가 들어갑니다", rows: 3 },
  ];
  return (
    <div className="space-y-2">
      <h4 className="text-foreground text-xs font-bold">월간 계획서(MP) 인쇄 문구</h4>
      <p className="text-text-faint text-xs">
        영어 강사 시트 · 계획(MP) 보기와 그 인쇄물이 함께 쓰는 문서 문구입니다(화면과 인쇄가 같은 값을
        읽습니다). 반마다 같은 문구라 여기서 한 번만 적습니다.
      </p>
      <div className="grid gap-2 lg:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-text-dim text-xs font-semibold">{f.label}</span>
            <textarea
              className={`${cellCls} resize-y`}
              rows={f.rows}
              value={cur[f.key] ?? ""}
              onChange={(e) => patch(f.key, e.target.value)}
              aria-label={`월간 계획서 ${f.label}`}
            />
            <span className="text-text-faint text-xs">{f.hint}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * 수업계획(ECS) 영역 목록 편집기 — 라벨만 편집, 내부 ID(key)는 자동 확정·불변(subjects[].key와 동일 원칙:
 * ID가 바뀌면 저장된 계획 행 연결이 끊긴다). 새 행은 라벨 blur 시 1회 확정 — 기본 6영역 라벨이면 표준
 * ID(vocab 등), 아니면 area_N 폴백. 중복 라벨은 빨간 경고(저장은 superRefine가 이중 방어).
 */
const KNOWN_AREA_KEYS = new Map(
  DEFAULT_ENGLISH_SKILL_AREAS.map((a) => [a.label.toLowerCase(), a.key]),
);
function SkillAreaListEditor({
  value,
  onChange,
}: {
  value: SkillAreaSetting[];
  onChange: (v: SkillAreaSetting[]) => void;
}) {
  const labels = value.map((a) => a.label.trim()).filter(Boolean);
  const dupLabels = new Set(labels.filter((l, i) => labels.indexOf(l) !== i));
  // 읽기 권한(쓰기 잠금)이면 영역 추가·삭제를 그리지 않고 빈 칸엔 권한 안내(write-lock-context.tsx).
  const { locked } = useWriteLock();
  const ph = useLockedPlaceholder();
  const confirmKey = (i: number) => {
    const a = value[i];
    if (a.key) return; // 확정된 ID는 불변
    const label = a.label.trim();
    if (!label) return;
    const known = KNOWN_AREA_KEYS.get(label.toLowerCase());
    const used = new Set(value.map((x) => x.key).filter(Boolean));
    let key = known && !used.has(known) ? known : "";
    if (!key) {
      let n = 1;
      while (used.has(`area_${n}`)) n += 1;
      key = `area_${n}`;
    }
    onChange(value.map((x, j) => (j === i ? { ...x, key } : x)));
  };
  return (
    <div className="space-y-1.5">
      {value.map((a, i) => {
        const dup = a.label.trim() !== "" && dupLabels.has(a.label.trim());
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <input
              className={`${cellCls} w-[160px] ${dup ? "border-danger" : ""}`}
              value={a.label}
              placeholder={ph("영역 이름 (예: Vocab)")}
              onChange={(e) =>
                onChange(value.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
              }
              onBlur={() => confirmKey(i)}
              aria-label="수업계획 영역 이름"
            />
            {/* 영역 색 — 수업계획 화면(패널·계획 행)에서 영역을 한눈에 가르는 색. 미지정은 기본색/순번색. */}
            <span className="flex items-center gap-1.5">
              <span
                className={`size-4 shrink-0 rounded-sm ${SUBJECT_SOLID[skillAreaColorOf(value, a.key)]}`}
                aria-hidden
              />
              <select
                className={`${cellCls} w-[92px]`}
                value={a.color ?? ""}
                onChange={(e) =>
                  onChange(
                    value.map((x, j) =>
                      j === i
                        ? { ...x, color: (e.target.value || undefined) as SkillAreaSetting["color"] }
                        : x,
                    ),
                  )
                }
                aria-label="영역 색"
              >
                <option value="">자동</option>
                {SUBJECT_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {SUBJECT_COLOR_LABEL[c]}
                  </option>
                ))}
              </select>
            </span>
            <span className={badgeCls}>{a.key || "ID 자동"}</span>
            {dup ? <span className="text-danger text-xs">이름 중복</span> : null}
            {locked ? null : (
              <button
                type="button"
                aria-label="영역 삭제"
                className="text-text-faint hover:text-danger shrink-0 rounded p-1"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        );
      })}
      {locked ? null : (
        <button
          type="button"
          className={ghostBtnCls}
          onClick={() => onChange([...value, { key: "", label: "" }])}
        >
          <Plus className="size-3.5" /> 영역 추가
        </button>
      )}
    </div>
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
  const { locked } = useWriteLock();
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
          {locked ? null : (
            <button
              type="button"
              aria-label="가로줄 삭제"
              className="text-text-faint hover:text-danger shrink-0 rounded p-1"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <X className="size-4" />
            </button>
          )}
        </span>
      ))}
      {locked ? null : (
        <button type="button" className={ghostBtnCls} onClick={() => onChange([...value, ""])}>
          <Plus className="size-3.5" /> 가로줄 추가
        </button>
      )}
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
  const { locked } = useWriteLock();
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
          <span className="text-text-faint text-xs">~</span>
          <input
            type="time"
            aria-label="쉬는 시간 종료"
            className={`${cellCls} w-[110px]`}
            value={b.end}
            onChange={(e) => patch(i, { end: e.target.value })}
          />
          {locked ? null : (
            <button
              type="button"
              aria-label="쉬는 시간 삭제"
              className="text-text-faint hover:text-danger shrink-0 rounded p-1"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      ))}
      {locked ? null : (
        <button
          type="button"
          className={ghostBtnCls}
          onClick={() => onChange([...value, { start: "", end: "" }])}
        >
          <Plus className="size-3.5" /> 쉬는 시간 추가
        </button>
      )}
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
      <p className="text-text-faint text-xs">
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
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              on
                ? "border-primary bg-primary/10 text-primary font-bold"
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
