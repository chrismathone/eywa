"use client";

// 과목 운영 면 — 과목 목록(이름·색·요일병합) + 과목별 설정(평일 교시 전용표·강사별시간표 가로줄/격자).
// 운영 체계 면과 **같은 operations 섹션**에 저장(face→section 매핑은 UI 레벨) — payload는 full
// operations(여기선 subjects만 편집, 나머지는 initial 통과). 동시편집 가드 scope도 동일해 두 면 커버.
import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  TEACHER_VIEW_STEPS,
  type OperationsSettings,
  type SubjectSetting,
} from "@/features/owner/settings-types";
import { ENGLISH_WEEKDAY_PERIOD_LIST } from "@/features/timetable/lib/periods";
import { SectionForm, SettingsCard } from "./section-form";
import { PeriodListEditor, SubjectListEditor } from "./list-editors";

const cellCls =
  "border-line text-foreground rounded-md border bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:border-primary";
const ghostBtnCls =
  "border-line text-text-dim hover:text-foreground hover:border-primary inline-flex items-center gap-1 rounded-md border border-dashed px-3 py-1.5 text-[12px]";

export function SubjectsSection({ initial }: { initial: OperationsSettings }) {
  const [o, setO] = useState<OperationsSettings>(initial);
  const setSubjects = (v: SubjectSetting[]) => setO((prev) => ({ ...prev, subjects: v }));
  const patchSubject = (i: number, patch: Partial<SubjectSetting>) =>
    setSubjects(o.subjects.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <SectionForm section="operations" payload={o}>
      <div className="space-y-4">
        <SettingsCard
          title="운영 과목"
          description="과목명과 색만 정하면 됩니다. 색은 전 화면의 과목 배지·시간표·엑셀에 적용됩니다. 내부 ID는 데이터 보존용으로 자동 생성·고정(편집 불가)."
        >
          <SubjectListEditor value={o.subjects} onChange={setSubjects} />
        </SettingsCard>

        {o.subjects.map((s, i) => (
          <SettingsCard
            key={s.key || `row-${i}`}
            title={`${s.label.trim() || s.key} · 과목별 설정`}
            description="이 과목에만 적용되는 평일 교시와 강사별시간표(강사뷰) 표시."
          >
            <div className="grid items-start gap-6 xl:grid-cols-2">
              {/* 평일 교시(과목 전용) — 미설정이면 전역(운영 체계 탭) 폴백. 주말 교시는 전역 공통. */}
              <div className="space-y-2">
                <h4 className="text-foreground text-[13px] font-bold">평일 교시 (과목 전용)</h4>
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
                      onClick={() => patchSubject(i, { weekdayPeriods: o.weekdayPeriods.map((p) => ({ ...p })) })}
                    >
                      <Plus className="size-3.5" /> 과목 전용 교시 만들기 (전역 복사로 시작)
                    </button>
                  </>
                )}
              </div>

              {/* 강사별시간표(강사뷰) — 가로줄(큰 섹션 경계 진한 선) + 격자 단위(분). */}
              <div className="space-y-3">
                <h4 className="text-foreground text-[13px] font-bold">강사별시간표(강사뷰)</h4>
                <label className="flex items-center gap-2 text-[12px]">
                  <span className="text-text-dim w-[90px] shrink-0">격자 단위(분)</span>
                  <select
                    className={`${cellCls} w-[100px]`}
                    value={s.teacherViewStep ?? 10}
                    onChange={(e) =>
                      patchSubject(i, { teacherViewStep: Number(e.target.value) as SubjectSetting["teacherViewStep"] })
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
                <div className="space-y-1.5">
                  <span className="text-text-dim block text-[12px]">가로줄(큰 섹션 경계) 시각</span>
                  <TimeListEditor
                    value={s.teacherViewLines ?? []}
                    onChange={(v) => patchSubject(i, { teacherViewLines: v })}
                  />
                </div>
                <p className="text-text-faint text-[11px]">
                  강사뷰는 영어 또는 가로줄이 설정된 과목에서 노출됩니다. 가로줄 시각은 격자 단위에 맞춰
                  표시됩니다(예: 30분 격자에서 16:10은 16:00 선으로).
                </p>
              </div>
            </div>
          </SettingsCard>
        ))}
      </div>
    </SectionForm>
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
