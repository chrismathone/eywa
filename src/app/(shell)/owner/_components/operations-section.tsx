"use client";

import { withEmbed } from "@/components/workspace/embed-context";
import { useModuleOn } from "@/features/owner/operations-context";
import { useInFrame } from "@/components/workspace/use-in-frame";
import type { OperationsSettings } from "@/features/owner/settings-types";
import { RESUME_DEPARTMENTS } from "@/features/staff/resume/resume";
import type { ClassroomRow } from "@/features/owner/server/classroom-queries";
import { SectionForm, SettingsCard } from "./section-form";
import { useSectionDraft } from "./use-section-draft";
import type { SeatPinStatus } from "@/features/owner/seat-pin-view";
import { SeatPinField, SeatPinStatusRow } from "./seat-pin-field";
import { ClassroomManager } from "./classroom-manager";
import {
  HolidayListEditor,
  PeriodListEditor,
  ShuttleEditor,
  StringListEditor,
} from "./list-editors";

const SUBJECTS_TAB = "/owner?tab=subjects";

export function OperationsSection({
  initial,
  classrooms,
  canImportClassrooms = false,
  readOnly = false,
  seatPinStatus,
  baselineToken,
  baselineVersion,
}: {
  /**
   * 🔴 읽기 전용 열람자에게는 **자리 PIN 값이 지워진** 사본이 온다(서버 `operationsForViewer`) — 이 객체는 통째로
   *    폼의 숨은 입력(JSON)에 실리므로, 값을 여기서 가리는 것으로는 부족하다. 편집자는 실제 값을 받는다.
   */
  initial: OperationsSettings;
  classrooms: ClassroomRow[];
  /** 강의실 엑셀로 넣기 버튼 — 서버가 canManageTenant(owner)로 정한 값. */
  canImportClassrooms?: boolean;
  /** 운영 설정 저장 권한이 없는 열람자 — 저장 바가 없고 자리 PIN 칸 대신 '설정됨 / 꺼짐'만 선다. */
  readOnly?: boolean;
  /** 자리별 공개 접속이 켜져 있는가(값 없이) — 읽기 전용 화면이 그리는 유일한 PIN 정보. */
  seatPinStatus?: SeatPinStatus;
  /**
   * 이 면(운영 체계)이 맡는 값의 기준 token — 서버가 **저장할 수 있는 사람에게만** 내려준다(자리 PIN에서 나온 값이다).
   * 저장 요청에 실려, 그사이 같은 면이 다른 곳에서 바뀌었으면 저장이 거절된다.
   */
  baselineToken?: string;
  /** 이 값을 읽은 문서의 저장 순번 — 내 저장보다 먼저 읽힌 값이 뒤늦게 내려와도 받지 않는다(useSectionDraft). */
  baselineVersion?: number;
}) {
  // 🔴 저장은 이 면이 맡는 칸만 반영된다(과목·시간표 칸은 서버가 방금 읽은 값을 그대로 둔다 — operations-slice.ts).
  const { draft: o, setDraft: setO, baseline, noteSubmitted, confirmSaved, noteSaveFailed, adoptions } =
    useSectionDraft(initial, baselineToken, baselineVersion);
  const set = (patch: Partial<OperationsSettings>) => setO((prev) => ({ ...prev, ...patch }));
  const shuttleOn = useModuleOn("shuttle");
  const seatOn = useModuleOn("seat_attendance");
  const inFrame = useInFrame();

  return (
    // 강의실은 관계형 테이블(classrooms) — jsonb 설정과 달리 자체 CRUD로 즉시 저장(중첩 <form> 방지 위해 폼 밖).
    // footer로 넘겨 저장 바가 강의실 카드 아래(전체 콘텐츠 맨 끝)에 sticky로 붙게 한다(창 하단 고정).
    <SectionForm
      section="operations"
      payload={o}
      readOnly={readOnly}
      extraFields={{ operationsFace: "operations", operationsBaseline: baseline }}
      onSubmit={noteSubmitted}
      onSaved={(state) => confirmSaved(state.operations?.tokens.operations, state.version)}
      onSaveFailed={noteSaveFailed}
      rebaselineNonce={adoptions}
      footer={<ClassroomManager rooms={classrooms} canImport={canImportClassrooms} readOnly={readOnly} />}
    >
      {/* 운영 과목(이름·색·요일병합 + 과목별 교시·강사뷰)은 "과목 운영" 탭으로 이동 — 같은 operations 섹션에 저장.
          카드 배치는 키가 비슷한 것끼리 짝(평일|주말 = 교시 목록, 학년|직급 = 칩 목록) — 2열 그리드 빈 구멍 방지. */}
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 min-[860px]:grid-cols-2 [&>section]:min-w-0 [&>section[data-span-all]]:col-span-full">
      <SettingsCard
        title="평일 교시 (기본값)"
        description={
          <>
            1교시가 언제부터 언제까지인지 등 평일 수업 시간대. 과목 전용 교시가 없는 과목의 시간표 교시 축에
            적용됩니다. 과목별 교시는{" "}
            {/* 🔴 `<Link>`가 아니라 맨 `<a>`(하드 이동)다 — 이 폼의 미저장 가드(useUnsavedGuard)는 `beforeunload`로
                이탈을 막는데 소프트 이동은 그걸 안 거쳐 적던 교시가 말없이 날아간다. 대신 창 안이면 embed=1을
                싣는다(빼면 학원 설정 창 안에 전체 셸이 뜬다 — 원생 삭제와 같은 규칙, 전수검사 2026-09-11). */}
            <a
              href={inFrame ? withEmbed(SUBJECTS_TAB) : SUBJECTS_TAB}
              className="text-primary underline underline-offset-2"
            >
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
        description="수강료 계산 시 수업일에서 제외됩니다. 이 목록에 있는 날은 오늘 출결의 예정 명단과 확인 큐도 만들지 않습니다(수업하는 날은 목록에서 빼 주세요). 공휴일명을 함께 적으면 견적·공휴일 면에 표시됩니다."
        span2
        collapsible
        summary={`${o.holidays.length}일`}
      >
        <HolidayListEditor value={o.holidays} onChange={(v) => set({ holidays: v })} />
      </SettingsCard>

      {/* 꺼진 기능(셔틀·자리 출석부)의 카드는 세우지 않는다(2026-09-30 "꺼지면 흔적 없이") — 값은 state에 그대로 남아
          저장해도 지워지지 않는다(섹션 저장은 o 전체를 싣는다). */}
      {shuttleOn ? (
        <SettingsCard title="셔틀버스" description="공개 접수(학부모 QR) 폼에 표시되는 셔틀 신청·요금·노선. 표시를 끄면 폼에서 숨겨집니다." span2>
          <ShuttleEditor value={o.shuttle} onChange={(v) => set({ shuttle: v })} />
        </SettingsCard>
      ) : null}

      {/* 자리별로 비밀번호가 따로다 — 한 자리를 닫아도 다른 자리는 열려 있어야 하고, 담당자가 서로 다르다. */}
      {seatOn ? (
      <SettingsCard
        title="자리 출석부 비밀번호"
        description="로그인 없이 태블릿으로 들어와 그 자리 오늘 출결을 찍을 때 쓰는 비밀번호입니다. 비우면 그 자리 공개 접속이 꺼집니다."
        span2
      >
        {readOnly ? (
          // 🔴 읽기 전용 = 값이 없다(서버가 지우고 보냈다). 칸을 세우지 않고 켜짐 여부만 적는다.
          <div className="grid gap-3 sm:grid-cols-2">
            <SeatPinStatusRow label="랩실(603호)" on={seatPinStatus?.lab ?? false} />
            <SeatPinStatusRow label="JJ실(305호)" on={seatPinStatus?.jj ?? false} />
          </div>
        ) : (
          // 기본 마스킹 + 자동완성 방지(SeatPinField) — 저장해 둔 로그인 비밀번호가 이 칸에 채워지면 안 된다.
          <div className="grid gap-3 sm:grid-cols-2">
            <SeatPinField
              label="랩실(603호) 비밀번호"
              hint="주소 /seat/lab · 숫자만이 아니어도 됩니다."
              value={o.seatPins?.lab ?? ""}
              onChange={(lab) => set({ seatPins: { ...o.seatPins, lab } })}
            />
            <SeatPinField
              label="JJ실(305호) 비밀번호"
              hint="주소 /seat/jj · 비우면 이 자리만 꺼집니다."
              value={o.seatPins?.jj ?? ""}
              onChange={(jj) => set({ seatPins: { ...o.seatPins, jj } })}
            />
          </div>
        )}
      </SettingsCard>
      ) : null}
      </div>
    </SectionForm>
  );
}
