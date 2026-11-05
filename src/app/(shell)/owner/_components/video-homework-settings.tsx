"use client";

import { useState } from "react";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { STUDENT_LEVELS, type StudentLevel } from "@/features/students/list-filter-values";
import type { VideoHomeworkPolicy } from "@/features/video-homework/policy";
import type { VideoHomeworkClassOption } from "@/features/video-homework/server/queries";
import { SettingsCard } from "./section-form";
import { ToggleField } from "./fields";

function setMembership<T>(values: T[], value: T, included: boolean): T[] {
  return included ? values.filter((item) => item !== value) : [...values, value];
}

export function VideoHomeworkSettings({ policy, classes, onChange }: {
  policy: VideoHomeworkPolicy;
  classes: VideoHomeworkClassOption[];
  onChange: (policy: VideoHomeworkPolicy) => void;
}) {
  const subjects = useSubjectMaps();
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const operatingClasses = classes.filter((cls) => cls.active);
  const operatingClassIds = new Set(operatingClasses.map((cls) => cls.id));
  const excludedCount = operatingClasses.filter((cls) => policy.disabledClassIds.includes(cls.id)).length;
  const filtered = operatingClasses.filter((cls) =>
    `${cls.name} ${subjects.labelOf(cls.subjectKey)}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const visible = showAll ? filtered : filtered.slice(0, 16);

  return <SettingsCard title="영상 제출 검사"
    description="영상 숙제를 쓰는 대상입니다. 과목·학교급·반 중 하나라도 꺼지면 원스크린 '영상 과제' 출제, 학생 영상 올리기 사이트, 학부모 보고서의 영상 안내 줄, 강사 체크·관리자 당일 명단·운영실 집계 등에서 빠집니다. 기존 검사 이력은 유지됩니다."
    span2>
    <div className="space-y-4">
      <ToggleField label="영상 제출 검사 사용" value={policy.enabled}
        hint={policy.enabled ? "사용 중" : "모든 과목·학년·반의 새 검사를 중지합니다"}
        onChange={(enabled) => onChange({ ...policy, enabled })} />

      <div className="border-line border-t pt-4">
        <h4 className="text-sm font-bold">과목별 사용</h4>
        <p className="text-text-dim mt-0.5 text-xs">파란색 과목만 검사합니다. 새 과목은 기본 사용으로 시작합니다.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {subjects.options.map((subject) => {
            const excluded = policy.disabledSubjectKeys.includes(subject.value);
            return <button key={subject.value} type="button" aria-pressed={!excluded}
              onClick={() => onChange({ ...policy,
                disabledSubjectKeys: setMembership(policy.disabledSubjectKeys, subject.value, excluded) })}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${excluded
                ? "border-line bg-card text-text-dim hover:bg-bg-soft"
                : "border-primary bg-primary/10 text-primary"}`}>
              {subject.label} {excluded ? "끔" : "사용"}
            </button>;
          })}
        </div>
      </div>

      <div className="border-line border-t pt-4">
        <h4 className="text-sm font-bold">학교급별 사용</h4>
        <p className="text-text-dim mt-0.5 text-xs">학생의 실제 학년을 기준으로 적용합니다. 학년이 비어 있으면 ‘기타·미입력’에 포함됩니다.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {STUDENT_LEVELS.map((level) => {
            const excluded = policy.disabledSchoolLevels.includes(level.key);
            return <button key={level.key} type="button" aria-pressed={!excluded}
              onClick={() => onChange({ ...policy,
                disabledSchoolLevels: setMembership<StudentLevel>(policy.disabledSchoolLevels, level.key, excluded) })}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${excluded
                ? "border-line bg-card text-text-dim hover:bg-bg-soft"
                : "border-primary bg-primary/10 text-primary"}`}>
              {level.label} {excluded ? "끔" : "사용"}
            </button>;
          })}
        </div>
      </div>

      <div className="border-line border-t pt-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h4 className="text-sm font-bold">반별 사용</h4>
            <p className="text-text-dim mt-0.5 text-xs">운영 중인 반만 표시합니다. 과목·학교급이 켜져 있어도 여기서 끈 반은 제외됩니다.</p></div>
          {excludedCount > 0 ? <button type="button" className="text-primary text-xs font-semibold underline"
            onClick={() => onChange({ ...policy,
              disabledClassIds: policy.disabledClassIds.filter((id) => !operatingClassIds.has(id)),
            })}>운영 중인 반 모두 사용</button> : null}
        </div>
        <input type="search" aria-label="영상 제출 반 검색" value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder="반 이름·과목 검색" className="border-line bg-card mt-3 w-full max-w-sm rounded-lg border px-3 py-2 text-sm" />
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((cls) => {
            const excluded = policy.disabledClassIds.includes(cls.id);
            return <button key={cls.id} type="button" aria-pressed={!excluded}
              onClick={() => onChange({ ...policy,
                disabledClassIds: setMembership(policy.disabledClassIds, cls.id, excluded) })}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs ${excluded
                ? "border-line bg-bg-soft text-text-dim"
                : "border-primary/30 bg-primary/5 text-foreground"}`}>
              <span className="min-w-0 truncate">{cls.name} <span className="text-text-faint">· {subjects.labelOf(cls.subjectKey)}</span></span>
              <strong className={excluded ? "text-text-dim" : "text-primary"}>{excluded ? "끔" : "사용"}</strong>
            </button>;
          })}
        </div>
        {filtered.length === 0 ? <p className="text-text-faint mt-2 text-xs">해당 반이 없습니다.</p> : null}
        {!showAll && filtered.length > visible.length ? <button type="button"
          className="text-primary mt-3 text-xs font-semibold underline" onClick={() => setShowAll(true)}>
          나머지 {filtered.length - visible.length}개 반 보기</button> : null}
        {showAll && filtered.length > 16 ? <button type="button"
          className="text-primary mt-3 text-xs font-semibold underline" onClick={() => setShowAll(false)}>접기</button> : null}
        <p className="text-text-faint mt-3 text-xs">운영 중인 반 중 제외 {excludedCount}개 · 저장을 누르면 강사 화면에도 반영됩니다.</p>
      </div>
    </div>
  </SettingsCard>;
}
