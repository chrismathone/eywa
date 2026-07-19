"use client";

import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/eywa-icons";
import { resolveStudyGrade } from "../curriculum";
import { subjectTone, toneSoftClass, toneSolidClass } from "../data";
import { isRowActionable, type GridRow } from "../grid";
import { parentUnreadBadge, progressAnomalyBadge } from "../roster-signals";
import type { OneScreenStudent } from "../types";
import { classnoteBadge, type SubjectReport } from "./report-card";
import { AttendancePills, type BasicAttendance } from "./attendance-pills";
import { handleGridNavKey } from "./grid-nav";
import { PillGroup } from "./pill-group";
import { ProgressSelector } from "./progress-selector";
import { ScoreInput } from "./score-input";

const TD = "border-line border-t px-2 py-1.5 align-top";
// 문구·특이사항 textarea — 내용에 따라 자동 확장(field-sizing, 미지원 브라우저는 min-h 고정 + resize-y 수동).
const AUTOSIZE = "field-sizing-content max-h-[200px] resize-y"; // Tailwind v4 내장 유틸리티

/** 필드 편집 핸들러(카드뷰와 같은 state·저장로직 공유 — studentId 파라미터 버전). */
export type GridFieldHandlers = {
  onAttendance: (studentId: string, classId: string, status: BasicAttendance) => void; // 출결 pill(2-2) — 출석부 기록에 저장
  onProgress: (studentId: string, subjectIndex: number, today: string) => void;
  onStudyGrade: (studentId: string, grade: string) => void;
  onScore: (studentId: string, which: "daily" | "check", v: number | null) => void;
  onMax: (studentId: string, which: "daily" | "check", v: number) => void;
  onAttitude: (studentId: string, a: string | null) => void;
  onHomework: (studentId: string, h: string) => void;
  onTextbook: (studentId: string, subjectName: string, text: string) => void;
  onHomeworkToday: (studentId: string, subjectName: string, text: string) => void; // 오늘 과제(0096a)
  onDraft: (studentId: string, subjectName: string, text: string) => void; // 학부모 문구(멘트) 편집
  onTrend: (studentId: string, subjectName: string, text: string) => void; // 학습 추세(종합분석) 편집(4a)
  onNote: (studentId: string, text: string) => void; // 특이사항(강사 메모) — AI 멘트 입력(4c). 학생별.
  onMakeup: (studentId: string, subjectName: string) => void; // 보강 토글
};

/** 행 단위 액션. */
export type GridRowActions = {
  onSendRow: (student: OneScreenStudent, subjectName: string) => void;
  onAutoWrite: (student: OneScreenStudent, subjectName: string) => void; // 행별 AI 멘트 자동작성
  onOpenCard: (studentId: string) => void; // 그 학생을 카드 뷰로 열기(본문·첨부·링크 편집)
  onImportPrev: (student: OneScreenStudent, subjectName: string) => void; // 이전 회차 값 → 빈 칸 채움(1-3)
};

/** 표 표시 설정(학원 설정 유래). */
export type GridConfig = {
  attitudes: readonly string[];
  homeworks: readonly string[];
  allowTestMax: boolean; // 강사 문항수 변경 허용
  dailyEnabled: boolean; // 일일테스트 사용(off면 일일 열 숨김)
  checkEnabled: boolean; // 확인테스트 사용(off면 확인 열 숨김)
};

/** 과목 진도 입력이 커리큘럼(math)인지. 미지정은 math로 간주(progress-card와 동일 규칙). */
const isMathSubject = (key: string | undefined) => (key ?? "math") === "math";

/** 진도 셀 — math면 다중 차시 ProgressSelector(edutrix 진도선택창), 그 외는 자유 텍스트. */
function GridProgressCell({
  student,
  subjectIndex,
  onProgress,
  onStudyGrade,
}: {
  student: OneScreenStudent;
  subjectIndex: number;
  onProgress: GridFieldHandlers["onProgress"];
  onStudyGrade: GridFieldHandlers["onStudyGrade"];
}) {
  const su = student.subjects[subjectIndex];
  if (!su) return null;
  if (!isMathSubject(su.subjectKey)) {
    return (
      <input
        type="text"
        value={su.today}
        onChange={(e) => onProgress(student.id, subjectIndex, e.target.value)}
        placeholder="오늘 진도 (예: Unit 8 · p.90)"
        aria-label={`${student.name} ${su.name} 오늘 진도`}
        className="border-line bg-card focus:border-primary h-8 w-full rounded-sm border px-2 text-[12px] outline-none"
      />
    );
  }
  return (
    <ProgressSelector
      value={su.today}
      onChange={(joined) => onProgress(student.id, subjectIndex, joined)}
      studyGrade={resolveStudyGrade(student.studyGrade ?? student.grade)}
      onStudyGrade={(g) => onStudyGrade(student.id, g)}
      studentGrade={student.grade}
      prev={su.prev}
      ariaLabel={`${student.name} ${su.name} 오늘 진도`}
    />
  );
}

/** 표 본문 한 행 = (학생 × 과목) 편집행. (그리드 분해 0단계 이동) */
export function GridBodyRow({
  row,
  checked,
  onToggle,
  rep,
  fields,
  actions,
  config,
  gen,
  nav,
  orderControls,
}: {
  row: GridRow;
  checked: boolean;
  onToggle: (key: string) => void;
  rep: SubjectReport | undefined;
  fields: GridFieldHandlers;
  actions: GridRowActions;
  config: GridConfig;
  // 로딩·잠금 상태 묶음: rowBusy=이 행 자동작성 중, bulk=전체 자동작성 진행중, attPending=출결 저장 중 (학생::반) 키.
  gen: { rowBusy: boolean; bulk?: boolean; attPending: ReadonlySet<string> };
  // 키보드 세로 이동(3-1) 인덱스 — **표시 순서 기준**(assembler가 buildRowRenderMeta로 부여).
  // row=과목 단위 열(교재·오늘과제), studentRow=학생 단위 열(점수 — 학생 묶음 첫 행만, 중복 칸 스킵).
  nav: { row: number; studentRow?: number };
  orderControls?: React.ReactNode; // 순서 모드(3-2) — 선택 체크박스 자리에 ↑↓(학생 묶음 첫 행만)
}) {
  const { student, subject, subjectIndex, key } = row;
  const { tone } = subjectTone(subject.name);
  const badge = classnoteBadge(rep?.classnoteStatus);
  // 로스터 신호(G2·G3) — 판정은 순수 함수(roster-signals.ts). 진도 배지는 수학 파이프라인 데이터라 math 행에만
  // (subjectKey 미지정=math 간주는 진도 입력 분기와 동일 규약, types.ts:26-29).
  const unreadBadge = parentUnreadBadge(student.parentRead);
  const isMathRow = !subject.subjectKey || subject.subjectKey === "math";
  const showProgressBadge = isMathRow && progressAnomalyBadge(student.progressSignal);
  const att = student.attendance;
  const genRowBusy = gen.rowBusy;
  const bulkGen = gen.bulk;
  const hasDraft = !!rep?.draft?.trim(); // 학부모 멘트(draft) 준비됨 — 발송 시 사용
  const canSend = isRowActionable(subject, "send"); // 진도 입력됨 + 결석 아님(2-3) — 자동작성·발송 게이트
  const isAbsent = subject.attendanceRaw === "absent";
  // 결석 행은 배경 톤으로 표시(입력은 여전히 가능=기록 보존). opacity로 전체를 흐리면 활성 입력칸이 disabled로 오인된다(#20).
  return (
    <tr className={isAbsent ? "bg-danger-soft/25 hover:bg-danger-soft/40" : "hover:bg-bg-soft/50"}>
      <td className={`${TD} text-center`}>
        {orderControls !== undefined ? (
          orderControls
        ) : (
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggle(key)}
            aria-label={`${student.name} ${subject.name} 선택`}
            className="accent-primary size-3.5 align-middle"
          />
        )}
      </td>
      <td className={TD}>
        <div className="flex items-center gap-1.5">
          <span className={`size-1.5 shrink-0 rounded-full ${toneSolidClass(tone)}`} aria-hidden />
          <span className="text-foreground font-bold">{student.name}</span>
          {student.isMakeup ? (
            <span className="bg-amber-soft text-amber shrink-0 rounded-pill px-1 py-px text-[9px] font-bold">
              보강
            </span>
          ) : null}
          {/* G3: 학부모 미확인 — 최근 추적 가능 보고서 3건+ 전부 나흘 넘게 미읽음(판정=roster-signals 순수함수).
              카피는 "미확인"(읽음 신호 커버리지 75%라 "안 읽음" 단정 금지). 모든 행에 표시(반 필터에 숨지 않게). */}
          {unreadBadge ? (
            <span
              className="bg-amber-soft text-amber shrink-0 rounded-pill px-1 py-px text-[9px] font-bold"
              title={`최근 보고서 ${unreadBadge.count}건을 학부모가 아직 확인하지 않았습니다 — 다른 경로(직접 안내 등) 확인이 필요할 수 있어요`}
            >
              학부모 미확인 {unreadBadge.count}회
            </span>
          ) : null}
          {/* G2: 진도 확인 필요 — errored 컨테이너/최근 오류 이벤트(수학 파이프라인 전용 → math 행에만).
              regression은 의도적 제외(실측 소음) — roster-signals.ts 참조. */}
          {showProgressBadge ? (
            <span
              className="bg-danger-soft text-danger shrink-0 rounded-pill px-1 py-px text-[9px] font-bold"
              title="진도 기록에 점프·겹침이 감지됐습니다 — 학생 상세 > 진도 탭에서 확인하세요"
            >
              진도 확인 필요
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className={`rounded-pill px-1.5 py-px text-[10px] font-bold ${toneSoftClass(tone)}`}>
            {subject.name}
          </span>
          <span className="text-text-faint text-[10px]">{student.tag}</span>
        </div>
        {/* 출결 인라인 입력(2-2) — 행(반) 단위. 보강(수동추가)·반 모호(같은 과목 2반)는 pill 불가 → 배지만. */}
        <div className="mt-1">
          {!student.isMakeup && subject.classId ? (
            <AttendancePills
              value={subject.attendanceRaw}
              pending={gen.attPending.has(`${student.id}::${subject.classId}`)}
              onSet={(s) => fields.onAttendance(student.id, subject.classId!, s)}
              studentName={student.name}
            />
          ) : att !== "출석" ? (
            <span
              className={`rounded-pill px-1.5 py-px text-[10px] font-bold ${
                att === "지각" ? "bg-amber-soft text-amber" : "bg-danger text-white"
              }`}
            >
              {att}
            </span>
          ) : null}
        </div>
      </td>
      <td className={TD}>
        <GridProgressCell
          student={student}
          subjectIndex={subjectIndex}
          onProgress={fields.onProgress}
          onStudyGrade={fields.onStudyGrade}
        />
      </td>
      {config.dailyEnabled ? (
        <td className={`${TD} text-center`}>
          <ScoreInput
            value={student.tests.daily.score}
            max={student.tests.daily.max}
            onChange={(v) => fields.onScore(student.id, "daily", v)}
            label={`${student.name} 일일테스트`}
            allowMax={config.allowTestMax}
            onMax={(v) => fields.onMax(student.id, "daily", v)}
            nav={nav.studentRow !== undefined ? { col: "daily", row: nav.studentRow } : undefined}
          />
        </td>
      ) : null}
      {config.checkEnabled ? (
        <td className={`${TD} text-center`}>
          <ScoreInput
            value={student.tests.check.score}
            max={student.tests.check.max}
            onChange={(v) => fields.onScore(student.id, "check", v)}
            label={`${student.name} 확인테스트`}
            allowMax={config.allowTestMax}
            onMax={(v) => fields.onMax(student.id, "check", v)}
            nav={nav.studentRow !== undefined ? { col: "check", row: nav.studentRow } : undefined}
          />
        </td>
      ) : null}
      <td className={TD}>
        {/* 1클릭 pill(edutrix 라디오 패리티) — 재클릭 해제. 드롭다운(2클릭) 폐기(1-1). */}
        <PillGroup
          size="sm"
          options={config.attitudes}
          value={student.attitude}
          onSelect={(a) => fields.onAttitude(student.id, student.attitude === a ? null : a)}
          ariaLabel={`${student.name} 태도`}
        />
      </td>
      <td className={TD}>
        <PillGroup
          size="sm"
          options={config.homeworks}
          value={student.homework || null}
          onSelect={(h) => fields.onHomework(student.id, student.homework === h ? "" : h)}
          ariaLabel={`${student.name} 과제`}
        />
      </td>
      <td className={TD}>
        <div className="flex flex-col gap-1">
          <input
            type="text"
            value={subject.textbook ?? ""}
            onChange={(e) => fields.onTextbook(student.id, subject.name, e.target.value)}
            placeholder="교재명"
            aria-label={`${student.name} ${subject.name} 교재명`}
            data-nav-col="textbook"
            data-nav-row={nav.row}
            onKeyDown={handleGridNavKey}
            className="border-line bg-card focus:border-primary h-8 w-full rounded-sm border px-2 text-[12px] outline-none"
          />
          {/* 오늘 과제(숙제 내용) — 0096a. 과제 셀렉트(수행 상태)와 별개, AI 멘트·학부모 카드 재료. */}
          <input
            type="text"
            value={subject.homeworkToday ?? ""}
            onChange={(e) => fields.onHomeworkToday(student.id, subject.name, e.target.value)}
            placeholder="오늘 과제 (예: 개념편 p10~16)"
            aria-label={`${student.name} ${subject.name} 오늘 과제`}
            data-nav-col="homeworkToday"
            data-nav-row={nav.row}
            onKeyDown={handleGridNavKey}
            className="border-line bg-card focus:border-primary h-8 w-full rounded-sm border px-2 text-[12px] outline-none"
          />
          <label className="text-text-dim flex w-fit cursor-pointer items-center gap-1 text-[11px]">
            <input
              type="checkbox"
              checked={!!subject.makeup}
              onChange={() => fields.onMakeup(student.id, subject.name)}
              className="accent-primary size-3.5"
              aria-label={`${student.name} ${subject.name} 보강`}
            />
            보강
          </label>
        </div>
      </td>
      <td className={TD}>
        {/* 특이사항(입력) + 학부모 문구(멘트) + 학습 추세 — 자동작성이 특이사항을 문장으로 풀어 씀. 우측 남는 폭 활용. */}
        <div className="flex flex-col gap-1">
          <textarea
            value={student.note ?? ""}
            onChange={(e) => fields.onNote(student.id, e.target.value)}
            placeholder="특이사항(메모) · 예: 조퇴함 / 개념 어려워함"
            aria-label={`${student.name} 특이사항`}
            className={`border-amber/40 focus:border-primary scrollbar-thin min-h-[40px] w-full rounded-sm border bg-amber-soft/30 px-2 py-1 text-[11px] leading-snug outline-none ${AUTOSIZE}`}
          />
          <textarea
            value={rep?.draft ?? ""}
            onChange={(e) => fields.onDraft(student.id, subject.name, e.target.value)}
            placeholder={genRowBusy ? "자동작성 중…" : "'자동작성'으로 생성 · 직접 편집·확인 후 발송"}
            aria-label={`${student.name} ${subject.name} 학부모 문구`}
            className={`border-line focus:border-primary scrollbar-thin min-h-[72px] w-full rounded-sm border bg-background px-2 py-1 text-[11px] leading-snug outline-none ${AUTOSIZE}`}
          />
          <textarea
            value={rep?.trendDraft ?? ""}
            onChange={(e) => fields.onTrend(student.id, subject.name, e.target.value)}
            placeholder="학습 추세(종합분석) · 기록 적으면 비어 있음"
            aria-label={`${student.name} ${subject.name} 학습 추세`}
            className={`border-line focus:border-primary scrollbar-thin min-h-[48px] w-full rounded-sm border bg-bg-soft px-2 py-1 text-[11px] leading-snug outline-none ${AUTOSIZE}`}
          />
        </div>
      </td>
      <td className={TD}>
        <div className="flex flex-col items-stretch gap-1">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => actions.onAutoWrite(student, subject.name)}
              disabled={genRowBusy || bulkGen || !canSend}
              title={
                canSend
                  ? "AI 학부모 멘트 자동작성 (발송 문구)"
                  : isAbsent
                    ? "결석 학생 — 발송 제외 (기록 저장은 가능)"
                    : "오늘 진도를 먼저 입력하세요"
              }
              className={`border-line hover:bg-bg-soft flex-1 rounded-sm border px-1 py-1 text-[11px] font-bold disabled:opacity-50 ${
                hasDraft ? "text-primary" : "text-text-dim"
              }`}
            >
              {genRowBusy ? (
                "…"
              ) : hasDraft ? (
                <span className="inline-flex items-center justify-center gap-0.5">
                  <EyIcon name="check" size={11} /> 멘트
                </span>
              ) : (
                "자동작성"
              )}
            </button>
            <button
              type="button"
              onClick={() => actions.onOpenCard(student.id)}
              title="카드로 열어 본문·첨부·링크 편집"
              className="border-line text-text-dim hover:bg-bg-soft shrink-0 rounded-sm border px-1.5 py-1 text-[11px] font-bold"
            >
              카드
            </button>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!canSend || bulkGen}
            title={
              bulkGen
                ? "전체 자동작성 중 — 완료 후 발송"
                : !canSend && isAbsent
                  ? "결석 학생 — 발송 제외 (기록 저장은 가능)"
                  : undefined
            }
            onClick={() => actions.onSendRow(student, subject.name)}
          >
            발송
          </Button>
          {badge ? (
            <span className={`text-center text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
