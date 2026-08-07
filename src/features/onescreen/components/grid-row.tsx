"use client";

import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/eywa-icons";
import { TEXTAREA_AUTOSIZE_RESIZABLE } from "@/lib/ui/textarea";
import { joinComment, splitComment } from "../comment-paragraphs";
import { resolveStudyGrade } from "../curriculum";
import { subjectTone, toneSoftClass, toneSolidClass } from "../data";
import {
  effectiveClassnoteStatus,
  isAlreadySent,
  isReportEligible,
  isRowInputEditable,
  isRowActionable,
  type GridRow,
} from "../grid";
import { evaluateSendGate } from "../send-gate";
import { checkMentConsistency, MENT_WARNING_HINT, MENT_WARNING_LABEL } from "../ment-consistency";
import { parentUnreadBadge, progressAnomalyBadge } from "../roster-signals";
import { makeupBadgeLabel } from "../makeup-label";
import type { OneScreenStudent } from "../types";
import { classnoteBadge, readAtLabel, type SubjectReport } from "./report-card";
import { GridAttachButton, useRowFileDrop } from "./grid-attach";
import {
  AttendancePills,
  SessionUnitsField,
  type AttendanceExtra,
  type BasicAttendance,
} from "./attendance-pills";
import { handleGridNavKey } from "./grid-nav";
import { FieldSelect } from "./field-select";
import { HomeworkRateInput } from "./homework-rate-input";
import { ProgressModePills } from "./progress-mode-pills";
import { ProgressSelector } from "./progress-selector";
import { ScoreInput } from "./score-input";

const TD_BASE = "px-2 py-1.5 align-top";
// 학생 묶음 구분선 — 묶음 첫 행(참고행이 꺼져 있을 때는 이 행)의 위쪽만 굵고 진한 회색.
// ⚠️ `border-t`(1px)와 `border-t-2`를 한 className에 같이 두지 말 것 — 둘 다 border-top-width라
//    어느 쪽이 이기는지 생성 CSS 순서에 달린다. 아예 다른 상수로 갈라 충돌 자체를 없앤다.
const TD = `border-line border-t ${TD_BASE}`;
const TD_GROUP = `border-t-2 border-t-text-faint/50 ${TD_BASE}`;
// 문구·특이사항 textarea — 내용에 따라 자동 확장(공용 상수, 미지원 브라우저는 각 칸의 min-h가 폴백).
// 표 모드는 좁은 칸이 여러 개라 손잡이를 남기는 변형을 쓴다(폼 입력칸은 손잡이 없는 TEXTAREA_AUTOSIZE).
const AUTOSIZE = TEXTAREA_AUTOSIZE_RESIZABLE;

/** 필드 편집 핸들러(카드뷰와 같은 state·저장로직 공유 — studentId 파라미터 버전). */
export type GridFieldHandlers = {
  // 출결 pill(2-2) — 출석부 기록에 저장. extra=지각·결석 사유 메모·수업타임(2026-08-05, 같은 행 한 왕복).
  onAttendance: (
    studentId: string,
    classId: string,
    status: BasicAttendance,
    extra?: AttendanceExtra,
  ) => void;
  onProgress: (studentId: string, subjectIndex: number, today: string) => void;
  /** 오늘 수업 성격(복습·문제풀이) — 진도와 함께 사는 별개 축(progress-mode.ts). */
  onProgressMode: (studentId: string, subjectIndex: number, mode: string | null) => void;
  onStudyGrade: (studentId: string, grade: string) => void;
  onScore: (studentId: string, which: "daily" | "check", v: number | null) => void;
  onMax: (studentId: string, which: "daily" | "check", v: number) => void;
  // ⚠️ 모드 전환(onMode)은 그리드에 없다 — 열이 88px 고정이라 셀이 넘친다(2026-07-24). 카드(TestCard)에서만 전환.
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
  // 첨부(표 모드) — 클립 팝오버·행 드롭이 공유. 게이트(진도 미입력)·저장보장은 부모 핸들러가 담당.
  onAttach: (student: OneScreenStudent, subjectName: string, files: File[]) => void;
  onRemoveAttachment: (student: OneScreenStudent, subjectName: string, path: string) => void;
  onOpenAttachments: (student: OneScreenStudent, subjectName: string) => void; // 팝오버 열 때 썸네일 서명
};

/** 표 표시 설정(학원 설정 유래). */
export type GridConfig = {
  attitudes: readonly string[];
  allowTestMax: boolean; // 강사 문항수 변경 허용
  dailyEnabled: boolean; // 일일테스트 사용(off면 일일 열 숨김)
  checkEnabled: boolean; // 확인테스트 사용(off면 확인 열 숨김)
  attachmentUrls: Record<string, string>; // 첨부 path→signed 썸네일 URL(팝오버 열 때 채워진다)
  attachmentsHidden?: boolean; // 학원설정 '사진/파일 첨부' OFF — 첨부해도 학부모에게 안 실린다는 고지
  // 멘트 모드 — 상단 토글(학원 기본 / 단일 A / 2문단 B)의 실효값. 카드 모드와 **같은 편집 계약**을 쓰려고
  // 표 모드에도 내린다. B면 학부모 문구 칸이 2칸(수업 내용 / 태도·특이사항)으로 갈라진다.
  // ⚠️ 없으면 "A"로 보지 말 것 — 토글을 B로 둔 강사가 표 모드에서만 한 칸을 보게 된다(2026-07-21 원장 제보).
  noticeMode: "A" | "B";
};

/** 과목 진도 입력이 커리큘럼(math)인지. 미지정은 math로 간주(progress-card와 동일 규칙). */
const isMathSubject = (key: string | undefined) => (key ?? "math") === "math";

/** 진도 셀 — math면 다중 차시 ProgressSelector(edutrix 진도선택창), 그 외는 자유 텍스트. */
function GridProgressCell({
  student,
  subjectIndex,
  onProgress,
  onProgressMode,
  onStudyGrade,
  locked,
}: {
  student: OneScreenStudent;
  subjectIndex: number;
  onProgress: GridFieldHandlers["onProgress"];
  onProgressMode: GridFieldHandlers["onProgressMode"];
  onStudyGrade: GridFieldHandlers["onStudyGrade"];
  /** 발송 완료 또는 결석 — 수정 금지(읽기 전용). 판정은 `isRowInputEditable` 단일 소스. */
  locked?: boolean;
}) {
  const su = student.subjects[subjectIndex];
  if (!su) return null;
  if (!isMathSubject(su.subjectKey)) {
    // 자유 입력 과목(영어 등) — 커리큘럼 팝오버가 없어 성격 알약을 **입력칸 바로 아래**에 둔다
    // (원장 2026-08-07 *"영어 진도에도 복습·문제풀이 붙여줘"*). 알약은 수학 팝오버 안과 같은 컴포넌트.
    return (
      <div className="flex flex-col gap-1">
        {/* 🔴 한 줄 `<input>`은 개행을 **뭉갠다**(ECS 시트 초안은 교시마다 줄이 하나 — "Vocab 41 42Reading…").
            표는 행 높이가 곧 밀도라 카드처럼 늘릴 수 없으니 **한 줄 높이 textarea**로 둔다: 첫 줄이 보이고
            나머지는 셀 안에서 스크롤·툴팁으로 확인한다(값은 그대로, 붙어 보이지만 않게). */}
        <textarea
          rows={1}
          value={su.today}
          onChange={(e) => onProgress(student.id, subjectIndex, e.target.value)}
          readOnly={locked}
          placeholder="오늘 진도 (예: Unit 8 · p.90)"
          aria-label={`${student.name} ${su.name} 오늘 진도`}
          title={su.today.includes("\n") ? su.today : undefined}
          className={`border-line focus:border-primary scrollbar-thin h-8 w-full resize-none rounded-sm border px-2 py-[0.3rem] text-[12px] leading-[1.2] outline-none ${
            locked ? "bg-bg-soft text-text-dim" : "bg-card"
          }`}
        />
        <ProgressModePills
          mode={su.progressMode}
          onMode={(m) => onProgressMode(student.id, subjectIndex, m)}
          disabled={locked}
          compact
          ariaLabel={`${student.name} ${su.name} 오늘 수업 성격`}
        />
      </div>
    );
  }
  return (
    <ProgressSelector
      value={su.today}
      onChange={(joined) => onProgress(student.id, subjectIndex, joined)}
      mode={su.progressMode}
      onMode={(m) => onProgressMode(student.id, subjectIndex, m)}
      studyGrade={resolveStudyGrade(student.studyGrade ?? student.grade)}
      onStudyGrade={(g) => onStudyGrade(student.id, g)}
      studentGrade={student.grade}
      prev={su.prev}
      locked={locked}
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
  groupStart = false,
}: {
  row: GridRow;
  checked: boolean;
  onToggle: (key: string) => void;
  rep: SubjectReport | undefined;
  fields: GridFieldHandlers;
  actions: GridRowActions;
  config: GridConfig;
  // 로딩·잠금 상태 묶음: rowBusy=이 행 자동작성 중, bulk=전체 자동작성 진행중, attPending=출결 저장 중 (학생::반) 키.
  gen: {
    rowBusy: boolean;
    bulk?: boolean;
    attPending: ReadonlySet<string>;
    attReadOnly?: boolean; // 출결 쓰기 권한 없음 — pill 비활성
    uploadingKey?: string | null; // 첨부 업로드 중인 행 키
  };
  // 키보드 세로 이동(3-1) 인덱스 — **표시 순서 기준**(assembler가 buildRowRenderMeta로 부여).
  // row=과목 단위 열(교재·오늘과제), studentRow=학생 단위 열(점수 — 학생 묶음 첫 행만, 중복 칸 스킵).
  nav: { row: number; studentRow?: number };
  orderControls?: React.ReactNode; // 순서 모드(3-2) — 선택 체크박스 자리에 ↑↓(학생 묶음 첫 행만)
  groupStart?: boolean; // 학생 묶음의 첫 렌더 행 — 위쪽에 굵은 구분선(참고행이 켜져 있으면 그쪽이 받는다)
}) {
  const { student, subject, subjectIndex, key } = row;
  const td = groupStart ? TD_GROUP : TD; // 학생 구분선(묶음 첫 행만 굵게)
  const { tone } = subjectTone(subject.name);
  const badge = classnoteBadge(rep?.classnoteStatus);
  // 로스터 신호(G2·G3) — 판정은 순수 함수(roster-signals.ts). 진도 배지는 수학 파이프라인 데이터라 math 행에만
  // (subjectKey 미지정=math 간주는 진도 입력 분기와 동일 규약, types.ts:26-29).
  const isMathRow = !subject.subjectKey || subject.subjectKey === "math";
  const showProgressBadge = isMathRow && progressAnomalyBadge(student.progressSignal);
  // 학부모 읽음(G3)도 같은 게이트 — RPC가 학생의 **모든** 보고서를 세는데 발송분이 아직 전부 수학이라
  // (subject='english' 0건, 2026-07-29) 영어 행에 달면 "이 영어 보고서가 미확인"으로 읽힌다(거짓).
  const unreadBadge = isMathRow ? parentUnreadBadge(student.parentRead) : null;
  const att = student.attendance;
  const genRowBusy = gen.rowBusy;
  // 모드 B 편집용 분리값 — 라운드트립 불변식(split(join)===원본)은 comment-paragraphs가 보장.
  const draftParas = splitComment(rep?.draft ?? "");
  const bulkGen = gen.bulk;
  const hasDraft = !!rep?.draft?.trim(); // 학부모 멘트(draft) 준비됨 — 발송 시 사용
  // ⚠️ 화면 state(rep)의 상태가 로스터 스냅샷을 이긴다 — 방금 보낸 행을 계속 '발송 가능'으로 두면 중복 게시.
  // ⚠️ `??` 금지 — 재발급·첨부변경이 명시적으로 지운(null) 상태를 스냅샷의 옛 "success"가 덮는다.
  const liveStatus = effectiveClassnoteStatus(rep?.classnoteStatus, subject.classnoteStatus);
  const alreadySent = isAlreadySent(liveStatus);
  // 발송 게이트 = **단일 소스**(send-gate.ts) — 버튼 disabled·title·아래 라벨이 같은 판정을 쓴다.
  // ⚠️ 멘트 미작성도 여기서 막는다: 빈 멘트 절대 가드(2026-07-28)가 어차피 sendRow에서 거절하므로,
  //    버튼만 살려 두면 눌러 보고서야 이유를 아는 거짓 어포던스다(원장 2026-07-30 제보의 핵심).
  const sendGate = evaluateSendGate({
    alreadySent,
    isAbsent: subject.attendanceRaw === "absent",
    hasProgress: isReportEligible(subject),
    hasDraft: !!rep?.draft?.trim(),
  });
  const canSend = sendGate.canSend;
  // 멘트와 기록 칸이 서로 다른 말을 하는지(시험날 진도·멘트에만 있는 점수) — **막지 않고 알린다**.
  // 학부모 카드엔 멘트와 기록이 나란히 보이므로 어긋나면 학부모가 두 사실을 동시에 받는다(2026-07-30 감사).
  const mentWarnings = checkMentConsistency({
    ment: rep?.draft ?? "",
    progress: subject.today ?? "",
    dailyTest: student.tests.daily.score != null ? "y" : "",
    checkTest: student.tests.check.score != null ? "y" : "",
  });
  // 발송 완료건은 자동작성도 막는다 — 멘트를 새로 만들어 봐야 저장이 서버에서 거부된다(입력 유실).
  const canAutoWrite = isRowActionable(subject, "autowrite", liveStatus);
  const isAbsent = subject.attendanceRaw === "absent";
  /**
   * 이 행의 **보고서 입력 전체**를 잠그나 — 발송 완료 또는 결석(`isRowInputEditable` 단일 소스).
   *
   * 🔴 2026-08-07 확대: 처음엔 멘트·추세만 잠갔는데 원장 제보 *"결석을 눌렀는데 진도 같은거 전부다
   *    적을 수 있던데?"* — 결석은 그 학생이 그 수업에 **없었던** 것이라 진도·테스트·태도·과제도
   *    일어나지 않은 일이다. 발송물만이 아니라 기록 칸도 함께 잠근다(카드 모드와 같은 판정).
   * 🔴 단 **출결 알약·수업타임·결석 사유는 잠그지 않는다** — 잘못 누른 결석을 되돌릴 유일한 문이고,
   *    결석한 날에도 사유·시수는 남겨야 할 기록이다(grid.ts 주석 참조).
   * ⚠️ 잠금은 행 전체를 흐리는 방식이 아니다(gotcha #20) — 잠긴 칸만 톤을 바꾸고 이유를 밝힌다.
   */
  const rowLocked = !isRowInputEditable(subject, liveStatus);
  /** 잠긴 칸 묶음(td 안에서만 쓴다 — tr의 자식은 td여야 하므로 행 전체를 fieldset으로 감쌀 수 없다). */
  const LOCK_FS =
    "contents [&_input:disabled]:opacity-50 [&_textarea:disabled]:opacity-50 [&_button:disabled]:opacity-50 [&:disabled_*]:cursor-not-allowed";
  const mentPlaceholder = isAbsent ? "결석 — 학부모 문구는 발송되지 않습니다" : null;
  /** 특이사항 자리 — 막기만 하지 말고 **갈 곳**을 알려준다(결석 사유는 출결 알약 안에 적는 칸이 있다). */
  const rowPlaceholder = isAbsent ? "결석 — 사유는 왼쪽 출결에서 적어 주세요" : null;
  const mentBase =
    "border-line focus:border-primary scrollbar-thin w-full rounded-sm border px-2 py-1 text-[11px] leading-snug outline-none";
  const lockedTone = isAbsent ? "bg-bg-soft text-text-faint cursor-not-allowed" : "";
  // 파일을 행 위에 놓으면 그 행에 바로 첨부(가장 빠른 경로). 진도 미입력 등 게이트는 부모 핸들러가 안내한다.
  // 발송 완료건은 파일을 행에 떨어뜨려도 첨부되지 않는다(위 버튼 잠금과 같은 이유).
  const drop = useRowFileDrop((files) => {
    if (rowLocked) return;
    actions.onAttach(student, subject.name, files);
  });
  // 결석 행은 배경 톤으로도 표시 — 잠긴 칸(disabled)만으로는 "왜 안 써지지"가 되기 쉽다.
  // ⚠️ 행 전체에 opacity를 걸지는 않는다(#20) — 출결·수업타임은 살아 있는 입력이라 함께 흐리면 안 된다.
  return (
    <tr
      {...drop.handlers}
      className={
        drop.over
          ? "outline-primary bg-primary-soft/40 outline-2 -outline-offset-2" // 드롭 대상 강조
          : isAbsent
            ? "bg-danger-soft/25 hover:bg-danger-soft/40"
            : "hover:bg-bg-soft/50"
      }
    >
      <td className={`${td} text-center`}>
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
      <td className={td}>
        {/* 🔴 이름이 배지에 밀려 글자 사이에서 줄바꿈되던 자리(2026-07-30 원장 제보: "김지연"이 "김지/연").
            이 칸은 고정 폭(128px)인데 배지(보강·학부모 미확인·진도 확인 필요)가 전부 `shrink-0`이라
            **줄어들 수 있는 유일한 요소가 이름**이었다 → 배지가 뜨는 행에서만 이름이 찌그러졌다.
            이름을 `shrink-0 whitespace-nowrap`으로 잠그고 컨테이너를 `flex-wrap`으로 바꿔
            **배지가 다음 줄로 내려가게** 한다(이름은 항상 한 덩이). */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className={`size-1.5 shrink-0 rounded-full ${toneSolidClass(tone)}`} aria-hidden />
          <span className="text-foreground shrink-0 font-bold whitespace-nowrap">{student.name}</span>
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
        {/* ⚠️ 알약엔 **과목 라벨만** 칠한다(원장 2026-07-23 제보: "하나는 수학만 파란 배경, 나머지는 반 전체가
            파란 배경"). `subject.name`은 같은 과목 두 반일 때 로스터가 반 이름을 이어 붙인 **유일화 라벨**이라
            그대로 칠하면 알약이 반 이름까지 삼켜 행마다 폭·모양이 달라진다. 반 이름은 학년 태그와 같은 톤으로 밖에. */}
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className={`rounded-pill px-1.5 py-px text-[10px] font-bold ${toneSoftClass(tone)}`}>
            {subject.subjectLabel || subject.name}
          </span>
          {/* 병합된 보강 행(classId 없음·makeup) — 알약엔 순수 과목 라벨('수학')만 칠해 정규 행과 똑같아 보이므로,
              행 단위 '보강' 배지로 구분한다(2026-07-24). 정규 반에 보강 토글만 켠 행(classId 있음)은 대상 아님.
              🔴 **학생 자체가 보강 추가분(isMakeup)이면 여기선 안 붙인다** — buildMakeupStudent가 학생에
                 `isMakeup`, 모든 과목 행에 `makeup:true`(classId 없음)를 함께 세워서 위 이름 옆 배지와
                 **같은 '보강'이 두 번** 찍혔다(원장 제보 2026-08-05). 이 배지의 존재 이유는 "정규 학생 카드에
                 섞여 들어온 보강 행"을 가르는 것이라, 학생 전체가 보강이면 이름 옆 배지 하나로 충분하다. */}
          {/* 반이 붙은 행의 보강 = 그날 정규까지 한 "정규+보강"(2026-08-05 합치기) — 라벨을 갈라 적어야
              강사가 "왜 보강인데 보고서가 하나지?"를 화면에서 바로 이해한다. 판정은 makeup-label.ts 단일 소스. */}
          {subject.makeup && !student.isMakeup ? (
            <span className="bg-amber-soft text-amber shrink-0 rounded-pill px-1 py-px text-[9px] font-bold">
              {makeupBadgeLabel({ makeup: true, hasClass: !!subject.classId })}
            </span>
          ) : null}
          {subject.subjectLabel && subject.name !== subject.subjectLabel && subject.className ? (
            <span className="text-text-faint text-[10px]">{subject.className}</span>
          ) : null}
          <span className="text-text-faint text-[10px]">{student.tag}</span>
        </div>
        {/* 출결 인라인 입력(2-2) — 행(반) 단위. 보강(수동추가)·반 모호(같은 과목 2반)는 pill 불가 → 배지만. */}
        <div className="mt-1">
          {!student.isMakeup && subject.classId ? (
            <AttendancePills
              value={subject.attendanceRaw}
              note={subject.attendanceNote}
              units={subject.attendanceUnits}
              pending={gen.attPending.has(`${student.id}::${subject.classId}`)}
              onSet={(s, extra) => fields.onAttendance(student.id, subject.classId!, s, extra)}
              studentName={student.name}
              readOnly={gen.attReadOnly}
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
      {/* 수업타임(시수) — **전용 열**(원장 2026-08-05 "타임이 너무 작다"). 이름칸 안에서 pill과 자리를
          다투면 계속 작아진다. 기록할 자리가 없는 행(보강·반 모호)은 왜 없는지 밝힌다(빈 칸 금지). */}
      <td className={`${td} text-center`}>
        {!student.isMakeup && subject.classId && !gen.attReadOnly ? (
          <SessionUnitsField
            units={subject.attendanceUnits}
            status={(subject.attendanceRaw as BasicAttendance | null | undefined) ?? null}
            pending={gen.attPending.has(`${student.id}::${subject.classId}`)}
            onSet={(s, extra) => fields.onAttendance(student.id, subject.classId!, s, extra)}
            studentName={student.name}
            size="lg"
          />
        ) : (
          <span
            className="text-text-faint text-[13px]"
            title={
              gen.attReadOnly
                ? "출결 입력 권한이 없어 수업타임을 고칠 수 없습니다"
                : "이 행은 반이 없어 출석부에 기록할 자리가 없습니다 — 수업타임은 출석부에서 입력하세요"
            }
          >
            —
          </span>
        )}
      </td>
      <td className={td}>
        <GridProgressCell
          student={student}
          subjectIndex={subjectIndex}
          onProgress={fields.onProgress}
          onProgressMode={fields.onProgressMode}
          onStudyGrade={fields.onStudyGrade}
          locked={rowLocked}
        />
      </td>
      {/* 점수·태도·과제 칸은 자체 잠금 prop이 없다 → **td 안에서** fieldset으로 묶어 잠근다(카드 모드와 같은 방식).
          ⚠️ `<tr>`의 자식은 `<td>`여야 해서 행 전체를 fieldset으로 감쌀 수 없다 — 칸마다 감싼다.
          ⚠️ `contents`라 레이아웃은 그대로(칸 정렬·폭 불변). */}
      {config.dailyEnabled ? (
        <td className={`${td} text-center`}>
          <fieldset disabled={rowLocked} className={LOCK_FS}>
            <ScoreInput
              value={student.tests.daily.score}
              max={student.tests.daily.max}
              onChange={(v) => fields.onScore(student.id, "daily", v)}
              label={`${student.name} 일일테스트`}
              allowMax={config.allowTestMax}
              onMax={(v) => fields.onMax(student.id, "daily", v)}
              mode={student.tests.daily.mode}
              nav={nav.studentRow !== undefined ? { col: "daily", row: nav.studentRow } : undefined}
            />
          </fieldset>
        </td>
      ) : null}
      {config.checkEnabled ? (
        <td className={`${td} text-center`}>
          <fieldset disabled={rowLocked} className={LOCK_FS}>
            <ScoreInput
              value={student.tests.check.score}
              max={student.tests.check.max}
              onChange={(v) => fields.onScore(student.id, "check", v)}
              label={`${student.name} 확인테스트`}
              allowMax={config.allowTestMax}
              onMax={(v) => fields.onMax(student.id, "check", v)}
              mode={student.tests.check.mode}
              nav={nav.studentRow !== undefined ? { col: "check", row: nav.studentRow } : undefined}
            />
          </fieldset>
        </td>
      ) : null}
      <td className={td}>
        {/* 원장 2026-07-23: 알약 → 드롭다운. 선택지가 늘어(과제 '없음' 추가) 표 가로가 터졌다. */}
        <fieldset disabled={rowLocked} className={LOCK_FS}>
          <FieldSelect
            radius="sm"
            options={config.attitudes}
            value={student.attitude}
            onSelect={(a) => fields.onAttitude(student.id, a)}
            ariaLabel={`${student.name} 태도`}
          />
        </fieldset>
      </td>
      <td className={td}>
        {/* 과제 수행률 — 숫자 칸 + % (드롭다운 폐지, 원장 2026-08-03). 옆 일일·확인 점수칸과 같은 모양. */}
        <fieldset disabled={rowLocked} className={LOCK_FS}>
          <HomeworkRateInput
            value={student.homework}
            onChange={(h) => fields.onHomework(student.id, h)}
            label={`${student.name} 과제 수행률`}
            nav={{ col: "homework", row: nav.row }}
          />
        </fieldset>
      </td>
      <td className={td}>
        <div className="flex flex-col gap-1">
          <input
            type="text"
            value={subject.textbook ?? ""}
            onChange={(e) => fields.onTextbook(student.id, subject.name, e.target.value)}
            readOnly={rowLocked}
            placeholder="교재명"
            aria-label={`${student.name} ${subject.name} 교재명`}
            data-nav-col="textbook"
            data-nav-row={nav.row}
            onKeyDown={handleGridNavKey}
            className="border-line bg-card focus:border-primary h-8 w-full rounded-sm border px-2 text-[12px] outline-none"
          />
          {/* 오늘 과제(숙제 내용) — 0096a. 과제 셀렉트(수행 상태)와 별개, AI 멘트·학부모 카드 재료. */}
          {/* 진도 셀과 같은 처방 — 시트 초안은 교시마다 과제가 있어 한 줄 input이면 붙어 보인다(2026-08-07). */}
          <textarea
            rows={1}
            value={subject.homeworkToday ?? ""}
            onChange={(e) => fields.onHomeworkToday(student.id, subject.name, e.target.value)}
            readOnly={rowLocked}
            // ⚠️ 이 칸은 고정 140px(colgroup) — 예시까지 넣은 긴 placeholder는 **좁아서 잘려서**
            // "오늘 과제 (예: 개념편 p"로 끊겼다(원장 제보 2026-08-04).
            // 칸 이름만 남기고 예시는 title(툴팁)로 — 카드 모드(폭 넉넉)는 예시를 그대로 쓴다.
            placeholder="오늘 과제"
            title={
              (subject.homeworkToday ?? "").includes("\n")
                ? subject.homeworkToday!
                : "오늘 내준 과제 — 예: 개념편 p10~16"
            }
            aria-label={`${student.name} ${subject.name} 오늘 과제`}
            data-nav-col="homeworkToday"
            data-nav-row={nav.row}
            onKeyDown={handleGridNavKey}
            className="border-line bg-card focus:border-primary scrollbar-thin h-8 w-full resize-none rounded-sm border px-2 py-[0.3rem] text-[12px] leading-[1.2] outline-none"
          />
          {/* 뜻이 행 종류에 따라 갈린다(2026-08-05) — 반이 붙은 행이면 "정규까지 하고 보강도 했다"라
              제목이 "(정규+보강)"이 된다. 켜는 사람이 무엇을 켜는지 알 수 있게 툴팁으로 밝힌다. */}
          <label
            className="text-text-dim flex w-fit cursor-pointer items-center gap-1 text-[11px]"
            title={
              subject.classId
                ? "그날 정규 수업에 더해 보강까지 한 경우 — 학부모 보고서 제목이 '(정규+보강)'이 되고 한 건만 나갑니다"
                : "보강(수업외) 수업 — 학부모 보고서 제목이 '(보강)'이 됩니다"
            }
          >
            <input
              type="checkbox"
              checked={!!subject.makeup}
              onChange={() => fields.onMakeup(student.id, subject.name)}
              disabled={rowLocked}
              className="accent-primary size-3.5 disabled:opacity-50"
              aria-label={`${student.name} ${subject.name} 보강`}
            />
            보강
          </label>
        </div>
      </td>
      <td className={td}>
        {/* 특이사항(입력) + 학부모 문구(멘트) + 학습 추세 — 자동작성이 특이사항을 문장으로 풀어 씀. 우측 남는 폭 활용. */}
        <div className="flex flex-col gap-1">
          {/* 특이사항도 이 행의 기록이라 함께 잠근다 — 카드 모드는 처음부터 잠겨 있었고(왼쪽 fieldset)
              표만 열려 있어 같은 값이 한쪽에선 써지고 한쪽에선 안 써졌다. */}
          <textarea
            value={student.note ?? ""}
            onChange={(e) => fields.onNote(student.id, e.target.value)}
            readOnly={rowLocked}
            placeholder={rowPlaceholder ?? "특이사항(메모) · 예: 조퇴함 / 개념 어려워함"}
            aria-label={`${student.name} 특이사항`}
            className={`border-amber/40 focus:border-primary scrollbar-thin min-h-[40px] w-full rounded-sm border px-2 py-1 text-[11px] leading-snug outline-none ${AUTOSIZE} ${
              lockedTone || "bg-amber-soft/30"
            }`}
          />
          {config.noticeMode === "B" ? (
            // 모드 B — 카드 모드와 동일 계약: 화면만 2칸, 값은 joinComment이 빈 줄로 합친 **단일 문자열**
            // (저장·발송 경로 무변경). 표는 폭이 좁아 칸 제목을 placeholder로 겸한다.
            <>
              <textarea
                value={draftParas.p1}
                onChange={(e) => fields.onDraft(student.id, subject.name, joinComment(e.target.value, draftParas.p2))}
                readOnly={rowLocked}
                placeholder={mentPlaceholder ?? (genRowBusy ? "자동작성 중…" : "1문단 · 수업 내용(교재·진도·과제)")}
                aria-label={`${student.name} ${subject.name} 학부모 문구 1문단 수업 내용`}
                className={`${mentBase} ${AUTOSIZE} ${lockedTone || "bg-background"} min-h-[52px]`}
              />
              <textarea
                value={draftParas.p2}
                onChange={(e) => fields.onDraft(student.id, subject.name, joinComment(draftParas.p1, e.target.value))}
                readOnly={rowLocked}
                placeholder={mentPlaceholder ?? (genRowBusy ? "자동작성 중…" : "2문단 · 태도 · 특이사항")}
                aria-label={`${student.name} ${subject.name} 학부모 문구 2문단 태도 특이사항`}
                className={`${mentBase} ${AUTOSIZE} ${lockedTone || "bg-background"} min-h-[52px]`}
              />
            </>
          ) : (
            <textarea
              value={rep?.draft ?? ""}
              onChange={(e) => fields.onDraft(student.id, subject.name, e.target.value)}
              readOnly={rowLocked}
              placeholder={mentPlaceholder ?? (genRowBusy ? "자동작성 중…" : "'자동작성'으로 생성 · 직접 편집·확인 후 발송")}
              aria-label={`${student.name} ${subject.name} 학부모 문구`}
              className={`${mentBase} ${AUTOSIZE} ${lockedTone || "bg-background"} min-h-[72px]`}
            />
          )}
          <textarea
            value={rep?.trendDraft ?? ""}
            onChange={(e) => fields.onTrend(student.id, subject.name, e.target.value)}
            readOnly={rowLocked}
            placeholder={mentPlaceholder ?? "학습 추세(종합분석) · 기록 적으면 비어 있음"}
            aria-label={`${student.name} ${subject.name} 학습 추세`}
            className={`${mentBase} ${AUTOSIZE} ${lockedTone || "bg-bg-soft"} min-h-[48px]`}
          />
        </div>
      </td>
      <td className={td}>
        <div className="flex flex-col items-stretch gap-1">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => actions.onAutoWrite(student, subject.name)}
              disabled={genRowBusy || bulkGen || !canAutoWrite || alreadySent}
              title={
                alreadySent
                  ? "이미 발송된 보고서 — 수정할 수 없습니다"
                  : canAutoWrite
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
            <GridAttachButton
              // 발송 완료건은 첨부도 잠근다 — 첨부 변경은 classnote 상태를 리셋해 **재발송을 여는 뒷문**이었다
              // (수정 금지 규칙을 우회하는 경로가 되어버린다).
              disabled={alreadySent}
              disabledReason="이미 발송된 보고서 — 첨부를 바꿀 수 없습니다"
              attachments={rep?.attachments ?? []}
              urls={config.attachmentUrls}
              uploading={gen.uploadingKey === key}
              hiddenFromParents={config.attachmentsHidden}
              label={`${student.name} ${subject.name}`}
              onAdd={(files) => actions.onAttach(student, subject.name, files)}
              onRemove={(path) => actions.onRemoveAttachment(student, subject.name, path)}
              onOpen={() => actions.onOpenAttachments(student, subject.name)}
            />
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
            title={bulkGen ? "전체 자동작성 중 — 완료 후 발송" : (sendGate.hint ?? undefined)}
            onClick={() => actions.onSendRow(student, subject.name)}
          >
            {alreadySent ? "발송 완료" : "발송"}
          </Button>
          {/* 🔴 막힌 이유는 **눈에 보이게** — 버튼 title 툴팁뿐이면 강사는 이유를 모른다(2026-07-21:
              네이티브 툴팁이 실제로 안 뜨는 사례 확인 / 2026-07-30 원장: "왜 비활성화됐는지 알 방법이
              없다"). 판정은 위 sendGate 단일 소스라 **비활성인데 라벨이 없는 상태가 생길 수 없다**.
              색은 사유 성격에 맞춘다: 결석=위험, 발송됨=완료, 남은 입력=주의(할 일). */}
          {sendGate.label ? (
            <span
              className={`text-center text-[10px] font-bold ${
                sendGate.reasons[0] === "absent"
                  ? "text-danger"
                  : sendGate.reasons[0] === "sent"
                    ? "text-primary"
                    : "text-amber"
              }`}
              title={sendGate.hint ?? undefined}
            >
              {sendGate.label}
            </span>
          ) : null}
          {/* 멘트와 기록이 어긋남 — 발송을 막지는 않는다(강사 판단). 무엇을 볼지만 짚어 준다. */}
          {mentWarnings.map((w) => (
            <span
              key={w}
              className="text-amber text-center text-[10px] font-bold"
              title={MENT_WARNING_HINT[w]}
            >
              {MENT_WARNING_LABEL[w]}
            </span>
          ))}
          {/* 발송 상태 배지(큐·실패 등) — 발송 완료 라벨은 위 게이트가 이미 말했으므로 중복 표시하지 않는다. */}
          {!alreadySent && badge ? (
            <span className={`text-center text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>
          ) : null}
          {/* 학부모 읽음(0122a) — 양성 배지만(카드와 동일 규약, types.ts). 표는 세로 여유가 있어 풀 라벨. */}
          {subject.classnoteReadAt ? (
            <span
              className="text-primary text-center text-[10px] font-bold"
              title={`학부모 읽음 · ${readAtLabel(subject.classnoteReadAt)}`}
            >
              학부모 읽음
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
