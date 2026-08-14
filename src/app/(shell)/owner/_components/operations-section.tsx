"use client";

import { useState } from "react";
import type { OperationsSettings } from "@/features/owner/settings-types";
import { RESUME_DEPARTMENTS } from "@/features/staff/resume";
import type { ClassroomRow } from "@/features/owner/server/classroom-queries";
import { SectionForm, SettingsCard } from "./section-form";
import { TextField } from "./fields";
import { ClassroomManager } from "./classroom-manager";
import {
  HolidayListEditor,
  PeriodListEditor,
  ShuttleEditor,
  StringListEditor,
} from "./list-editors";

export function OperationsSection({
  initial,
  classrooms,
}: {
  initial: OperationsSettings;
  classrooms: ClassroomRow[];
}) {
  const [o, setO] = useState<OperationsSettings>(initial);
  const set = (patch: Partial<OperationsSettings>) => setO((prev) => ({ ...prev, ...patch }));

  return (
    // 강의실은 관계형 테이블(classrooms) — jsonb 설정과 달리 자체 CRUD로 즉시 저장(중첩 <form> 방지 위해 폼 밖).
    // footer로 넘겨 저장 바가 강의실 카드 아래(전체 콘텐츠 맨 끝)에 sticky로 붙게 한다(창 하단 고정).
    <SectionForm section="operations" payload={o} footer={<ClassroomManager rooms={classrooms} />}>
      {/* 운영 과목(이름·색·요일병합 + 과목별 교시·강사뷰)은 "과목 운영" 탭으로 이동 — 같은 operations 섹션에 저장.
          카드 배치는 키가 비슷한 것끼리 짝(평일|주말 = 교시 목록, 학년|직급 = 칩 목록) — 2열 그리드 빈 구멍 방지. */}
      <div className="grid items-start gap-4 xl:grid-cols-2">
      <SettingsCard
        title="평일 교시 (기본값)"
        description={
          <>
            1교시가 언제부터 언제까지인지 등 평일 수업 시간대. 과목 전용 교시가 없는 과목의 시간표 교시 축에
            적용됩니다. 과목별 교시는{" "}
            <a href="/owner?tab=subjects" className="text-primary underline underline-offset-2">
              과목 운영 탭
            </a>
            에서.
          </>
        }
      >
        <PeriodListEditor value={o.weekdayPeriods} onChange={(v) => set({ weekdayPeriods: v })} />
      </SettingsCard>

      <SettingsCard title="주말 교시" description="토·일 수업 시간대.">
        <PeriodListEditor value={o.weekendPeriods} onChange={(v) => set({ weekendPeriods: v })} />
      </SettingsCard>

      <SettingsCard title="학년 체계" description="학생 학년 선택지.">
        <StringListEditor
          value={o.gradeLevels}
          onChange={(v) => set({ gradeLevels: v })}
          placeholder="중1"
          addLabel="학년 추가"
        />
      </SettingsCard>

      <SettingsCard title="직급 (공통)" description="부서별 목록이 없을 때 쓰는 기본 직급 선택지.">
        <StringListEditor
          value={o.jobTitles}
          onChange={(v) => set({ jobTitles: v })}
          placeholder="강사"
          addLabel="직급 추가"
        />
      </SettingsCard>

      {/* 부서별 직급(2026-07-29) — 이력서에서 근무부서를 고르면 이 목록으로 직급 드롭다운이 바뀐다.
          한 부서에 직급이 하나뿐이면 부서 선택만으로 직급이 자동 확정된다(아르바이트). */}
      <SettingsCard
        title="부서별 직급"
        description="근무부서를 고르면 그 부서의 직급만 선택지로 뜹니다. 직급이 하나뿐인 부서는 자동으로 입력됩니다."
        span2
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RESUME_DEPARTMENTS.map((dept) => (
            <div key={dept} className="border-line rounded-xl border p-3">
              <p className="text-foreground mb-2 text-xs font-bold">{dept}</p>
              <StringListEditor
                value={o.jobTitlesByDepartment?.[dept] ?? []}
                onChange={(v) => set({ jobTitlesByDepartment: { ...o.jobTitlesByDepartment, [dept]: v } })}
                placeholder="직급"
                addLabel="직급 추가"
              />
            </div>
          ))}
        </div>
      </SettingsCard>

      {/* ⚠️ 학기(terms)는 소비처가 없어 v1에서 입력 숨김(상태·스키마·저장은 보존).
          성적/상담 학기 셀렉트 등 소비처가 생기면 SettingsCard만 복원. */}

      <SettingsCard
        title="공휴일·휴원일"
        description="수강료 계산 시 수업일에서 제외됩니다. 공휴일명을 함께 적으면 견적·공휴일 면에 표시됩니다."
        span2
      >
        <HolidayListEditor value={o.holidays} onChange={(v) => set({ holidays: v })} />
      </SettingsCard>

      <SettingsCard title="셔틀버스" description="공개 접수(학부모 QR) 폼에 표시되는 셔틀 신청·요금·노선. 표시를 끄면 폼에서 숨겨집니다." span2>
        <ShuttleEditor value={o.shuttle} onChange={(v) => set({ shuttle: v })} />
      </SettingsCard>

      <SettingsCard
        title="랩실 출석부 비밀번호"
        description="로그인 없이 /seat/lab 로 들어와 출결을 찍을 때 쓰는 비밀번호입니다. 비우면 공개 접속이 꺼집니다."
        span2
      >
        <TextField
          label="비밀번호"
          hint="태블릿에서 입력. 숫자만이 아니어도 됩니다."
          value={o.seatPins?.lab ?? ""}
          onChange={(lab) => set({ seatPins: { ...o.seatPins, lab } })}
          placeholder="7099"
        />
      </SettingsCard>
      </div>
    </SectionForm>
  );
}
