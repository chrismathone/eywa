"use client";

import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { TEXTAREA_AUTOSIZE, TEXTAREA_AUTOSIZE_RESIZABLE } from "@/lib/ui/textarea";
import { joinComment, splitComment } from "../comment-paragraphs";
import { normalizeHomeworkPages } from "../homework-pages";
import { resolveStudyGrade } from "../curriculum";
import { subjectTone, toneSoftClass, toneSolidClass } from "../data";
import {
  effectiveClassnoteStatus,
  isAlreadySent,
  isReportOptoutRow,
  isRowInputEditable,
  isRowActionable,
  type GridRow,
} from "../grid";
import { rowSendGate } from "../row-send-gate";
import { isMathReportPilot, pilotCanEdit, understandingPresetOf, understandingRows } from "../math-report-pilot";
import { UnderstandingPresetButtons } from "./understanding-presets";
import { UnderstandingPopover } from "./understanding-popover";
import { LessonMemoInput } from "./lesson-memo-input";
import { attitudeNeedsNote, isHomeworkMissed, needsAttitudeNote, type DailyTestSkip } from "../math-report-pilot-sections";
import { hasMakeupAbsenceDate } from "../attendance-sentence";
import { DailyTestSkipSelect } from "./daily-test-skip-select";
import { HomeworkMissReasonInput } from "./homework-miss-reason";
import { ReasonNoteInput } from "./reason-note-input";
import { rowMakeupFacts } from "../report-comment";
import { joinLevelsLead, splitLevelsLead } from "../pilot-notes";
import { LevelsLead } from "./levels-lead";
import { hasTextBesidesMarkers } from "@/features/report-templates/image-slots";
import { rowLockNotice } from "../split-rows";
import { reportOptoutNotice, reportOptoutShort } from "@/features/classes/report-optout";
import { checkMentConsistency, MENT_WARNING_HINT, MENT_WARNING_LABEL } from "../ment-consistency";
import { attendanceMarkBadgeClass, attendanceMarkLabel, MARK_PRESENT } from "../attendance-mark";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { parentUnreadBadge, progressAnomalyBadge } from "../roster-signals";
import { makeupBadgeLabel } from "../makeup-label";
import { makeupRemoveBlockReason } from "../makeup-remove-plan";
import { resolveRowFields } from "../row-fields";
import type { OneScreenStudent, Subject } from "../types";
import { cnLabelFor, type CnMatchMap } from "../classnote-match";
import { CnBadge } from "./cn-badge";
import { ReportLockNotice } from "./report-lock-notice";
import { classnoteBadge, readAtLabel, type SubjectReport } from "./report-card";
import { GridAttachButton, useRowFileDrop } from "./grid-attach";
import { useClassnoteOn } from "./classnote-on-context";
import { useLicenseOn } from "@/features/owner/operations-context";
import {
  AttendancePills,
  SessionUnitsField,
  type AttendanceExtra,
  type BasicAttendance,
  type AttendanceSelection,
} from "./attendance-pills";
import { handleGridNavKey } from "./grid-nav";
import { FieldSelect } from "./field-select";
import { HomeworkRateInput } from "./homework-rate-input";
import { VideoHomeworkCheck } from "@/features/video-homework/components/video-homework-provider";
import { VideoHomeworkToggle } from "@/features/video-homework/components/video-homework-toggle";
import { VideoHomeworkDueToggle } from "@/features/video-homework/components/video-homework-due-toggle";
import { VideoSubmitLinkToggle } from "@/features/video-homework/components/video-submit-link-toggle";
import { ProgressModePills } from "./progress-mode-pills";
import { ProgressSelector } from "./progress-selector";
import { ScoreInput } from "./score-input";
import { TodaysMathMark } from "./todays-math-mark";
import { todaysMathMarked } from "../todays-math-fill-rules";
import { MakeupClassTag } from "./makeup-class-tag";
import { ReservedMakeupTag } from "./reserved-makeup-tag";
import { MakeupSwitchButton } from "./makeup-switch-button";
import { isMathBookRow, useMathBookListId } from "./math-book-list";
import { JjBookPicker } from "./jj-book-picker";
import { isJjSheetDraft, isJjSheetReport, isProgressOptionalReport } from "../jj-books";
import { LoveNoteDraftButton } from "./love-note-draft-button";

const TD_BASE = "px-2 py-1.5 align-top";
// 학생 묶음 구분선 — 묶음 첫 행(참고행이 꺼져 있을 때는 이 행)의 위쪽만 굵고 진한 회색.
// ⚠️ `border-t`(1px)와 `border-t-2`를 한 className에 같이 두지 말 것 — 둘 다 border-top-width라
//    어느 쪽이 이기는지 생성 CSS 순서에 달린다. 아예 다른 상수로 갈라 충돌 자체를 없앤다.
const TD = `border-line border-t ${TD_BASE}`;
// 🔴 색은 **글자 토큰이 아니라 면 토큰**(`--neutral-fill`)에서 온다 — 2026-09-08에 글자색이 한 값
//    (#121212)이 되면서 `border-t-text-faint/50`이던 이 선이 함께 진해졌다(#ABABAF → #898989).
//    선은 글자가 아니라 구조라 그 통일 대상이 아니다(globals.css: "테두리는 그대로").
const TD_GROUP = `border-t-2 border-t-neutral-fill/50 ${TD_BASE}`;
// 문구·특이사항 textarea — 내용에 따라 자동 확장(공용 상수, 미지원 브라우저는 각 칸의 min-h가 폴백).
// 표 모드는 좁은 칸이 여러 개라 손잡이를 남기는 변형을 쓴다(폼 입력칸은 손잡이 없는 TEXTAREA_AUTOSIZE).
const AUTOSIZE = TEXTAREA_AUTOSIZE_RESIZABLE;
// 영어 행 경고 칩(카드 칸의 칩과 같은 톤 — 표 칸이 좁아 여백만 줄였다).
const ENGLISH_FLAG = "border-amber/40 bg-amber-soft text-amber rounded-pill border px-1.5 py-0.5 text-xs font-bold";

/** 필드 편집 핸들러(카드뷰와 같은 state·저장로직 공유 — studentId 파라미터 버전). */
export type GridFieldHandlers = {
  // 출결 pill(2-2) — 출석부 기록에 저장. extra=지각·결석 사유 메모·수업타임(2026-08-05, 같은 행 한 왕복).
  onAttendance: (
    studentId: string,
    classId: string,
    status: AttendanceSelection,
    extra?: AttendanceExtra,
  ) => void;
  onProgress: (studentId: string, subjectIndex: number, today: string) => void;
  /** 오늘 수업 성격(복습·문제풀이) — 진도와 함께 사는 별개 축(progress-mode.ts). */
  onProgressMode: (studentId: string, subjectIndex: number, mode: string | null) => void;
  /** 이해도 단계 버튼 — 그 행 소단원 전부에 같은 점수(카드와 같은 setter). 없으면 버튼을 안 그린다. */
  onUnderstandingAll?: (studentId: string, subjectName: string, score: number) => void;
  /** 소단원 하나의 점수(null = 기본값으로) · 빼기/되살리기 — 카드 패널과 같은 setter. 없으면 '소단원별' 창을 안 그린다. */
  onUnderstandingScore?: (studentId: string, subjectName: string, lesson: string, score: number | null) => void;
  onUnderstandingToggle?: (studentId: string, subjectName: string, lesson: string, off: boolean) => void;
  onStudyGrade: (studentId: string, grade: string) => void;
  // 🔴 평가값 5종은 **행(수업) 단위**다(2026-08-13) — 보강은 정규와 따로 나가는 다른 보고서라 값도 독립이어야
  //    한다(원장 제보). 그래서 학생 id만이 아니라 **행 이름**까지 받는다. 해석·폴백은 row-fields.ts 단일 소스.
  onScore: (studentId: string, subjectName: string, which: "daily" | "check", v: number | null) => void;
  onMax: (studentId: string, subjectName: string, which: "daily" | "check", v: number) => void;
  onAttitude: (studentId: string, subjectName: string, a: string | null) => void;
  onHomework: (studentId: string, subjectName: string, h: string) => void;
  onTextbook: (studentId: string, subjectName: string, text: string) => void;
  onHomeworkToday: (studentId: string, subjectName: string, text: string) => void; // 오늘 과제(0096a)
  onDraft: (studentId: string, subjectName: string, text: string) => void; // 학부모 문구(멘트) 편집
  onTrend: (studentId: string, subjectName: string, text: string) => void; // 학습 추세(종합분석) 편집(4a)
  /** '학습 추세 미발송'(원장 2026-09-18) — 켜져 있나 · 켜고 끄기. 없으면 체크를 안 그린다(읽기 전용·테스트). */
  trendHidden?: (studentId: string, subjectName: string) => boolean;
  onTrendHidden?: (studentId: string, subjectName: string) => void;
  onNote: (studentId: string, subjectName: string, text: string) => void; // 특이사항(강사 메모) — AI 멘트 입력(4c). **행별**.
  /** 합침 취소(정규+보강 → 정규) — '정규+보강' 배지에서만 부른다(체크박스는 2026-09-30 제거). */
  onMakeup: (studentId: string, subjectName: string) => void;
  /** 오늘 영상 과제 있음/없음 켜고 끄기(0308a). 없으면 칸이 잠긴다(읽기 전용·테스트). */
  onVideoHomework?: (studentId: string, subjectName: string) => void;
  /** 영상 첨부 링크 넣기 켜고 끄기(0328a) — '영상 과제'를 켠 행에서만 뜬다. 없으면 칸이 잠긴다. */
  onVideoSubmitLink?: (studentId: string, subjectName: string) => void;
  /** 영상 숙제 마감(7일 · 다음 수업) 고르기 — '영상 과제'를 켠 행에서만 뜬다. 없으면 칸이 잠긴다. */
  onVideoHomeworkDue?: (studentId: string, subjectName: string, mode: "week" | "next") => void;
  // ── 새 보고서 필수 칸(원장 2026-10-26 *"카드와 표에서 동일하게"*) — 카드와 **같은 setter**를 넘긴다. 없으면 칸을 안 그린다(읽기 전용·테스트). ──
  /** 일일 테스트 있음/없음 + 사유(null = 시험 있음). */
  onDailyTestSkip?: (studentId: string, subjectName: string, skip: DailyTestSkip | null) => void;
  /** 숙제 미제출 사유. */
  onHomeworkMissReason?: (studentId: string, subjectName: string, reason: string) => void;
  /** 수업 태도 의견(하·중하, 3줄 이상). */
  onAttitudeNote?: (studentId: string, subjectName: string, note: string) => void;
  /** 보강 사유(결석 날짜를 예약에서 못 찾은 보강 줄). */
  onMakeupReason?: (studentId: string, subjectName: string, reason: string) => void;
  /** '오늘의 수업' 메모(새 수학 보고서, 2026-10-28) — 없으면 칸이 안 선다(열람 전용). */
  onLessonMemo?: (studentId: string, subjectName: string, memo: string) => void;
};

/** 행 단위 액션. */
export type GridRowActions = {
  onSendRow: (student: OneScreenStudent, subjectName: string) => void;
  onAutoWrite: (student: OneScreenStudent, subjectName: string) => void; // 행별 AI 멘트 자동작성
  onOpenCard: (studentId: string, subjectName?: string) => void; // 그 학생을 카드 뷰로 열기(본문·첨부·링크 편집)
  onImportPrev: (student: OneScreenStudent, subjectName: string) => void; // 이전 회차 값 → 빈 칸 채움(1-3)
  // 첨부(표 모드) — 클립 팝오버·행 드롭이 공유. 게이트(진도 미입력)·저장보장은 부모 핸들러가 담당.
  onAttach: (student: OneScreenStudent, subjectName: string, files: File[]) => void;
  onRemoveAttachment: (student: OneScreenStudent, subjectName: string, path: string) => void;
  onOpenAttachments: (student: OneScreenStudent, subjectName: string) => void; // 팝오버 열 때 썸네일 서명
  /** 보강 빼기 — 없으면 배지가 그냥 표시로 남는다(권한 없는 화면·읽기 전용). */
  onRemoveMakeup?: (student: OneScreenStudent, subjectName: string) => void;
  /** 이 행을 뺄 수 있나 — 발송·처리 중이면 false라 버튼을 열지 않는다(서버도 같은 판정으로 막는다). */
  canRemoveMakeup?: (studentId: string, subjectName: string) => boolean;
  /** 보강 보고서 합치기('(보강)' 줄 → 같은 반 정규 줄) · 나누기('정규+보강' 줄 → 보강 따로) — 원장 2026-10-22, 판정 makeup-switch.ts. */
  onJoinMakeup?: (student: OneScreenStudent, subjectName: string) => void;
  onSplitMakeup?: (student: OneScreenStudent, subjectName: string) => void;
  /** 보강 반 고르기(원장 2026-09-30 — 보고서 반 = 출석부 반) — 없으면 반 표시만. */
  onPickMakeupClass?: (student: OneScreenStudent, subjectName: string) => void;
  /** 보강 진행 여부 확인(원장 2026-10-27 — 보강 예약 표식을 눌러 했음/못 했음) — 없으면 표식은 표시만. */
  onCheckMakeup?: (student: OneScreenStudent, subjectName: string, outcome: "done" | "missed") => void;
  /** 영어 행 경고 셋(칸 바뀜·AI 코멘트 옛 값·이름 없음) — 카드 칸·발송 확인과 같은 판정(english-draft.ts). */
  englishFlagsOf?: (
    student: OneScreenStudent,
    subject: Subject,
    rep: SubjectReport | undefined,
  ) => { stale: boolean; aiStale: boolean; nameMissing: boolean; needsAi: boolean };
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
  /** ClassNote 반 보드 매칭(0302a) — 이름 옆 'C.N' 알약. 없거나 available=false면 알약을 안 그린다. */
  classnoteMatch?: CnMatchMap;
  /** 그 날짜가 학원설정 휴원일이면 이름 — 값 일괄 적용의 출결 확인에 한 줄을 더한다(roster.ts). */
  holidayName?: string | null;
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
  const t = useSheetT();
  const tf = useSheetTf();
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
          placeholder={t("os.row.progressPh")}
          aria-label={tf("os.row.progressAria", { name: student.name, subject: su.name })}
          title={su.today.includes("\n") ? su.today : undefined}
          className={`border-line focus:border-primary ${TEXTAREA_AUTOSIZE} min-h-8 w-full rounded-sm border px-2 py-[0.3rem] text-xs leading-[1.2] outline-none ${
            locked ? "bg-bg-soft text-text-dim" : "bg-card"
          }`}
        />
        <ProgressModePills
          mode={su.progressMode}
          onMode={(m) => onProgressMode(student.id, subjectIndex, m)}
          disabled={locked}
          compact
          ariaLabel={tf("os.row.modeAria", { name: student.name, subject: su.name })}
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
      ariaLabel={tf("os.row.progressAria", { name: student.name, subject: su.name })}
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
  showClass = true,
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
    /** '다른 강사 뷰'(열람 전용) — 행 입력·발송을 전면 잠근다(2026-08-19, 서버 가드의 거울). */
    readonlyView?: boolean;
  };
  // 키보드 세로 이동(3-1) 인덱스 — **표시 순서 기준**(assembler가 buildRowRenderMeta로 부여).
  // row=과목 단위 열(교재·오늘과제), studentRow=학생 단위 열(점수 — 학생 묶음 첫 행만, 중복 칸 스킵).
  nav: { row: number; studentRow?: number };
  orderControls?: React.ReactNode; // 순서 모드(3-2) — 선택 체크박스 자리에 ↑↓(학생 묶음 첫 행만)
  showClass?: boolean;
  groupStart?: boolean; // 학생 묶음의 첫 렌더 행 — 위쪽에 굵은 구분선(참고행이 켜져 있으면 그쪽이 받는다)
}) {
  const { student, subject, subjectIndex, key } = row;
  const lang = useSheetLang();
  const t = useSheetT();
  const classnoteOn = useClassnoteOn();
  const aiOn = useLicenseOn("ai_analysis"); // 꺼진 지점엔 '자동 작성' 버튼이 없다(2026-09-30)
  const tf = useSheetTf();
  const mathBookList = useMathBookListId(); // 교재명 칸 제안(수학 행만, math-book-list.ts)
  // 이 행에 적용되는 평가값(태도·점수·과제 수행률) — 행 값이 없으면 학생 값 폴백(row-fields.ts).
  const rowEval = resolveRowFields(student, subject);
  const td = groupStart ? TD_GROUP : TD; // 학생 구분선(묶음 첫 행만 굵게)
  const { tone } = subjectTone(subject.name);
  const badge = classnoteBadge(rep?.classnoteStatus, lang);
  // 로스터 신호(G2·G3) — 판정은 순수 함수(roster-signals.ts). 진도 배지는 수학 파이프라인 데이터라 math 행에만
  // (subjectKey 미지정=math 간주는 진도 입력 분기와 동일 규약, types.ts:26-29).
  const isMathRow = !subject.subjectKey || subject.subjectKey === "math";
  const showProgressBadge = isMathRow && progressAnomalyBadge(student.progressSignal);
  // 학부모 읽음(G3)도 같은 게이트 — RPC가 학생의 **모든** 보고서를 세는데 발송분이 아직 전부 수학이라
  // (subject='english' 0건, 2026-07-29) 영어 행에 달면 "이 영어 보고서가 미확인"으로 읽힌다(거짓).
  const unreadBadge = classnoteOn && isMathRow ? parentUnreadBadge(student.parentRead) : null;
  const att = student.attendance;
  const genRowBusy = gen.rowBusy;
  // 모드 B 편집용 분리값 — 라운드트립 불변식(split(join)===원본)은 comment-paragraphs가 보장.
  const draftParas = splitComment(rep?.draft ?? "");
  const bulkGen = gen.bulk;
  // 학부모 멘트(draft) 준비됨 — 발송 시 사용. 영어 글의 그림·사진 자리 줄뿐이면 멘트가 아니다(서버가 막는 것과 같은 판정).
  const hasDraft = hasTextBesidesMarkers(rep?.draft);
  // ⚠️ 화면 state(rep)의 상태가 로스터 스냅샷을 이긴다 — 방금 보낸 행을 계속 '발송 가능'으로 두면 중복 게시.
  // ⚠️ `??` 금지 — 재발급·첨부변경이 명시적으로 지운(null) 상태를 스냅샷의 옛 "success"가 덮는다.
  const liveStatus = effectiveClassnoteStatus(rep?.classnoteStatus, subject.classnoteStatus);
  const alreadySent = isAlreadySent(liveStatus);
  // 발송 게이트 = **단일 소스**(send-gate.ts) — 버튼 disabled·title·아래 라벨이 같은 판정을 쓴다.
  // ⚠️ 멘트 미작성도 여기서 막는다: 빈 멘트 절대 가드(2026-07-28)가 어차피 sendRow에서 거절하므로,
  //    버튼만 살려 두면 눌러 보고서야 이유를 아는 거짓 어포던스다(원장 2026-07-30 제보의 핵심).
  // 수학 보고서 시범(테스트 학생 한정, math-report-pilot.ts) — 멘트·추세는 보기만, 자동작성 글 그대로여야 발송(카드와 같은 판정).
  const pilot = isMathReportPilot(student.id, subject.subjectKey);
  const uRows = pilot ? understandingRows(subject.today, subject.understanding) : [];
  const pilotLocked = pilot && !pilotCanEdit(rep?.autoDraft); // 자동작성 전엔 잠금(2026-10-23)
  const makeupFacts = rowMakeupFacts(student, subject); // 보강 재료(결석 날짜·시간·사유) — 게이트와 보강 사유 칸이 같은 값을 본다
  const draftLead = splitLevelsLead(rep?.draft); // 맨 위 수업 평가 표 = 읽기 전용(원장 2026-10-26)
  // '사랑의 한마디' 행 — 새 수학 보고서 + 영어(원장 2026-10-26, 카드와 같은 판정).
  const oneLineRow = pilot || subject.subjectKey === "english";
  // JJ 수업보고서 글 — 사랑의 한마디는 선택(비우면 그 항목이 빠진다, 원장 2026-10-27).
  const jjOptionalNote = subject.subjectKey === "english" && isJjSheetDraft(rep);
  const progressOptional = isProgressOptionalReport(subject, rep); // SRS 글은 진도 항목이 없다(원장 2026-11-05)
  // 재료 조립은 카드·표 한 벌(row-send-gate.ts, 리뷰 B5) — 판정은 send-gate 단일 소스.
  const sendGate = rowSendGate({ lang, student, subject, rep, readonlyView: gen.readonlyView === true, attendanceReadOnly: gen.attReadOnly === true });
  const canSend = sendGate.canSend; // 열람 전용 포함 — 판정·사유는 send-gate 단일 소스
  // 멘트와 기록 칸이 서로 다른 말을 하는지(시험날 진도·멘트에만 있는 점수) — **막지 않고 알린다**.
  // 학부모 카드엔 멘트와 기록이 나란히 보이므로 어긋나면 학부모가 두 사실을 동시에 받는다(2026-07-30 감사).
  // 영어 행 = 템플릿 모드(2026-09-10, 카드와 같은 규약) — 2칸 나누기·추세·멘트 불일치 경고를 쓰지 않는다.
  const isEnglishRow = subject.subjectKey === "english";
  // '학습 추세 미발송'(원장 2026-09-18) — 켜져 있으면 추세 칸을 흐리게 긋는다(학부모에게 안 나간다).
  const trendHidden = fields.trendHidden?.(student.id, subject.name) ?? false;
  // 영어 행 경고 셋 — 판정은 부모가 넘긴 함수(카드·발송 확인과 같은 english-draft.ts). 없으면(테스트 등) 안 그린다.
  const englishFlags = isEnglishRow ? actions.englishFlagsOf?.(student, subject, rep) : undefined;
  const mentWarnings = isEnglishRow ? [] : checkMentConsistency({
    ment: rep?.draft ?? "",
    progress: subject.today ?? "",
    dailyTest: rowEval.tests.daily.score != null ? "y" : "",
    checkTest: rowEval.tests.check.score != null ? "y" : "",
  });
  // 발송 완료건은 자동작성도 막는다 — 멘트를 새로 만들어 봐야 저장이 서버에서 거부된다(입력 유실).
  const canAutoWrite = isRowActionable(subject, "autowrite", liveStatus, { progressOptional });
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
  // 열람 전용(다른 강사 뷰)이면 무조건 잠금 — 발송 완료·결석 잠금과 같은 축(스타일·이동 스킵까지 공유).
  const rowLocked = gen.readonlyView || !isRowInputEditable(subject, liveStatus);
  /** 잠긴 칸 묶음(td 안에서만 쓴다 — tr의 자식은 td여야 하므로 행 전체를 fieldset으로 감쌀 수 없다). */
  const LOCK_FS =
    "contents [&_input:disabled]:opacity-50 [&_textarea:disabled]:opacity-50 [&_button:disabled]:opacity-50 [&:disabled_*]:cursor-not-allowed";
  const optoutRow = isReportOptoutRow(subject);
  const lockNotice = rowLockNotice(subject, reportOptoutNotice(lang));
  // 잠긴 칸 안은 짧게 — 까닭·할 일 긴 문장은 이 칸 맨 위 안내가 한 번 적는다(원장 2026-11-04 · 세 칸에 같은 긴 문장을 늘어놓지 않는다).
  const lockShort = subject.splitIn ? lockNotice : reportOptoutShort(lang);
  const mentPlaceholder = optoutRow
    ? lockShort
    : isAbsent
      ? t("os.row.absentMent")
      : alreadySent
        ? t("os.row.sentLocked")
        : null;
  /** 특이사항 자리 — 막기만 하지 말고 **갈 곳**을 알려준다(결석 사유는 출결 알약 안에 적는 칸이 있다). */
  const rowPlaceholder = optoutRow
    ? lockShort
    : isAbsent
      ? t("os.row.absentNote")
      : alreadySent
        ? t("os.row.sentLocked")
        : null;
  const mentBase =
    "border-line focus:border-primary scrollbar-thin w-full rounded-sm border px-2 py-1 text-xs leading-snug outline-none";
  /**
   * 잠긴 칸의 톤 — 🔴 **결석만이 아니라 잠긴 모든 이유**에 붙인다(2026-08-14).
   * 예전엔 `isAbsent`만 봐서, **발송 완료로 잠긴 행이 평소와 똑같이 보였다**. 칸은 readOnly라 커서는
   * 잡히고 글자만 안 들어가니 "왜 안 써지지"가 된다(원장 제보: *"발송한건 오히려 안잠궜는데"* — 실제로는
   * 잠겨 있었고 표시가 없었을 뿐). 잠갔으면 잠긴 것처럼 보여야 한다.
   */
  const lockedTone = rowLocked ? "bg-bg-soft text-text-faint cursor-not-allowed" : "";
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
      data-help={student.isMakeup ? "os-makeup" : "os-row"}
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
            aria-label={tf("os.row.pickAria", { name: student.name, subject: subject.name })}
            className="accent-primary size-3.5 align-middle"
          />
        )}
      </td>
      <td className={td}>
        {/* 🔴 이름이 배지에 밀려 글자 사이에서 줄바꿈되던 자리(2026-07-30 원장 제보: "김지연"이 "김지/연").
            이 칸은 고정 폭(144px — 2026-09-08 v5 글자 기준 실측으로 128→144, onescreen-grid.tsx colgroup)인데 배지(보강·학부모 미확인·진도 확인 필요)가 전부 `shrink-0`이라
            **줄어들 수 있는 유일한 요소가 이름**이었다 → 배지가 뜨는 행에서만 이름이 찌그러졌다.
            이름을 `shrink-0 whitespace-nowrap`으로 잠그고 컨테이너를 `flex-wrap`으로 바꿔
            **배지가 다음 줄로 내려가게** 한다(이름은 항상 한 덩이). */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className={`size-1.5 shrink-0 rounded-full ${toneSolidClass(tone)}`} aria-hidden />
          <span className="text-foreground shrink-0 font-bold whitespace-nowrap">{student.name}</span>
          {/* ClassNote 반 보드 매칭(원장 2026-09-29) — 카드 모드와 같은 부품·같은 판정. 수학 반 행만 · 미발송 줄은 없음(2026-11-04). */}
          <CnBadge
            label={cnLabelFor(config.classnoteMatch, { classId: subject.classId, subjectKey: subject.subjectKey, studentId: student.id, reportOptout: subject.reportOptout })}
            className={subject.className ?? student.className}
          />
          {/* 보강 배지 = **빼는 문**(원장 2026-08-18 *"다 삭제"*). 추가만 있고 빼는 길이 없어 잘못 추가한
              보강이 화면에 눌러앉았다(영어 ECS는 같은 칸을 이미 버튼으로 열어 뒀다). 확인 후에만 지운다. */}
          {student.isMakeup ? (
            actions.onRemoveMakeup && (actions.canRemoveMakeup?.(student.id, subject.name) ?? true) ? (
              <button
                type="button"
                onClick={() => actions.onRemoveMakeup?.(student, subject.name)}
                title={t("os.row.makeupRemove")}
                aria-label={tf("os.row.makeupRemoveAria", { name: student.name })}
                className="bg-amber-soft text-amber hover:bg-amber inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-pill px-1 py-px text-xs font-bold transition hover:text-white"
              >
                {makeupBadgeLabel({ makeup: true, hasClass: false }, lang)}
                <EyIcon name="close" size={8} />
              </button>
            ) : (
              // 발송분 등 뺄 수 없는 행 — 버튼을 없애기만 하면 "왜 안 되지"가 남는다(적대 리뷰).
              <span
                className="bg-amber-soft text-amber shrink-0 rounded-pill px-1 py-px text-xs font-bold"
                title={makeupRemoveBlockReason(liveStatus, lang) ?? undefined}
              >
                {makeupBadgeLabel({ makeup: true, hasClass: false }, lang)}
              </span>
            )
          ) : null}
          {/* G3: 학부모 미확인 — 최근 추적 가능 보고서 3건+ 전부 나흘 넘게 미읽음(판정=roster-signals 순수함수).
              카피는 "미확인"(읽음 신호 커버리지 75%라 "안 읽음" 단정 금지). 모든 행에 표시(반 필터에 숨지 않게). */}
          {unreadBadge ? (
            <span
              className="bg-amber-soft text-amber shrink-0 rounded-pill px-1 py-px text-xs font-bold"
              title={tf("os.row.unreadTitle", { n: unreadBadge.count })}
            >
              {tf("os.row.unread", { n: unreadBadge.count })}
            </span>
          ) : null}
          {/* G2: 진도 확인 필요 — errored 컨테이너/최근 오류 이벤트(수학 파이프라인 전용 → math 행에만).
              regression은 의도적 제외(실측 소음) — roster-signals.ts 참조. */}
          {showProgressBadge ? (
            <span
              className="bg-danger-soft text-danger shrink-0 rounded-pill px-1 py-px text-xs font-bold"
              title={t("os.row.jumpTitle")}
            >
              {t("os.row.jump")}
            </span>
          ) : null}
        </div>
        {/* ⚠️ 알약엔 **과목 라벨만** 칠한다(원장 2026-07-23 제보: "하나는 수학만 파란 배경, 나머지는 반 전체가
            파란 배경"). `subject.name`은 같은 과목 두 반일 때 로스터가 반 이름을 이어 붙인 **유일화 라벨**이라
            그대로 칠하면 알약이 반 이름까지 삼켜 행마다 폭·모양이 달라진다. 반 이름은 학년 태그와 같은 톤으로 밖에. */}
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className={`rounded-pill px-1.5 py-px text-xs font-bold ${toneSoftClass(tone)}`}>
            {subject.subjectLabel || subject.name}
          </span>
          {/* 보강 줄의 보강 반(= 발송 반 = 출석부 칸의 반) — 반 미정이면 눌러서 고른다(원장 2026-09-30). */}
          <MakeupClassTag
            subject={subject}
            onPick={actions.onPickMakeupClass ? () => actions.onPickMakeupClass?.(student, subject.name) : undefined}
          />
          {/* 병합된 보강 행(classId 없음·makeup) — 알약엔 순수 과목 라벨('수학')만 칠해 정규 행과 똑같아 보이므로,
              행 단위 '보강' 배지로 구분한다(2026-07-24). 정규 반에 보강 토글만 켠 행(classId 있음)은 대상 아님.
              🔴 **학생 자체가 보강 추가분(isMakeup)이면 여기선 안 붙인다** — buildMakeupStudent가 학생에
                 `isMakeup`, 모든 과목 행에 `makeup:true`(classId 없음)를 함께 세워서 위 이름 옆 배지와
                 **같은 '보강'이 두 번** 찍혔다(원장 제보 2026-08-05). 이 배지의 존재 이유는 "정규 학생 카드에
                 섞여 들어온 보강 행"을 가르는 것이라, 학생 전체가 보강이면 이름 옆 배지 하나로 충분하다. */}
          {/* 반이 붙은 행의 보강 = 그날 정규까지 한 "정규+보강"(2026-08-05 합치기) — 라벨을 갈라 적어야
              강사가 "왜 보강인데 보고서가 하나지?"를 화면에서 바로 이해한다. 판정은 makeup-label.ts 단일 소스. */}
          {/* 🔴 정규 학생 카드에 섞여 들어온 **순수 보강 행**(classId 없음)도 빼는 문이 있어야 한다
              (적대 리뷰 M2 — 버튼을 학생 단위 `isMakeup`에만 달면 최근 60일 67건 중 12건이 못 뺀다).
              반이 붙은 '정규+보강'은 대상 아님(그건 아래 배지로 **합침만 취소**한다 — 지우면 정규 보고서가 날아간다). */}
          {subject.makeup && !student.isMakeup ? (
            actions.onRemoveMakeup &&
            !subject.classId &&
            (actions.canRemoveMakeup?.(student.id, subject.name) ?? true) ? (
              <button
                type="button"
                onClick={() => actions.onRemoveMakeup?.(student, subject.name)}
                title={t("os.row.makeupRemove")}
                aria-label={tf("os.row.makeupRemoveAria2", { name: student.name, subject: subject.name })}
                className="bg-amber-soft text-amber hover:bg-amber inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-pill px-1 py-px text-xs font-bold transition hover:text-white"
              >
                {makeupBadgeLabel({ makeup: true, hasClass: false }, lang)}
                <EyIcon name="close" size={8} />
              </button>
            ) : subject.classId && !rowLocked && !subject.makeupByReservation ? (
              // 합침 취소(정규+보강 → 정규) — 옛 '보강' 체크박스의 유일한 정당한 쓰임(잘못 합친 것 되돌리기)을 여기로 옮겼다.
              // 올려 둔 타임(보강 시수)은 건드리지 않는다(얼마를 올렸는지 모른다) — 확인창이 그 사실을 알린다.
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(tf("os.row.makeupUnmergeConfirm", { name: student.name, subject: subject.name })))
                    fields.onMakeup(student.id, subject.name);
                }}
                title={t("os.row.makeupUnmerge")}
                aria-label={tf("os.row.makeupUnmergeAria", { name: student.name, subject: subject.name })}
                className="bg-amber-soft text-amber hover:bg-amber inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-pill px-1 py-px text-xs font-bold transition hover:text-white"
              >
                {makeupBadgeLabel({ makeup: true, hasClass: true }, lang)}
                <EyIcon name="close" size={8} />
              </button>
            ) : (
              <span
                className="bg-amber-soft text-amber shrink-0 rounded-pill px-1 py-px text-xs font-bold"
                title={
                  subject.classId
                    ? subject.makeupByReservation
                      ? t("os.reserved.mergeLocked")
                      : undefined
                    : (makeupRemoveBlockReason(liveStatus, lang) ?? undefined)
                }
              >
                {makeupBadgeLabel({ makeup: true, hasClass: !!subject.classId }, lang)}
              </span>
            )
          ) : null}
          {/* 합치기 ↔ 나누기(원장 2026-10-22) — '(보강)' 줄은 오늘 같은 과목 정규 줄이 있을 때만, '정규+보강' 줄은 잠기지 않았을 때만. 막히면 이유를 알린다. */}
          {actions.onJoinMakeup && subject.makeup && !subject.classId &&
          student.subjects.some((x) => !x.makeup && !!x.classId && (x.subjectKey ?? "") === (subject.subjectKey ?? "")) ? (
            <MakeupSwitchButton kind="join" onClick={() => actions.onJoinMakeup?.(student, subject.name)} />
          ) : null}
          {actions.onSplitMakeup && subject.makeup && subject.classId && !rowLocked ? (
            <MakeupSwitchButton kind="split" onClick={() => actions.onSplitMakeup?.(student, subject.name)} />
          ) : null}
          {showClass && subject.className ? (
            <span className="text-text-faint text-xs">{subject.className}</span>
          ) : null}
          {/* 보강 예약(0264a) — 이 줄에 걸린 그날 보강(원장 2026-10-22 *"표 모드도 동일하게"*). 눌러서 보강 진행 여부 확인(2026-10-27). */}
          <ReservedMakeupTag
            list={subject.makeupReserved}
            onCheck={actions.onCheckMakeup && !gen.readonlyView ? (outcome) => actions.onCheckMakeup?.(student, subject.name, outcome) : undefined}
          />
          {/* 수업 나누기(0351a) — 받는 반 행이면 "← 원래 선생님", 원래 반 행이면 "→ 받는 선생님"(그 시간만). */}
          {subject.splitIn || subject.splitOut ? (
            <span className="bg-blue-soft text-blue rounded-pill px-1 py-px text-xs font-bold">{subject.splitIn ?? subject.splitOut}</span>
          ) : null}
          <span className="text-text-faint text-xs">{student.grade}</span>
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
          ) : att !== MARK_PRESENT ? (
            <span
              className={`rounded-pill px-1.5 py-px text-xs font-bold ${attendanceMarkBadgeClass(att, { strongAbsent: true })}`}
            >
              {attendanceMarkLabel(att, lang)}
            </span>
          ) : null}
        </div>
        {/* 보강 사유 — 결석 날짜를 예약에서 못 찾은 보강 줄만(카드와 같은 칸, 2026-10-26). */}
        {fields.onMakeupReason && makeupFacts?.row && !hasMakeupAbsenceDate(makeupFacts) ? (
          <fieldset disabled={rowLocked} className={LOCK_FS}>
            <ReasonNoteInput
              value={subject.makeupReason ?? ""}
              done={(subject.makeupReason ?? "").trim() !== ""}
              labelKey="os.card.mkReason.label"
              placeholderKey="os.card.mkReason.ph"
              onChange={(v) => fields.onMakeupReason?.(student.id, subject.name, v)}
            />
          </fieldset>
        ) : null}
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
            autoUnits={subject.attendanceAutoUnits}
          />
        ) : (
          <span
            className="text-text-faint text-sm"
            title={
              gen.attReadOnly
                ? t("os.units.noPerm")
                : t("os.units.noClass")
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
        {/* 이해도 단계 버튼 — 카드와 같은 버튼·같은 함수(원장 2026-10-26 *"카드와 표에서 동일하게"*). 새 수학 보고서 행이고 진도가 있을 때만. */}
        {/* 소단원별 — 소단원마다 다른 점수·빼기·되살리기(카드와 같은 패널, 원장 2026-10-27). 다 뺐어도 되살릴 수 있게 소단원이 있으면 선다. */}
        {pilot && fields.onUnderstandingAll && uRows.length ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {uRows.some((r) => !r.off) ? (
              <UnderstandingPresetButtons
                compact
                disabled={rowLocked}
                active={understandingPresetOf(uRows)}
                onPick={(score) => fields.onUnderstandingAll?.(student.id, subject.name, score)}
              />
            ) : null}
            {fields.onUnderstandingScore && fields.onUnderstandingToggle ? (
              <UnderstandingPopover
                rows={uRows}
                disabled={rowLocked}
                onScore={(lesson, score) => fields.onUnderstandingScore?.(student.id, subject.name, lesson, score)}
                onToggle={(lesson, off) => fields.onUnderstandingToggle?.(student.id, subject.name, lesson, off)}
                onAll={(score) => fields.onUnderstandingAll?.(student.id, subject.name, score)}
              />
            ) : null}
          </div>
        ) : null}
        {/* '오늘의 수업' 메모(원장 2026-10-28) — 카드와 같은 칸. 진도 칸 안 맨 아래라 표 열 폭은 그대로다. */}
        {pilot && fields.onLessonMemo ? (
          <LessonMemoInput
            compact
            value={subject.lessonMemo ?? ""}
            disabled={rowLocked}
            ariaLabel={tf("os.memo.aria", { name: student.name })}
            onChange={(v) => fields.onLessonMemo?.(student.id, subject.name, v)}
          />
        ) : null}
      </td>
      {/* 점수·태도·과제 칸은 자체 잠금 prop이 없다 → **td 안에서** fieldset으로 묶어 잠근다(카드 모드와 같은 방식).
          ⚠️ `<tr>`의 자식은 `<td>`여야 해서 행 전체를 fieldset으로 감쌀 수 없다 — 칸마다 감싼다.
          ⚠️ `contents`라 레이아웃은 그대로(칸 정렬·폭 불변). */}
      {config.dailyEnabled ? (
        <td className={`${td} text-center`}>
          {/* 수학 보고서 시범 — 카드에서 '시험 없음'을 고른 행은 점수 칸 대신 그 사실을 적는다(점수를 넣어도 읽지 않는다, row-fields.ts). */}
          {/* 일일 테스트 '없음' — 표에서도 카드와 같은 판으로 고른다(원장 2026-10-26 *"카드와 표에서 동일하게"*) — 칸에 펼치면 행이 터져 사유는 드롭다운으로(2026-10-27). */}
          {pilot && subject.dailyTestSkip && fields.onDailyTestSkip ? (
            <fieldset disabled={rowLocked} className={LOCK_FS}>
              <DailyTestSkipSelect
                skip={subject.dailyTestSkip}
                ariaLabel={tf("os.row.dailyLabel", { name: student.name })}
                onChange={(skip) => fields.onDailyTestSkip?.(student.id, subject.name, skip)}
              />
            </fieldset>
          ) : pilot && subject.dailyTestSkip ? (
            <span className="text-text-dim text-xs font-bold">{t("os.card.testSkip.no")}</span>
          ) : (
          <>
          <fieldset disabled={rowLocked} className={LOCK_FS}>
            <ScoreInput
              value={rowEval.tests.daily.score}
              max={rowEval.tests.daily.max}
              onChange={(v) => fields.onScore(student.id, subject.name, "daily", v)}
              label={tf("os.row.dailyLabel", { name: student.name })}
              allowMax={config.allowTestMax}
              onMax={(v) => fields.onMax(student.id, subject.name, "daily", v)}
              nav={nav.studentRow !== undefined ? { col: "daily", row: nav.studentRow } : undefined}
            />
          </fieldset>
          {pilot && fields.onDailyTestSkip && !rowLocked ? (
            <button
              type="button"
              onClick={() => fields.onDailyTestSkip?.(student.id, subject.name, { reason: null, detail: "" })}
              className="text-text-faint hover:text-foreground mt-0.5 block w-full text-center text-xs underline-offset-2 hover:underline"
            >
              {t("os.card.testSkip.no")}
            </button>
          ) : null}
          </>
          )}
          {todaysMathMarked(subject, "daily", rowEval.tests.daily) ? <TodaysMathMark /> : null}
        </td>
      ) : null}
      {config.checkEnabled ? (
        <td className={`${td} text-center`}>
          <fieldset disabled={rowLocked} className={LOCK_FS}>
            <ScoreInput
              value={rowEval.tests.check.score}
              max={rowEval.tests.check.max}
              onChange={(v) => fields.onScore(student.id, subject.name, "check", v)}
              label={tf("os.row.checkLabel", { name: student.name })}
              allowMax={config.allowTestMax}
              onMax={(v) => fields.onMax(student.id, subject.name, "check", v)}
              nav={nav.studentRow !== undefined ? { col: "check", row: nav.studentRow } : undefined}
            />
          </fieldset>
          {todaysMathMarked(subject, "check", rowEval.tests.check) ? <TodaysMathMark /> : null}
        </td>
      ) : null}
      <td className={td}>
        {/* 원장 2026-07-23: 알약 → 드롭다운. 선택지가 늘어(과제 '없음' 추가) 표 가로가 터졌다. */}
        <fieldset disabled={rowLocked} className={LOCK_FS}>
          <FieldSelect
            radius="sm"
            options={config.attitudes}
            value={rowEval.attitude}
            onSelect={(a) => fields.onAttitude(student.id, subject.name, a)}
            ariaLabel={tf("os.row.attitudeAria", { name: student.name })}
            // 🔴 **태도 값은 한국어 그대로 보인다** — 원스크린은 학부모 문장을 짓는 표면이라
            //    표기 헬퍼(attitude-label) import 자체가 구조 가드로 막혀 있다. 아래 셋은
            //    우리가 쓴 UI 문구라 언어를 탄다.
            placeholder={t("select.choose")}
            noneLabel={t("roster.attitude.none")}
            legacyHint={t("select.legacy")}
            searchPlaceholder={t("select.search")}
          />
          {/* 수업 태도 의견 — 하·중하일 때만(카드와 같은 칸, 2026-10-26). */}
          {pilot && fields.onAttitudeNote && attitudeNeedsNote(rowEval.attitude) ? (
            <ReasonNoteInput
              multiline
              value={subject.attitudeNote ?? ""}
              done={!needsAttitudeNote(rowEval.attitude, subject.attitudeNote)}
              labelKey="os.card.attNote.label"
              placeholderKey="os.card.attNote.ph"
              onChange={(v) => fields.onAttitudeNote?.(student.id, subject.name, v)}
            />
          ) : null}
        </fieldset>
      </td>
      <td className={td}>
        {/* 과제 수행률 — 숫자 칸 + % (드롭다운 폐지, 원장 2026-08-03). 옆 일일·확인 점수칸과 같은 모양. */}
        <fieldset disabled={rowLocked} className={LOCK_FS}>
          <HomeworkRateInput
            value={rowEval.homework}
            onChange={(h) => fields.onHomework(student.id, subject.name, h)}
            label={tf("os.row.hwLabel", { name: student.name })}
            nav={{ col: "homework", row: nav.row }}
          />
          {/* 숙제 미제출 사유 — 카드와 같은 칸(2026-10-26 표에도). */}
          {pilot && fields.onHomeworkMissReason && isHomeworkMissed(rowEval.homework) ? (
            <HomeworkMissReasonInput
              value={subject.homeworkMissReason ?? ""}
              onChange={(r) => fields.onHomeworkMissReason?.(student.id, subject.name, r)}
            />
          ) : null}
        </fieldset>
          {subject.classId ? (
            <VideoHomeworkCheck classId={subject.classId} studentId={student.id}
              subjectKey={subject.subjectKey ?? "math"} grade={student.grade}
              previousHomework={subject.prevReport?.homeworkToday}
            homeworkDate={subject.prevReport?.date}
            compact readOnly={!!gen.readonlyView} />
        ) : null}
      </td>
      <td className={td}>
        <div className="flex flex-col gap-1">
          {/* 칸마다 무엇인지 앞에 작은 아이콘(원장 2026-09-30 *"교재 / 과제 / 보강체크 알 수 있게"*) — 값이 차면
              placeholder가 사라져 두 칸이 구분되지 않았다. 폭 160px라 글자 대신 아이콘 + 툴팁. */}
          <div className="flex items-center gap-1">
          <span title={t("os.row.bookPh")} className="text-text-faint inline-flex shrink-0"><EyIcon name="book" size={14} aria-hidden /></span>
          {isJjSheetReport(rep) ? (
            // JJ 수업보고서 행 — 교재는 세 권 중에서 고른다(원장 2026-10-27, jj-books.ts).
            <JjBookPicker
              value={subject.textbook}
              onChange={(v) => fields.onTextbook(student.id, subject.name, v)}
              disabled={rowLocked}
              label={tf("os.row.bookAria", { name: student.name, subject: subject.name })}
            />
          ) : (
          <input
            type="text"
            value={subject.textbook ?? ""}
            onChange={(e) => fields.onTextbook(student.id, subject.name, e.target.value)}
            list={isMathBookRow(subject.subjectKey) ? mathBookList : undefined}
            readOnly={rowLocked}
            placeholder={t("os.row.bookPh")}
            aria-label={tf("os.row.bookAria", { name: student.name, subject: subject.name })}
            data-nav-col="textbook"
            data-nav-row={nav.row}
            onKeyDown={handleGridNavKey}
            className="border-line bg-card focus:border-primary h-8 w-full min-w-0 rounded-sm border px-2 text-xs outline-none"
          />
          )}
          </div>
          {/* 오늘 과제(숙제 내용) — 0096a. 과제 셀렉트(수행 상태)와 별개, AI 멘트·학부모 카드 재료. */}
          {/* 진도 셀과 같은 처방 — 시트 초안은 교시마다 과제가 있어 한 줄 input이면 붙어 보인다(2026-08-07). */}
          <div className="flex items-center gap-1">
          <span title={t("os.row.hwTodayPh")} className="text-text-faint inline-flex shrink-0"><EyIcon name="clipboardList" size={14} aria-hidden /></span>
          <textarea
            rows={1}
            value={subject.homeworkToday ?? ""}
            onChange={(e) => fields.onHomeworkToday(student.id, subject.name, e.target.value)}
            // 쪽수 후보정(homework-pages.ts) — **입력이 끝났을 때만**. 타이핑 중에 붙이면 "42-6"에서 한 번,
            // "42-60"에서 또 한 번 끼어들어 커서가 튄다. 저장 경로(report-fields)도 같은 함수를 한 번 더 통과한다.
            // 🔴 잠긴 행에서는 절대 쓰지 않는다 — 이 칸은 `disabled`가 아니라 `readOnly`라 **포커스가 잡히고
            //    blur도 뜬다**. 가드가 없으면 잠근 행을 클릭했다 빠져나오는 것만으로 값이 바뀐다(#103).
            onBlur={(e) => {
              if (rowLocked) return;
              const fixed = normalizeHomeworkPages(e.target.value);
              if (fixed !== e.target.value) fields.onHomeworkToday(student.id, subject.name, fixed);
            }}
            readOnly={rowLocked}
            // ⚠️ 이 칸은 고정 160px(colgroup) — 예시까지 넣은 긴 placeholder는 **좁아서 잘려서**
            // "오늘 과제 (예: 개념편 p"로 끊겼다(원장 제보 2026-08-04).
            // 칸 이름만 남기고 예시는 title(툴팁)로 — 카드 모드(폭 넉넉)는 예시를 그대로 쓴다.
            placeholder={t("os.row.hwTodayPh")}
            title={
              (subject.homeworkToday ?? "").includes("\n")
                ? subject.homeworkToday!
                : t("os.row.hwTodayTitle")
            }
            aria-label={tf("os.row.hwTodayAria", { name: student.name, subject: subject.name })}
            data-nav-col="homeworkToday"
            data-nav-row={nav.row}
            onKeyDown={handleGridNavKey}
            className={`${TEXTAREA_AUTOSIZE} border-line bg-card focus:border-primary min-h-8 w-full min-w-0 rounded-sm border px-2 py-[0.3rem] text-xs leading-[1.2] outline-none`}
          />
          </div>
          {/* 🔴 '보강' 체크박스는 없앴다(원장 2026-09-30 *"옛 기능이 필요있는지 철저히 검수하고 필요없으면 제거"*).
              보강은 **보강 추가**(합침 = 정규+보강·타임 합산 / 분리 = 보강 행)에서 정해진다 — 손으로 켜면 타임은 그대로인
              '(정규+보강)' 제목만 생겨 출석부와 어긋났다. 되돌리기(합침 취소)는 이름 옆 '정규+보강' 배지가 맡는다. */}
          {/* 오늘 영상 과제 있음/없음(0308a) — 정책이 이 반을 켠 행에서만 보인다. */}
          <VideoHomeworkToggle
            checked={!!subject.videoHomework}
            onToggle={() => fields.onVideoHomework?.(student.id, subject.name)}
            disabled={rowLocked || !fields.onVideoHomework}
            studentId={student.id}
            classId={subject.classId}
            subjectKey={subject.subjectKey}
            grade={student.grade}
            studentName={student.name}
            subjectName={subject.name}
          />
          {/* 영상 숙제 마감(원장 2026-10-15) — '영상 과제'를 켠 행에만. 7일(기본) · 다음 수업. */}
          <VideoHomeworkDueToggle
            shown={!!subject.videoHomework}
            mode={subject.videoHomeworkDue}
            dueDate={subject.videoHomeworkDueDate}
            onChange={(mode) => fields.onVideoHomeworkDue?.(student.id, subject.name, mode)}
            disabled={rowLocked || !fields.onVideoHomeworkDue}
            row={{ studentId: student.id, classId: subject.classId, subjectKey: subject.subjectKey, grade: student.grade, studentName: student.name, subjectName: subject.name }}
          />
          {/* 영상 첨부 링크 넣기(0328a) — '영상 과제'를 켠 행에만. 켠 보고서 글에만 영상 올리는 링크가 함께 나간다. */}
          <VideoSubmitLinkToggle
            shown={!!subject.videoHomework}
            checked={!!subject.videoSubmitLink}
            onToggle={() => fields.onVideoSubmitLink?.(student.id, subject.name)}
            disabled={rowLocked || !fields.onVideoSubmitLink}
            classId={subject.classId}
            subjectKey={subject.subjectKey}
            grade={student.grade}
            studentName={student.name}
            subjectName={subject.name}
          />
        </div>
      </td>
      <td className={td}>
        {/* 특이사항(입력) + 학부모 문구(멘트) + 학습 추세 — 자동작성이 특이사항을 문장으로 풀어 씀. 우측 남는 폭 활용. */}
        <div className="flex flex-col gap-1">
          {/* '수업보고서 미발송' 반 — 이 보고서 칸이 왜 잠겼고 어떻게 하면 되는지(원장 2026-11-04, 카드와 같은 부품·같은 문장). */}
          {optoutRow ? <ReportLockNotice text={lockNotice} /> : null}
          {/* 특이사항도 이 행의 기록이라 함께 잠근다 — 카드 모드는 처음부터 잠겨 있었고(왼쪽 fieldset)
              표만 열려 있어 같은 값이 한쪽에선 써지고 한쪽에선 안 써졌다. */}
          {/* 🔴 읽기도 **행 값**(rowEval) — 쓰기(onNote)가 행별로 바뀐 2026-08-13에 여기만 학생 값으로 남아,
              타이핑이 `subject.note`에 들어가는데 화면은 `student.note`를 계속 그려 **글자가 아예 안 보였다**
              (원장 제보: *"커서만 깜빡이고 입력이 전혀 안됨"*). 잠금이 아니라 읽기/쓰기 층 불일치였다.
              ⚠️ 이 칸의 value는 onNote가 쓰는 층과 항상 같아야 한다 — 카드 모드는 처음부터 cardEval.note로 읽었다. */}
          <div className="flex items-start gap-1">
            <textarea
              value={rowEval.note}
              onChange={(e) => fields.onNote(student.id, subject.name, e.target.value)}
              readOnly={rowLocked}
              placeholder={rowPlaceholder ?? (jjOptionalNote ? t("os.row.notePhJj") : oneLineRow ? t("os.row.notePhPilot") : t("os.row.notePh"))}
              aria-label={tf("os.row.noteAria", { name: student.name })}
              className={`border-amber/40 focus:border-primary scrollbar-thin min-h-[40px] w-full min-w-0 rounded-sm border px-2 py-1 text-xs leading-snug outline-none ${AUTOSIZE} ${
                lockedTone || "bg-amber-soft/30"
              }`}
            />
            {/* 사랑의 한마디 [초안](원장 2026-10-28) — 누를 때만 AI. 잠긴 행·AI 꺼진 지점엔 안 선다. */}
            {oneLineRow && aiOn && !rowLocked ? (
              <LoveNoteDraftButton student={student} subject={subject} value={rowEval.note} onFill={(n) => fields.onNote(student.id, subject.name, n)} compact />
            ) : null}
          </div>
          {config.noticeMode === "B" && !isEnglishRow && !pilot ? (
            // 모드 B — 카드 모드와 동일 계약: 화면만 2칸, 값은 joinComment이 빈 줄로 합친 **단일 문자열**
            // (저장·발송 경로 무변경). 표는 폭이 좁아 칸 제목을 placeholder로 겸한다.
            <>
              <textarea
                value={draftParas.p1}
                onChange={(e) => fields.onDraft(student.id, subject.name, joinComment(e.target.value, draftParas.p2))}
                readOnly={rowLocked}
                placeholder={mentPlaceholder ?? (genRowBusy ? t("os.gen.busy") : t("os.row.ment1Ph"))}
                aria-label={tf("os.row.ment1Aria", { name: student.name, subject: subject.name })}
                className={`${mentBase} ${AUTOSIZE} ${lockedTone || "bg-background"} min-h-[52px]`}
              />
              <textarea
                value={draftParas.p2}
                onChange={(e) => fields.onDraft(student.id, subject.name, joinComment(draftParas.p1, e.target.value))}
                readOnly={rowLocked}
                placeholder={mentPlaceholder ?? (genRowBusy ? t("os.gen.busy") : t("os.row.ment2Ph"))}
                aria-label={tf("os.row.ment2Aria", { name: student.name, subject: subject.name })}
                className={`${mentBase} ${AUTOSIZE} ${lockedTone || "bg-background"} min-h-[52px]`}
              />
            </>
          ) : (
            <>
            {/* 맨 위 '수업 평가' 표는 편집 칸에서 빼서 읽기 전용 요약으로(원장 2026-10-26, 카드와 같은 규칙). */}
            <LevelsLead lead={draftLead.lead} compact />
            <textarea
              value={draftLead.body}
              onChange={(e) => fields.onDraft(student.id, subject.name, joinLevelsLead(draftLead.lead, e.target.value))}
              // 시범 대상 = 자동작성 전엔 보기만, 뒤엔 고칠 수 있다(카드와 같은 규약, 2026-10-23).
              readOnly={rowLocked || pilotLocked}
              // 말투 반영 안내(0262a)는 프로파일을 읽는 행(영어 밖)에만 — 영어 행은 템플릿 모드라 그 문장이 거짓이 된다.
              placeholder={mentPlaceholder ?? (genRowBusy ? t("os.gen.busy") : isEnglishRow ? t("os.row.mentPh") : t("os.row.mentPhVoice"))}
              aria-label={tf("os.row.mentAria", { name: student.name, subject: subject.name })}
              className={`${mentBase} ${AUTOSIZE} ${lockedTone || "bg-background"} min-h-[72px]`}
            />
            </>
          )}
          {englishFlags &&
          (englishFlags.stale || englishFlags.aiStale || englishFlags.nameMissing || englishFlags.needsAi) ? (
            // 영어 행 경고 — 표만 쓰는 강사도 보게(카드 칸과 같은 판정). 긴 설명은 title로, 고치기는 카드에서.
            <div className="flex flex-wrap gap-1">
              {englishFlags.needsAi ? (
                <span className={ENGLISH_FLAG} title={t("os.tpl.needAi")}>
                  {t("os.tpl.gridNeedAi")}
                </span>
              ) : null}
              {englishFlags.stale ? (
                <span className={ENGLISH_FLAG} title={t("os.tpl.stale")}>
                  {t("os.tpl.gridStale")}
                </span>
              ) : null}
              {englishFlags.aiStale ? (
                <span className={ENGLISH_FLAG} title={t("os.tpl.aiStale")}>
                  {t("os.tpl.gridAiStale")}
                </span>
              ) : null}
              {englishFlags.nameMissing ? (
                <span className={ENGLISH_FLAG} title={t("os.tpl.nameMissing")}>
                  {t("os.tpl.gridName")}
                </span>
              ) : null}
            </div>
          ) : null}
          {isEnglishRow ? null : (
            // 추세 칸 **오른쪽**에 '학습 추세 미발송'(원장 2026-09-18 *"오른쪽에 보기좋은 자리"*).
            // 🔴 반이 없는 행(수업외 보강)엔 안 그린다 — 키가 '같은 반'이라 성립하지 않는다.
            // 좁은 창(표 최소 폭)에선 문구 칸이 ~240px라 체크가 옆에 붙으면 추세 칸이 세 줄로 찌그러졌다(2026-10-27) → 넘치면 아래로.
            <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
              <textarea
                value={rep?.trendDraft ?? ""}
                onChange={(e) => fields.onTrend(student.id, subject.name, e.target.value)}
                readOnly={rowLocked || pilotLocked}
                placeholder={mentPlaceholder ?? t("os.row.trendPh")}
                aria-label={tf("os.row.trendAria", { name: student.name, subject: subject.name })}
                title={trendHidden ? t("os.row.trendOptOutOn") : undefined}
                className={`${mentBase} ${AUTOSIZE} ${lockedTone || "bg-bg-soft"} min-h-[48px] min-w-0 grow basis-[200px] ${
                  trendHidden ? "text-text-dim line-through decoration-1" : ""
                }`}
              />
              {fields.onTrendHidden && subject.classId ? (
                <label
                  className="text-text-dim mt-1.5 inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-medium whitespace-nowrap"
                  title={t("os.row.trendOptOutTitle")}
                >
                  <input
                    type="checkbox"
                    checked={trendHidden}
                    disabled={gen.readonlyView}
                    onChange={() => fields.onTrendHidden?.(student.id, subject.name)}
                    className="accent-primary size-3.5"
                  />
                  {t("os.row.trendOptOut")}
                </label>
              ) : null}
            </div>
          )}
        </div>
      </td>
      <td className={td}>
        <div className="flex flex-col items-stretch gap-1">
          <div className="flex gap-1">
            {aiOn ? (
            <button
              type="button"
              onClick={() => actions.onAutoWrite(student, subject.name)}
              disabled={genRowBusy || bulkGen || !canAutoWrite || alreadySent || gen.readonlyView}
              title={
                alreadySent
                  ? t("os.row.genSentLocked")
                  : canAutoWrite
                  ? t("os.row.genTitle")
                  : optoutRow
                    ? lockNotice
                    : isAbsent
                      ? t("os.row.genAbsent")
                      : t("os.row.genNoProgress") // 미발송 반은 위 optoutRow 분기가 먼저 잡는다
              }
              className={`border-line hover:bg-bg-soft flex-1 rounded-sm border px-1 py-1 text-xs font-bold disabled:opacity-50 ${
                hasDraft ? "text-primary" : "text-text-dim"
              }`}
            >
              {genRowBusy ? (
                "…"
              ) : hasDraft ? (
                <span className="inline-flex items-center justify-center gap-0.5">
                  <EyIcon name="check" size={11} /> {t("os.row.mentDone")}
                </span>
              ) : (
                t("os.row.gen")
              )}
            </button>
            ) : null}
            <GridAttachButton
              // 발송 완료건은 첨부도 잠근다 — 첨부 변경은 classnote 상태를 리셋해 **재발송을 여는 뒷문**이었다
              // (수정 금지 규칙을 우회하는 경로가 되어버린다).
              disabled={alreadySent || gen.readonlyView}
              disabledReason={
                gen.readonlyView
                  ? t("os.row.attachReadonly")
                  : t("os.row.attachSent")
              }
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
              onClick={() => actions.onOpenCard(student.id, subject.name)}
              title={t("os.row.cardTitle")}
              className="border-line text-text-dim hover:bg-bg-soft shrink-0 rounded-sm border px-1.5 py-1 text-xs font-bold"
            >
              {t("os.row.card")}
            </button>
          </div>
          {/* ClassNote 기능이 꺼진 학원엔 발송 버튼·발송 사유·상태·읽음 표시가 없다(2026-09-30). */}
          {classnoteOn ? (
          <>
          <Button
            size="sm"
            variant="outline"
            disabled={!canSend || bulkGen}
            title={bulkGen ? t("os.row.bulkGenBusy") : (sendGate.hint ?? undefined)}
            onClick={() => actions.onSendRow(student, subject.name)}
          >
            {alreadySent ? t("os.row.sent") : t("os.row.send")}
          </Button>
          {/* 🔴 막힌 이유는 **눈에 보이게** — 버튼 title 툴팁뿐이면 강사는 이유를 모른다(2026-07-21:
              네이티브 툴팁이 실제로 안 뜨는 사례 확인 / 2026-07-30 원장: "왜 비활성화됐는지 알 방법이
              없다"). 판정은 위 sendGate 단일 소스라 **비활성인데 라벨이 없는 상태가 생길 수 없다**.
              색은 사유 성격에 맞춘다: 결석=위험, 발송됨=완료, 남은 입력=주의(할 일). */}
          {sendGate.label ? (
            <span
              className={`text-center text-xs font-bold ${
                sendGate.reasons[0] === "absent"
                  ? "text-danger"
                  : sendGate.reasons[0] === "sent"
                    ? "text-primary"
                    : sendGate.reasons[0] === "readonly"
                      ? "text-purple"
                      : "text-amber"
              }`}
              title={sendGate.hint ?? undefined}
            >
              {sendGate.label}
            </span>
          ) : null}
          </>
          ) : null}
          {/* 멘트와 기록이 어긋남 — 발송을 막지는 않는다(강사 판단). 무엇을 볼지만 짚어 준다. */}
          {mentWarnings.map((w) => (
            <span
              key={w}
              className="text-amber text-center text-xs font-bold"
              title={t(MENT_WARNING_HINT[w])}
            >
              {t(MENT_WARNING_LABEL[w])}
            </span>
          ))}
          {/* 발송 상태 배지(큐·실패 등) — 발송 완료 라벨은 위 게이트가 이미 말했으므로 중복 표시하지 않는다. */}
          {classnoteOn && !alreadySent && badge ? (
            <span className={`text-center text-xs font-bold ${badge.cls}`}>{badge.label}</span>
          ) : null}
          {/* 학부모 읽음(0122a) — 양성 배지만(카드와 동일 규약, types.ts). 표는 세로 여유가 있어 풀 라벨. */}
          {classnoteOn && subject.classnoteReadAt ? (
            <span
              className="text-primary text-center text-xs font-bold"
              title={tf("os.row.readTitle", { when: readAtLabel(subject.classnoteReadAt, lang) })}
            >
              {t("os.row.read")}
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
