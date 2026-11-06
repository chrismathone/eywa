import { useState, type ReactNode } from "react";
import { MakeupClassTag } from "./makeup-class-tag";
import { TEXTAREA_AUTOSIZE } from "@/lib/ui/textarea";
import { useClassnoteOn } from "./classnote-on-context";
import { useLicenseOn } from "@/features/owner/operations-context";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Pill } from "@/components/atoms/pill";
import { RecallButton } from "@/features/report-admin/components/recall-button";
import { isRecallInFlight, isRecallable } from "@/features/report-admin/report-recall";
import { normalizeHomeworkPages } from "../homework-pages";
import { makeupRemoveBlockReason } from "../makeup-remove-plan";
import { makeupBadgeLabel } from "../makeup-label";
import {
  effectiveClassnoteStatus,
  isAlreadySent,
  isAttendanceUnchecked,
  isRowInputEditable,
  isReportEligible,
  isReportOptoutRow,
  isRowActionable,
} from "../grid";
import { resolveRowFields } from "../row-fields";
import { evaluateSendGate } from "../send-gate";
import { rowLockNotice } from "../split-rows";
import { reportOptoutNotice, reportOptoutShort } from "@/features/classes/report-optout";
import { checkMentConsistency, MENT_WARNING_HINT, MENT_WARNING_LABEL } from "../ment-consistency";
import { parentUnreadBadge, progressAnomalyBadge } from "../roster-signals";
import {
  AttendancePills,
  SessionUnitsField,
  type AttendanceExtra,
  type BasicAttendance,
  type AttendanceSelection,
} from "./attendance-pills";
import { FieldSelect } from "./field-select";
import { isMathBookRow, useMathBookListId } from "./math-book-list";
import { JjBookPicker } from "./jj-book-picker";
import { isJjSheetDraft, isJjSheetReport, isProgressOptionalReport } from "../jj-books";
import { LoveNoteDraftButton } from "./love-note-draft-button";
import { HomeworkRateInput } from "./homework-rate-input";
import { VideoHomeworkCheck } from "@/features/video-homework/components/video-homework-provider";
import { VideoHomeworkToggle } from "@/features/video-homework/components/video-homework-toggle";
import { VideoHomeworkDueToggle } from "@/features/video-homework/components/video-homework-due-toggle";
import { VideoSubmitLinkToggle } from "@/features/video-homework/components/video-submit-link-toggle";
import { ENGLISH_DRAFT_TEXTAREA_ID, REPORT_ATTACHMENT_MAX, isImageAttachment } from "../attachment-utils";
import { joinLevelsLead, splitLevelsLead } from "../pilot-notes";
import { LevelsLead } from "./levels-lead";
import { hasTextBesidesMarkers } from "@/features/report-templates/image-slots";
import { splitComment, joinComment } from "../comment-paragraphs";
import type { OneScreenStudent } from "../types";
import { classnoteBadge, type ClassnoteBadge } from "../classnote-badge";
import { attendanceMarkBadgeClass, attendanceMarkLabel } from "../attendance-mark";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { hasPilotOneLine, isMathReportPilot, pilotCanEdit, pilotNeedsAutoWrite } from "../math-report-pilot";
import { needsAttitudeNote, needsHomeworkMissReason, pilotRowSig, testSkipComplete } from "../math-report-pilot-sections";
import type { SheetLang } from "@/features/teacher-view/i18n";
import { ReservedMakeupTag } from "./reserved-makeup-tag";
import { ReportLockNotice } from "./report-lock-notice";
import { needsMakeupCheck } from "../reserved-makeup";
import { MakeupSwitchButton } from "./makeup-switch-button";

// shareToken: 저장 시 발급되는 학부모 공개 링크(/r/[token]) 토큰. 세션 내 저장 후에만 존재.
// classnoteStatus: ClassNote 발송 큐 상태(queued/processing/success/failed/too_old) — 발송 후에만.
// revoked: 공유링크 취소됨(P2a) — 링크 열람 차단, 재발급 필요. viewCount: 학부모 열람 수.
export type SubjectReport = {
  draft: string;
  trendDraft?: string; // 학습 추세(종합분석) 초안 — 4a. 멘트(draft)와 별개, 자동작성 시 함께 채움.
  // 자동작성이 멘트 칸에 마지막으로 넣은 텍스트(0214a) — 저장 시 draft와 비교해 작성 방식(ment_source) 판정.
  autoDraft?: string;
  /** autoDraft가 AI 원문이 아니다(실패 폴백 템플릿·지난 회차 복사) — 자동작성 원문(0370a)으로 싣지 않는다(말투 학습이 엉뚱한 차이를 배우지 않게). */
  autoDraftTemplate?: boolean;
  /** 수학 보고서 시범 — 자동작성할 때 쓴 사실 서명(`pilotRowSig`). 이해도 점수처럼 글에 없는 값이 있어 화면이 들고 있다가 발송 게이트에서 대조한다. */
  pilotFactsSig?: string;
  /** 자동작성이 추세 칸에 마지막으로 넣은 글 — '달라진 것 없음'(trendQuiet)이면 칸이 이 글 그대로일 때만 비운다(손글씨는 지킨다). */
  trendAutoDraft?: string;
  sent: boolean;
  shareToken?: string;
  /** null = 이번 세션에서 명시적으로 해제됨(재발급·첨부변경). undefined = 아직 모름 — 둘은 다르다. */
  classnoteStatus?: string | null;
  revoked?: boolean;
  viewCount?: number;
  attachments?: { path: string; name: string }[]; // 학생 사진 첨부(P2b)
  // ── 영어 템플릿 모드(2026-09-10) — 영어 행에서만 쓴다. 세션에 실려 새로고침에도 남는다. ──
  /** 고른 템플릿 id(없으면 기본 템플릿). */
  templateId?: string;
  /**
   * `templateId`가 강사가 고른 것이 아니라 **내 기본값**(반별 마지막 선택, last-template.ts)으로 붙은 것이다(화면 메모리 전용).
   * 세션에 안 싣고, 고르거나 글을 짜면 지운다. 지운 사용자 템플릿·목록 실패면 기본값을 거둔다.
   */
  templateImplicit?: boolean;
  /** 다음 시간 테스트 안내 — 템플릿 `{다음테스트}` 칸. */
  nextTest?: string;
  /** EiE 일일 보고서(2026-11-06) — 단어 테스트 피드백(`{단어피드백}`) · 재시험 표시(`{단어테스트}` 맨 윗줄). 세션에 실린다. */
  wordFeedback?: string;
  wordRetest?: boolean;
  /** 마지막 AI 인사말·코멘트 — 템플릿을 바꾸거나 다시 채울 때 AI를 다시 부르지 않고 쓴다. */
  aiIntro?: string;
  aiComment?: string;
  /**
   * 템플릿이 **마지막으로 만든 글**의 지문(provenance.ts) — 이것과 같은 글만 "손대지 않은 템플릿 글"이다.
   * `draft === autoDraft`로 판정하면 '이전 회차 가져오기'로 넣은 글도 템플릿 글로 오인해 다시 조립한다.
   */
  templateHash?: string;
  /** AI 코멘트를 쓸 때 넘긴 사실의 지문 — 지금 칸 값과 다르면 "코멘트가 옛 값 기준" 경고(저장해도 안 사라진다). */
  aiFactsHash?: string;
  /** 지금 글을 짤 때 쓴 칸 값의 지문(english-draft `templateFactsKey`) — 템플릿과 무관한 "옛 값 담김" 판정용. */
  composedFactsHash?: string;
  /**
   * 자동작성 중 강사가 글을 고쳐 **글에 넣지 못한** AI 결과 — 화면 메모리에만 둔다(세션에 안 싣는다).
   * '다시 채우기'가 이것으로 채우고 지문을 옮긴다. 글에 든 AI 문장·지문은 그대로여야 'AI 코멘트 옛 값' 판정이 산다.
   */
  pendingAi?: { intro: string; comment: string; factsHash: string };
  /**
   * 강사가 고른 템플릿인데 AI 글이 없어 **아직 글에 못 쓴 것**(화면 메모리 전용). 🔴 `templateId`(글을 만든 템플릿)는
   * AI 글이 생길 때까지 바꾸지 않는다 — 바꾸면 판정이 어긋나 고친 점수가 옛 값으로 나갔다. 자동작성이 이 선택을 완성한다.
   */
  pendingTemplateId?: string;
  /** 강사가 '그대로 내보낸다'고 확인한 시점의 값(english-draft `outputAckKey`, 화면 메모리 전용) — 확인 창만 본다. */
  outputAck?: string;
};

const MAX_ATTACHMENTS = REPORT_ATTACHMENT_MAX;

/**
 * classnote_status → 표시 라벨 + 색 — **정본은 [classnote-badge.ts](../classnote-badge.ts)** 로 옮겼다.
 *
 * 🔴 이 파일은 `useState`를 쓰는 **클라 컴포넌트**라, 서버 컴포넌트(학생 상세 진도 탭)가 여기서
 * import하면 Next가 빌드 에러를 낸다("useState에 의존하는 모듈을 서버 컴포넌트로 가져왔다") —
 * 실제로 학생 상세가 통째로 안 열렸다(2026-08-18). 라벨·색은 순수 데이터라 컴포넌트에 묶을 이유가 없다.
 * 기존 import 경로를 쓰는 곳(원스크린 표·발송 콘솔 등)을 위해 re-export만 남긴다.
 */
export { classnoteBadge };
export type { ClassnoteBadge };

/**
 * 학부모 읽음 툴팁용 KST 일시("7월 18일 13:01") — 원장 목록(report-list readAtLabel)과 같은 표기. 표뷰 공용 → export.
 * 🔴 시각대는 언제나 KST다 — 바뀌는 건 **글자 형식**뿐(en이면 `July 18, 13:01`). 원장 목록(사무실 화면)은
 *    자기 사본을 쓰므로 여기 인자는 강사뷰에서만 넘어온다.
 */
export function readAtLabel(iso: string, lang: SheetLang = "ko"): string {
  return new Date(iso).toLocaleString(lang === "en" ? "en-US" : "ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * today 보고서 카드 — **과목별로 따로** 작성·발송.
 * 과목 칩으로 전환하면 그 과목 진도만 담긴 초안을 만들고 개별 발송한다.
 * (드래프트·발송 상태는 과목별로 분리 — 부모는 reports[과목명] 맵으로 전달.)
 */
export function ReportCard({
  student,
  reports,
  attitudes,
  onAttitude,
  onHomework,
  onTextbook,
  onHomeworkToday,
  onMakeup,
  onVideoHomework,
  onVideoSubmitLink,
  onVideoHomeworkDue,
  onRemoveMakeup,
  onJoinMakeup,
  onSplitMakeup,
  canRemoveMakeup,
  onPickMakeupClass,
  onCheckMakeup,
  onSubjectDraft,
  onSubjectTrend,
  trendOptOut,
  onNote,
  onAutoWrite,
  generatingSubject,
  onSend,
  onQueueClassnote,
  onRevoke,
  onReissue,
  onAddFiles,
  onRemoveAttachment,
  attachmentUrls,
  uploadingSubject,
  attachmentsHidden,
  attendance,
  noticeMode = "A",
  subjectIndex,
  onSubjectIndex,
  todayInputs,
  homeworkExtra,
  attitudeExtra,
  makeupExtra,
  templatePanel,
  shareCopyWarning = null,
  readonlyView = false,
}: {
  student: OneScreenStudent;
  reports: Record<string, SubjectReport>;
  attitudes: readonly string[];
  onAttitude: (a: string) => void;
  onHomework: (h: string) => void;
  onTextbook: (subjectName: string, text: string) => void; // 교재명(과목별) — 0089a
  onHomeworkToday: (subjectName: string, text: string) => void; // 오늘 과제(숙제 내용, 과목별) — 0096a
  /** 합침 취소(정규+보강 → 정규) — '정규+보강' 버튼에서만(옛 보강 토글은 2026-09-30 제거). */
  onMakeup: (subjectName: string) => void;
  /** 오늘 영상 과제 있음/없음(0308a). 없으면 버튼이 잠긴다. */
  onVideoHomework?: (subjectName: string) => void;
  /** 영상 첨부 링크 넣기(0328a) — '영상 과제'를 켠 행에서만 뜬다. 없으면 버튼이 잠긴다. */
  onVideoSubmitLink?: (subjectName: string) => void;
  /** 영상 숙제 마감(7일 · 다음 수업, 원장 2026-10-15) — '영상 과제'를 켠 행에서만 뜬다. 없으면 잠긴다. */
  onVideoHomeworkDue?: (subjectName: string, mode: "week" | "next") => void;
  /** 보강 빼기(2026-08-18) — 출결·저장된 보강 보고서를 지운다. 없으면 배지가 표시로만 남는다. */
  onRemoveMakeup?: (subjectName: string) => void;
  /** 보강 보고서 합치기 · 나누기(원장 2026-10-22 — 판정 makeup-switch.ts). 없으면 버튼이 없다. */
  onJoinMakeup?: (subjectName: string) => void;
  onSplitMakeup?: (subjectName: string) => void;
  /** 이 행을 뺄 수 있나 — 발송·처리 중이면 false(발송된 보강은 취소 불가, 원장 2026-08-18). */
  canRemoveMakeup?: (subjectName: string) => boolean;
  /** 보강 반 고르기(원장 2026-09-30) — 없으면 반 표시만. */
  onPickMakeupClass?: (subjectName: string) => void;
  /** 보강 진행 여부 확인(원장 2026-10-27 — 보강 예약 표식을 눌러 했음/못 했음) — 없으면 표식은 표시만. */
  onCheckMakeup?: (subjectName: string, outcome: "done" | "missed") => void;
  onSubjectDraft: (subjectName: string, text: string) => void;
  onSubjectTrend: (subjectName: string, text: string) => void; // 학습 추세 초안 편집(4a)
  /** '학습 추세 미발송'(원장 2026-09-18) — 표와 **같은 상태**(계정 ui_prefs). 없으면 체크를 안 그린다. */
  trendOptOut?: { hidden: (subjectName: string) => boolean; toggle: (subjectName: string) => void };
  onNote: (text: string) => void; // 특이사항(강사 메모) 편집 — AI 멘트 입력(4c). 학생별.
  onAutoWrite: (subjectName: string) => void;
  generatingSubject?: string | null; // 현재 AI 멘트 생성 중인 과목(버튼 로딩)
  onSend: (subjectName: string, channel: string) => void;
  onQueueClassnote: (subjectName: string) => void; // ClassNote 발송 큐 적재
  onRevoke: (subjectName: string) => void; // 공유링크 취소(열람 차단)
  onReissue: (subjectName: string) => void; // 공유링크 재발급(새 토큰)
  onAddFiles: (subjectName: string, files: File[]) => void; // 사진 첨부(P2b)
  onRemoveAttachment: (subjectName: string, path: string) => void;
  attachmentUrls?: Record<string, string>; // path→signed 썸네일 URL
  uploadingSubject?: string | null; // 첨부 업로드 중인 과목
  /** 학원설정 '사진/파일 첨부'가 꺼짐 — 첨부는 저장되지만 /r·인쇄·ClassNote 어디에도 안 실린다는 경고 표시. */
  attachmentsHidden?: boolean;
  // 출결 인라인 입력(2-2) — 표뷰와 동일 pill. pendingKeys=(학생::반) 저장 중 잠금.
  attendance?: {
    pendingKeys: ReadonlySet<string>;
    onSet: (classId: string, status: AttendanceSelection, extra?: AttendanceExtra) => void;
    readOnly?: boolean; // 출결 쓰기 권한 없음 — pill 대신 표시 전용 배지
  };
  // 실효 멘트 모드(강사 오버라이드 ?? 학원 기본) — 상단 토글의 하단 반영. B=수업내용·태도 2칸 분리 입력.
  noticeMode?: "A" | "B";
  /**
   * 선택된 과목 칩(다과목 학생) — **부모가 들고 있다**. 옆 열의 학부모 미리보기가 "지금 보고 있는 과목"을
   * 그려야 하는데, 카드 안에 state로 숨어 있으면 미리보기가 알 수 없다. 미지정이면 카드가 자체 state를 쓴다.
   */
  subjectIndex?: number;
  onSubjectIndex?: (idx: number) => void;
  /**
   * 오늘 진도·테스트 입력(ProgressCard + TestCard) — **노드로 받는다**. 이 카드가 그 배선(진도 편집·점수·
   * 문항수·표기모드 콜백 7개)까지 props로 받으면 카드 하나가 30개를 넘긴다(CLAUDE.md props 10개 규칙).
   * 배선은 원래 있던 자리(onescreen-client)에 그대로 두고, 이 카드는 **자리만** 내준다.
   */
  todayInputs?: ReactNode;
  /** 숙제 완성도 칸 바로 아래 자리(수학 보고서 시범의 '미제출 사유', 2026-10-23) — todayInputs와 같은 슬롯 규약. */
  homeworkExtra?: ReactNode;
  /** 수업 태도 칸 바로 아래 자리('수업 태도 의견' — 하·중하, 2026-10-26). 같은 슬롯 규약. */
  attitudeExtra?: ReactNode;
  /** 수업 태도 칸 위 자리('보강 사유' — 결석 날짜를 모르는 보강 줄, 2026-10-26). 같은 슬롯 규약. */
  makeupExtra?: ReactNode;
  /**
   * 영어 행의 **템플릿 칸**(2026-09-10) — todayInputs와 같은 슬롯 규약(배선은 onescreen-client, 카드는 자리만).
   * 영어 행일 때만 그린다. 수학 행은 이 값을 넘겨도 무시한다.
   */
  templatePanel?: ReactNode;
  /**
   * 학부모 링크를 복사하기 전에 물을 문장(없으면 묻지 않는다) — 영어 행에서 AI 인사말·코멘트가 옛 값 기준일 때만
   * 부모가 넘긴다. 링크는 저장된 글을 그대로 보여 주므로 발송·글 복사와 같은 확인을 거친다. 판정은 부모 몫.
   */
  shareCopyWarning?: string | null;
  /** '다른 강사 뷰'(열람 전용) — 카드 입력·발송·저장·공유링크 조작 전부 잠금(2026-08-19). */
  readonlyView?: boolean;
}) {
  // 🔴 훅은 아래 early return(`if (!subject) return null`)보다 **앞**에 — 조건부 호출 금지.
  const lang = useSheetLang();
  const t = useSheetT();
  const classnoteOn = useClassnoteOn();
  // AI 라이선스가 꺼진 지점엔 '자동 작성' 버튼이 없다(2026-09-30 "꺼지면 흔적 없이") — 서버 generateJSON이 따로 막는다.
  const aiOn = useLicenseOn("ai_analysis");
  const tf = useSheetTf();
  const mathBookList = useMathBookListId(); // 교재명 칸 제안(수학 행만, math-book-list.ts)
  const [ownIdx, setOwnIdx] = useState(0);
  const selIdx = subjectIndex ?? ownIdx;
  const setSelIdx = onSubjectIndex ?? setOwnIdx;
  const idx = Math.min(selIdx, student.subjects.length - 1);
  const subject = student.subjects[idx];
  if (!subject) return null;
  const subjectName = subject.name;
  // 카드의 태도·과제·특이사항·점수 칸은 **선택된 행**의 값이다(row-fields.ts) — 보강 행을 고르면
  // 보강 값이 뜨고, 정규 행을 고르면 정규 값이 뜬다. 예전엔 학생 한 벌을 공유해 서로 덮어썼다.
  const cardEval = resolveRowFields(student, subject);
  const rep = reports[subjectName] ?? { draft: "", sent: false };
  // 학부모 공개 링크 — 저장 후(shareToken 존재) 노출. 강사가 복사해 카톡/문자로 전달.
  // 🔴 **표시 텍스트에 `window.location.origin`을 쓰지 말 것**(React #418). 이 카드는 서버에서도
  //    렌더되는데 거기선 origin이 `""`라 같은 자리에 서버는 `/r/…`, 클라는 `https://…/r/…`를 그려
  //    텍스트 노드가 갈렸다 → 하이드레이션 실패로 **카드 subtree가 클라에서 통째로 재생성**된다
  //    (콘솔 `Minified React error #418`, args `["text",""]`. 같은 오류로 예전에 페이지 클릭이 전부
  //    먹통이 된 전례가 있다 — gotchas #75).
  //    · 표시 = 빌드 시 인라인되는 `NEXT_PUBLIC_APP_URL`(서버·클라 값이 동일해 갈릴 수 없다)
  //    · 복사 = 클릭 시점의 실제 `window.location.origin`(커스텀 도메인·프리뷰에서도 유효한 주소)
  const sharePath = rep.shareToken ? `/r/${rep.shareToken}` : "";
  const shareUrl = sharePath ? `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "")}${sharePath}` : "";
  const generating = generatingSubject === subjectName; // 이 과목 AI 멘트 생성 중
  const cnBadge = classnoteBadge(rep.classnoteStatus, lang); // ClassNote 발송 상태 배지
  // 재발송 차단(2026-07-22) — 화면 state가 로스터 스냅샷을 이긴다.
  // ⚠️ `??`가 아니라 effectiveClassnoteStatus: 재발급·첨부변경이 상태를 **명시적으로 지운**(null) 뒤에도
  //    `??`면 스냅샷의 옛 "success"가 되살아나 잠금이 안 풀린다(적대 검수 확정).
  const liveStatus = effectiveClassnoteStatus(rep.classnoteStatus, subject.classnoteStatus);
  const alreadySent = isAlreadySent(liveStatus);
  // 학부모 게시판에 **글이 실제로 올라간** 건인가 — 회수/재발송이 의미 있는 대상(회수 진행 중·실패 포함).
  // 이 판정으로 '취소·재발급'(링크만 건드림)을 감춘다: 게시글은 이미지라 링크를 만져도 학부모 화면은 그대로다.
  const postedToBoard = isRecallable({ classnoteStatus: liveStatus ?? null, shareToken: rep.shareToken ?? null })
    || isRecallInFlight(liveStatus ?? null);
  // 발송 게이트 = 표뷰와 **같은 단일 소스**(send-gate.ts) — 카드만 다른 판정을 쓰면 한쪽에서만
  // "왜 안 눌리지"가 생긴다(#77). 멘트 미작성도 여기서 막는다(빈 멘트 절대 가드가 어차피 거절).
  const isAbsent = subject.attendanceRaw === "absent";
  const optoutRow = isReportOptoutRow(subject); // '수업보고서 미발송' 반 — 보고서 쪽만 잠긴다(0174a)
  // 잠긴 이유 문구 — 나눔 행이면 "보고서는 원래 반에서", 아니면 미발송 반 문구(split-rows.ts 단일 소스).
  const lockNotice = rowLockNotice(subject, reportOptoutNotice(lang));
  // 잠긴 칸 안의 짧은 글(긴 문장은 카드 머리 아래 안내가 한 번 적는다) — "'자동작성'을 먼저 눌러…" 같은 거짓 안내 대신(원장 2026-11-04).
  const lockShort = subject.splitIn ? lockNotice : reportOptoutShort(lang);
  // 이 행의 입력을 잠그나 — 발송 완료 **또는 결석**(표 모드와 같은 단일 소스, grid.ts).
  // 2026-08-07 확대: 예전엔 왼쪽 기록 열이 `alreadySent`만 봐서, 결석을 눌러도 진도·태도가 그대로 열려 있었다.
  // 열람 전용(다른 강사 뷰)이면 무조건 잠금 — 3개 fieldset(입력 열·멘트 열·첨부)이 이 값 하나를 본다.
  const locked = readonlyView || !isRowInputEditable(subject, liveStatus);
  // 수학 보고서 시범(테스트 학생 한정, math-report-pilot.ts) — 멘트·추세는 보기만, 자동작성 글 그대로여야 발송.
  const pilot = isMathReportPilot(student.id, subject.subjectKey);
  const pilotLocked = pilot && !pilotCanEdit(rep.autoDraft); // 자동작성 전엔 잠금(2026-10-23)
  // '사랑의 한마디' 행 — 새 수학 보고서 + 영어(원장 2026-10-26 *"영어도 수학이랑 동일하게 특이사항 말고 사랑의 한마디 · 밑에 배치 · 필수"*).
  const oneLineRow = pilot || subject.subjectKey === "english";
  // JJ 수업보고서 글 — 사랑의 한마디는 선택(비우면 그 항목이 빠진다, 원장 2026-10-27).
  const jjOptionalNote = subject.subjectKey === "english" && isJjSheetDraft(rep);
  const progressOptional = isProgressOptionalReport(subject, rep); // SRS 글은 진도 항목이 없다(원장 2026-11-05)
  const sendGate = evaluateSendGate({
    lang, // 🔴 판정이 아니라 **글자**만 갈린다(canSend·reasons 불변, send-gate.ts)
    needsAutoWrite:
      pilot &&
      pilotNeedsAutoWrite(rep.draft, rep.autoDraft, {
        studentName: student.name,
        today: subject.today,
        progressMode: subject.progressMode,
        note: cardEval.note,
        factsSig: pilotRowSig(student, subject.name),
        writtenSig: rep?.pilotFactsSig,
      }),
    needsOneLine: oneLineRow && !jjOptionalNote && !hasPilotOneLine(cardEval.note), // 사랑의 한마디(옛 강사 한줄 멘트) 필수(원장 2026-10-22)
    needsTestReason: pilot && !testSkipComplete(subject.dailyTestSkip), // 일일 테스트 '없음'이면 사유 필수(원장 2026-10-22)
    needsHomeworkReason: pilot && needsHomeworkMissReason(cardEval.homework, subject.homeworkMissReason), // 숙제 미제출이면 사유 필수(원장 2026-10-23)
    needsAttitudeNote: pilot && needsAttitudeNote(cardEval.attitude, subject.attitudeNote), // 태도 하·중하면 의견 3줄 이상(원장 2026-10-26)
    needsMakeupCheck: needsMakeupCheck(subject), // 보강 예약이 든 줄은 보강 진행 여부 확인 뒤에(원장 2026-10-27)
    readonlyView, // 열람 전용 — 사유 라벨까지 게이트가 만든다(표뷰와 동일)
    recallPending: isRecallInFlight(liveStatus ?? null),
    // 발송 대기·게시 중 — 워커 결과 전까지 다시 못 누른다(표뷰와 같은 판정, 원장 2026-09-29).
    sendInFlight: liveStatus === "queued" || liveStatus === "processing",
    alreadySent,
    reportOptout: optoutRow, // 미발송 반(0174a) — 표뷰와 같은 단일 소스
    isAbsent,
    hasProgress: isReportEligible(subject, progressOptional),
    // 멘트 = 학부모에게 나갈 글 — 영어 글의 그림·사진 자리 줄뿐이면 서버가 막으니 여기서도 '멘트 없음'(표뷰와 같은 판정).
    hasDraft: hasTextBesidesMarkers(rep.draft),
    // 출결 쓰기 권한 없음 = 게이트 해당 없음(P0-3) — 표뷰(grid-row)와 동일 예외.
    attendanceUnchecked: !attendance?.readOnly && isAttendanceUnchecked(subject),
  });
  const canQueue = sendGate.canSend; // 열람 전용 포함 — 판정·사유는 send-gate 단일 소스
  // 영어 행 = 템플릿 모드(2026-09-10) — 글이 템플릿으로 조립되므로 2칸 나누기·학습 추세·멘트 불일치 경고를
  // 쓰지 않는다(수학 행은 아래 판정이 그대로다).
  const isEnglishRow = subject.subjectKey === "english";
  // 멘트 ↔ 기록 불일치(시험날 진도·멘트에만 있는 점수) — 표뷰와 같은 판정. 막지 않고 알린다.
  // ⚠️ 영어 템플릿 글은 '테스트 : …' 줄을 일부러 담는다 — 이 경고를 걸면 모든 영어 글이 헛경고를 단다.
  const mentWarnings = isEnglishRow ? [] : checkMentConsistency({
    ment: rep.draft ?? "",
    progress: subject.today ?? "",
    dailyTest: cardEval.tests.daily.score != null ? "y" : "",
    checkTest: cardEval.tests.check.score != null ? "y" : "",
  });
  const atts = rep.attachments ?? []; // 학생 사진 첨부(P2b)
  const uploadingAtt = uploadingSubject === subjectName;
  // 로스터 신호(G2·G3) — 카드 헤더 배지. 진도 신호는 math 전용 데이터라 수학 과목 보유 학생만(표뷰와 동일 규약).
  const hasMathSubject = student.subjects.some((su) => !su.subjectKey || su.subjectKey === "math");
  const showProgressBadge = hasMathSubject && progressAnomalyBadge(student.progressSignal);
  // 학부모 읽음(G3)도 같은 게이트 — RPC는 학생의 **모든** 보고서를 세는데 발송분이 아직 전부 수학이라
  // (subject='english' 0건, 2026-07-29), 영어 강사 화면에 달면 "당신의 영어 보고서가 미확인"으로 읽힌다.
  // 📌 영어 발송이 시작되면 RPC에 과목을 넘겨 과목별로 세고 이 게이트를 그때 푼다.
  const unreadBadge = classnoteOn && hasMathSubject ? parentUnreadBadge(student.parentRead) : null;
  // 멘트 모드 B = 초안을 2문단(수업 내용 / 태도·특이사항)으로 나눠 편집. 값은 단일 문자열 그대로 저장.
  // 영어 템플릿 글은 문단이 여럿이라 2칸으로 쪼개면 템플릿이 망가진다 → 영어 행은 늘 한 칸.
  // 시범 대상은 단일 문단 고정(서버도 A로 쓴다 — math-report-pilot.ts).
  const para = noticeMode === "B" && !isEnglishRow && !pilot;
  // 특이사항 칸 — 수학 보고서 시범에선 '사랑의 한마디'라 보고서 끝에 붙는다. 그래서 칸도 오른쪽 열 **맨 아래**(보고서 글·학습 추세 뒤,
  // 발송 버튼 바로 위)에 둔다(원장 2026-10-23 *"사랑의 한마디를 더 밑으로 내려달라고"*). 그 밖의 행은 종전처럼 맨 위.
  const noteField = (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`teacher-note-${student.id}`} className="micro text-text-faint">{jjOptionalNote ? t("os.card.noteJj") : oneLineRow ? t("os.card.notePilot") : t("os.card.note")}</label>
        {/* 사랑의 한마디 [초안](원장 2026-10-28) — 누를 때만 AI. 잠긴 카드·AI 꺼진 지점엔 안 선다. */}
        {oneLineRow && aiOn && !locked ? <LoveNoteDraftButton student={student} subject={subject} value={cardEval.note} onFill={onNote} /> : null}
      </div>
      <textarea
        id={`teacher-note-${student.id}`}
        rows={3}
        value={cardEval.note}
        onChange={(e) => onNote(e.target.value)}
        placeholder={optoutRow ? lockShort : jjOptionalNote ? t("os.card.notePhJj") : oneLineRow ? t("os.card.notePhPilot") : t("os.card.notePh")}
        className={`${TEXTAREA_AUTOSIZE} border-line focus:border-primary min-h-20 rounded-lg border bg-background px-3 py-2 text-sm leading-relaxed outline-none`}
      />
    </div>
  );
  const paras = splitComment(rep.draft);
  const draftLead = splitLevelsLead(rep.draft); // 맨 위 수업 평가 표 = 읽기 전용(원장 2026-10-26)

  return (
    // @container — 아래 본문 2열 분기는 **창 폭이 아니라 이 카드 폭** 기준(3열 그리드 안이라 브레이크포인트가 안 맞음).
    <div className="bg-card border-line shadow-card @container flex flex-col rounded-2xl border">
      <header className="border-line border-b px-3 py-2.5">
        <div className="flex items-center justify-between">
          <div>
            <p className="micro text-text-faint">
              {student.subjects.length > 1 ? t("os.card.kickerSubjects") : t("os.card.kicker")}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-foreground text-base font-bold">
                {tf("os.card.title", { name: student.name })}
              </p>
              {/* 보강 빼기 — 표 모드와 같은 문(원장 2026-08-18 *"다 삭제"*). 확인 후 출결·보고서를 지운다. */}
              {/* 순수 보강 행이면 정규 학생 카드에서도 뺄 수 있어야 한다(적대 리뷰 M2) — 학생 단위
                  isMakeup만 보면 "정규 수업도 듣는 학생의 보강"에 문이 없다. 반이 붙은 '정규+보강'은 제외. */}
              {/* 보강 반(= 발송 반 = 출석부 칸의 반) — 반 미정이면 눌러서 고른다(원장 2026-09-30). */}
              <MakeupClassTag subject={subject} onPick={onPickMakeupClass ? () => onPickMakeupClass(subject.name) : undefined} />
              {(student.isMakeup || (subject.makeup && !subject.classId)) &&
              onRemoveMakeup &&
              (canRemoveMakeup?.(subject.name) ?? true) ? (
                <button
                  type="button"
                  onClick={() => onRemoveMakeup(subject.name)}
                  title={t("os.row.makeupRemove")}
                  aria-label={tf("os.row.makeupRemoveAria", { name: student.name })}
                  className="bg-amber-soft text-amber hover:bg-amber inline-flex cursor-pointer items-center gap-0.5 rounded-pill px-1.5 py-px text-xs font-bold transition hover:text-white"
                >
                  {t("os.card.makeup")}
                  <EyIcon name="close" size={9} />
                </button>
              ) : student.isMakeup || (subject.makeup && !subject.classId) ? (
                // 뺄 수 없는 행 — 왜인지 툴팁으로 남긴다(버튼만 없애면 "왜 안 되지"가 남는다).
                <span
                  className="bg-amber-soft text-amber rounded-pill px-1.5 py-px text-xs font-bold"
                  title={makeupRemoveBlockReason(rep.classnoteStatus, lang) ?? undefined}
                >
                  {t("os.card.makeup")}
                </span>
              ) : null}
              {/* 합치기(원장 2026-10-22) — 오늘 같은 과목 정규 줄이 있는 '(보강)' 줄만. 같은 반이 아니면 누를 때 이유를 알린다. */}
              {onJoinMakeup && subject.makeup && !subject.classId &&
              student.subjects.some((x) => !x.makeup && !!x.classId && (x.subjectKey ?? "") === (subject.subjectKey ?? "")) ? (
                <MakeupSwitchButton kind="join" onClick={() => onJoinMakeup(subject.name)} />
              ) : null}
              {/* 로스터 신호(G2·G3) — 표뷰와 동일 판정(roster-signals.ts). 카드는 학생 단위라 진도 배지는
                  수학 과목 보유 시(진도 파이프라인=math 전용). 카피 "미확인"(단정 금지). */}
              {unreadBadge ? (
                <span
                  className="bg-amber-soft text-amber rounded-pill px-1.5 py-px text-xs font-bold"
                  title={tf("os.row.unreadTitle", { n: unreadBadge.count })}
                >
                  {tf("os.row.unread", { n: unreadBadge.count })}
                </span>
              ) : null}
              {showProgressBadge ? (
                <span
                  className="bg-danger-soft text-danger rounded-pill px-1.5 py-px text-xs font-bold"
                  title={t("os.card.jumpTitle")}
                >
                  {t("os.row.jump")}
                </span>
              ) : null}
              {/* 보강 예약(0264a) — 이 줄에 걸린 그날 보강(원장 2026-10-22). 눌러서 보강 진행 여부 확인(2026-10-27). */}
              <ReservedMakeupTag
                list={subject.makeupReserved}
                size="md"
                onCheck={onCheckMakeup && !readonlyView ? (outcome) => onCheckMakeup(subject.name, outcome) : undefined}
              />
              {/* 수업 나누기(0351a) — 이 행이 왜 여기 있는지 / 그 시간이 어디로 가는지를 **글자로**(hover는 모바일에서 없다). */}
              {subject.splitIn || subject.splitOut ? (
                <span className="bg-blue-soft text-blue rounded-pill px-1.5 py-px text-xs font-bold">
                  {subject.splitIn ?? subject.splitOut}
                </span>
              ) : null}
              {/* '수업보고서 미발송' 반 — 아래 입력이 왜 전부 잠겼는지 카드 머리에서 먼저 밝힌다(2026-08-19). */}
              {optoutRow ? (
                <span
                  className="border-line text-text-dim rounded-pill border px-1.5 py-px text-xs font-bold"
                  title={lockNotice}
                >
                  {subject.splitIn ? t("os.row.splitIn") : reportOptoutShort(lang)}
                </span>
              ) : null}
            </div>
          </div>
          {/* 실발송이 아니라 lesson_reports 기록 저장(PDF만 실제 인쇄). "발송 완료" 거짓 약속 방지. */}
          {rep.sent ? <Pill color="primary">{t("os.card.saved")}</Pill> : null}
        </div>
        {/* 출결·수업타임 — **이름 바로 아래**(표뷰와 같은 자리). 원장 2026-08-05: *"표 모드에서는 출석/지각/
            결석이 바로 이름 아래에 보이는데 카드에서는 못찾겠"* — 예전엔 아래 교재명 블록 안에 묻혀 있었다.
            행(반) 단위(subject.classId)라 과목 알약 아래에 둔다(선택 과목이 바뀌면 이 값도 바뀐다).
            보강 행·반 모호(같은 과목 2반)는 기록할 자리가 없어 배지만(출석부에서 기록). */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-text-dim inline-flex" role="img" aria-label={t("os.card.attendance")} title={t("os.card.attendance")}>
            <EyIcon name="clipboardCheck" size={16} />
          </span>
          {attendance && !student.isMakeup && subject.classId ? (
            <>
              <AttendancePills
                value={subject.attendanceRaw}
                note={subject.attendanceNote}
                pending={attendance.pendingKeys.has(`${student.id}::${subject.classId}`)}
                onSet={(s, extra) => attendance.onSet(subject.classId!, s, extra)}
                studentName={student.name}
                readOnly={attendance.readOnly}
              />
              {/* 수업타임 — pill 옆이지만 **읽을 수 있는 크기**로(원장 2026-08-05 "타임이 너무 작다"). */}
              {attendance.readOnly ? null : (
                <SessionUnitsField
                  units={subject.attendanceUnits}
                  status={(subject.attendanceRaw as BasicAttendance | null | undefined) ?? null}
                  pending={attendance.pendingKeys.has(`${student.id}::${subject.classId}`)}
                  onSet={(s, extra) => attendance.onSet(subject.classId!, s, extra)}
                  studentName={student.name}
                  label={t("os.card.units")}
                  autoUnits={subject.attendanceAutoUnits}
                />
              )}
            </>
          ) : (
            <span
              className={`rounded-pill px-2 py-0.5 text-xs font-bold ${attendanceMarkBadgeClass(student.attendance, {
                strongAbsent: true,
              })}`}
              title={
                student.isMakeup || !subject.classId
                  ? t("os.card.noClassAttendance")
                  : undefined
              }
            >
              {attendanceMarkLabel(student.attendance, lang)}
            </span>
          )}
        </div>
        {/* 과목 선택 (여러 과목일 때만) — 발송한 과목엔 체크 */}
        {student.subjects.length > 1 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {student.subjects.map((su, i) => {
            const on = i === idx;
            const sent = reports[su.name]?.sent;
            return (
              <button
                key={su.name}
                type="button"
                onClick={() => setSelIdx(i)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-bold transition ${
                  on
                    ? "bg-primary text-primary-foreground"
                    : "border-line text-text-dim hover:bg-bg-soft border"
                }`}
              >
                {su.name}
                {sent ? <EyIcon name="check" size={11} /> : null}
              </button>
            );
            })}
          </div>
        ) : null}
      </header>

      {/* 카드 폭(@container)에 따라 1 → 2 → 3열. 세로로만 쌓으면 보고서 열만 끝없이 길어진다(원장 지적 07-21).
          2열 = **진도·테스트·교재·태도·과제 / 특이사항·문장 작성·발송**.
          🔴 3열이었다가 2열로 되돌렸다(2026-08-05 원장): 열을 셋으로 벌리면 카드가 넓어야 해서
             **미리보기가 우측에 설 폭이 안 나온다**. 문장·발송 열은 0.78fr로 **좁게** 둔다(원장:
             "멘트 자동완성 및 첨부 섹션은 가로 너비를 좀 줄여서") — 그만큼이 미리보기 몫이 된다.
             → 2026-09-29 원장 *"여기 열너비 조금만 좁혀"*(입력 열이 너무 넓다) — 0.78fr → 0.9fr로 입력 열을 조금 좁혔다.
          ⚠️ **학부모 미리보기는 이 카드 안이 아니라 페이지 열이다** — 카드 안에 두면 카드 폭을 입력과
             나눠 써서, 보고서 열이 좁은 화면에선 입력까지 1열로 찌그러졌다. */}
      {/* 결석 잠금 사유 — **잠긴 칸 바로 위**에 적는다(2026-07-30 "왜 비활성화됐는지 알 방법이 없다").
          출결 알약은 이 위에 살아 있으므로, 되돌리는 법까지 한 줄로 안내한다. */}
      {isAbsent && !alreadySent ? (
        <p className="border-danger/30 bg-danger-soft/40 text-text-dim mx-3 mt-2 rounded-md border px-2.5 py-1.5 text-xs leading-relaxed">
          <b className="text-danger">{t("os.card.absentLockWord")}</b>
          {t("os.card.absentLockA")}
          <b>{t("os.card.absentLockWord2")}</b>
          {t("os.card.absentLockB")}
        </p>
      ) : null}
      {/* '수업보고서 미발송' 반 — 아래 보고서 칸이 **왜 잠겼고 어떻게 하면 되는지**(원장 2026-11-04 *"원인을 선생님이 알 수 없으니까
          곤란해하심"*). 머리의 짧은 알약(마우스를 올려야 이유가 보였다)만으로는 몰랐다. 결석 안내와 같은 자리. */}
      {optoutRow ? <ReportLockNotice text={lockNotice} className="mx-3 mt-2" /> : null}

      <div className="grid flex-1 grid-cols-1 items-start gap-2.5 px-3 py-2.5 @[560px]:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] @[560px]:gap-x-3">
        {/* 1열 — 오늘 진도 · 테스트(옛 가운데 열). 원장 2026-08-05: *"이걸 하나의 섹션으로 합쳐버리면
            안되나? 공간낭비 최소화할 수 있게? 굳이 따로 할 필요 있나?"* 카드를 따로 세우니 열 하나가
            콘텐츠보다 훨씬 길어 아래가 통째로 비었고, 게다가 이 카드 맨 위 요약(오늘 진도/일일/확인/
            태도·과제)이 **그 카드와 같은 값을 두 번** 보여주고 있었다 → 요약(MiniSummary)은 삭제하고
            진짜 입력을 여기로 들였다. */}
        <fieldset
          disabled={locked}
          className="contents [&_input:disabled]:opacity-50 [&_textarea:disabled]:opacity-50 [&_select:disabled]:opacity-50 [&_button:disabled]:opacity-50 [&:disabled_*]:cursor-not-allowed"
        >
        <div className="flex flex-col gap-3">
        {/* 오늘 진도·테스트 — **입력 열의 맨 위**. 원장 2026-08-05: *"메모 입력파트까지 1개의 섹션으로
            합쳐도 될거같고"* — 진도·테스트를 따로 세우면 열이 하나 더 필요해 미리보기가 우측에 설 폭이
            안 나온다. 입력은 진도→테스트→교재→태도→과제 순서. 특이사항은 오른쪽 생성 문구 바로 위에 둔다. */}
        {todayInputs}

        {/* 교재명·보강·출결 — edutrix 강사 필드 패리티(0089a). 교재명은 학부모 카드에도 표시(설정 토글). */}
        <div className="flex flex-col gap-1.5">
          {/* 알약이 셋(정규+보강 · 영상 과제 · 영상 첨부 링크)까지 붙는다 — 좁은 카드에선 교재명 칸을 누르지 않고 아랫줄로 접는다. */}
          <div className="flex flex-wrap items-center gap-2">
            {isJjSheetReport(rep) ? (
              // JJ 수업보고서 행 — 교재는 세 권 중에서 고른다(원장 2026-10-27, jj-books.ts).
              <div className="min-w-32 flex-1">
                <JjBookPicker
                  value={subject.textbook}
                  onChange={(v) => onTextbook(subjectName, v)}
                  disabled={locked}
                  label={tf("os.card.bookAria", { subject: subjectName })}
                />
              </div>
            ) : (
              <input
                type="text"
                value={subject.textbook ?? ""}
                onChange={(e) => onTextbook(subjectName, e.target.value)}
                list={isMathBookRow(subject.subjectKey) ? mathBookList : undefined}
                placeholder={t("os.card.bookPh")}
                aria-label={tf("os.card.bookAria", { subject: subjectName })}
                className="border-line bg-card focus:border-primary h-8 min-w-32 flex-1 rounded-lg border px-2 text-xs outline-none transition-colors"
              />
            )}
            {/* 🔴 옛 '보강' 켜고 끄기 알약은 없앴다(원장 2026-09-30 — 표 모드 체크박스와 같은 이유: 손으로 켜면 타임 없는
                '(정규+보강)'이 생겼다). 보강은 '보강 추가'에서 정해지고, 여기엔 **합침 취소**만 남긴다. */}
            {subject.makeup && subject.classId && (locked || subject.makeupByReservation) ? (
              // 잠긴 행(결석·발송 완료·열람)은 합침 취소도 못 한다 — 표 모드와 같게 표시 배지만.
              // 보강 예약(합침)이 만든 '정규+보강'도 표시만 — 여기서 풀어도 새로고침이 예약대로 다시 합친다(예약을 '분리'로 다시 잡는다).
              <span
                className="bg-amber-soft text-amber shrink-0 rounded-pill px-2.5 py-1 text-xs font-bold"
                title={subject.makeupByReservation ? t("os.reserved.mergeLocked") : undefined}
              >
                {makeupBadgeLabel({ makeup: true, hasClass: true }, lang)}
              </span>
            ) : subject.makeup && subject.classId ? (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(tf("os.row.makeupUnmergeConfirm", { name: student.name, subject: subjectName })))
                    onMakeup(subjectName);
                }}
                title={t("os.row.makeupUnmerge")}
                aria-label={tf("os.row.makeupUnmergeAria", { name: student.name, subject: subjectName })}
                className="bg-amber-soft text-amber hover:bg-amber inline-flex shrink-0 items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-bold transition hover:text-white"
              >
                {makeupBadgeLabel({ makeup: true, hasClass: true }, lang)}
                <EyIcon name="close" size={10} />
              </button>
            ) : null}
            {/* 나누기(원장 2026-10-22) — '정규+보강' 줄이 잠기지 않았을 때만(예약 합침 줄도 — 예약 방식을 함께 바꾼다). */}
            {onSplitMakeup && subject.makeup && subject.classId && !locked ? (
              <MakeupSwitchButton kind="split" size="md" onClick={() => onSplitMakeup(subjectName)} />
            ) : null}
            <VideoHomeworkToggle
              size="pill"
              checked={!!subject.videoHomework}
              onToggle={() => onVideoHomework?.(subjectName)}
              disabled={!onVideoHomework || locked}
              studentId={student.id}
              classId={subject.classId}
              subjectKey={subject.subjectKey}
              grade={student.grade}
              studentName={student.name}
              subjectName={subjectName}
            />
            <VideoHomeworkDueToggle
              size="pill"
              shown={!!subject.videoHomework}
              mode={subject.videoHomeworkDue}
              dueDate={subject.videoHomeworkDueDate}
              onChange={(mode) => onVideoHomeworkDue?.(subjectName, mode)}
              disabled={!onVideoHomeworkDue || locked}
              row={{ studentId: student.id, classId: subject.classId, subjectKey: subject.subjectKey, grade: student.grade, studentName: student.name, subjectName }}
            />
            <VideoSubmitLinkToggle
              size="pill"
              shown={!!subject.videoHomework}
              checked={!!subject.videoSubmitLink}
              onToggle={() => onVideoSubmitLink?.(subjectName)}
              disabled={!onVideoSubmitLink || locked}
              classId={subject.classId}
              subjectKey={subject.subjectKey}
              grade={student.grade}
              studentName={student.name}
              subjectName={subjectName}
            />
          </div>
          {/* 출결·수업타임은 **카드 헤더(이름 아래)**로 올렸다(2026-08-05) — 여기 두면 교재명 블록에 묻혀
              강사가 못 찾는다(원장 제보). 같은 값을 두 번 보여주지 않는다. */}
        </div>

        {makeupExtra}

        <div>
          <p className="micro text-text-faint mb-1.5">{t("os.card.attitude")}</p>
          {/* 원장 2026-07-23: 알약 → 드롭다운(표 모드와 동일 규약). 해제는 "선택 안 함". */}
          <FieldSelect
            options={attitudes}
            value={cardEval.attitude}
            onSelect={(v) => onAttitude(v ?? "")}
            ariaLabel={tf("os.card.attitudeAria", { name: student.name })}
          />
          {attitudeExtra}
        </div>

        <div>
          <p className="micro text-text-faint mb-1.5">{t(pilot ? "os.col.homeworkPilot" : "os.col.homework")}</p>
          <HomeworkRateInput
            value={cardEval.homework}
            onChange={onHomework}
            label={tf("os.row.hwLabel", { name: student.name })}
            size="lg"
          />
          {homeworkExtra}
          {/* 오늘 과제(숙제 내용) — 0096a(edutrix 패리티, 사용률 90%). 위 칩은 '지난 과제 수행', 이건 '오늘 내줄 숙제'.
              AI 멘트 마무리("오늘 과제는 ~입니다") 재료 + 학부모 카드 표시(설정 토글). */}
          {/* 진도 입력과 같은 이유로 여러 줄을 보여 준다 — ECS 시트 초안은 교시마다 과제가 따로 있다
              (한 줄 input이면 "Vocab 43 44Reading section 5-2 풀기"로 붙어 보인다, 2026-08-07). */}
          <textarea
            rows={Math.min(4, ((subject.homeworkToday ?? "").match(/\n/g)?.length ?? 0) + 1)}
            value={subject.homeworkToday ?? ""}
            onChange={(e) => onHomeworkToday(subjectName, e.target.value)}
            // 쪽수 후보정 — 그리드 셀과 같은 처방(입력이 끝났을 때만, homework-pages.ts).
            onBlur={(e) => {
              const fixed = normalizeHomeworkPages(e.target.value);
              if (fixed !== e.target.value) onHomeworkToday(subjectName, fixed);
            }}
            placeholder={t("os.card.hwTodayPh")}
            aria-label={tf("os.card.hwTodayAria", { subject: subjectName })}
            className="border-line bg-card focus:border-primary scrollbar-thin mt-1.5 w-full min-w-0 resize-none rounded-lg border px-2 py-1.5 text-xs leading-relaxed outline-none transition-colors"
          />
        </div>

        </div>
        </fieldset>

        {/* 우측 열 — 특이사항 → 자동작성 문구·추세 → 발송·첨부·공유링크. */}
        <div className="flex flex-1 flex-col gap-3">
        {/* 특이사항을 옮겨도 기존과 같은 locked 판정으로 두 입력 열을 함께 보호한다. */}
        <fieldset
          disabled={locked}
          className="contents [&_input:disabled]:opacity-50 [&_textarea:disabled]:opacity-50 [&_select:disabled]:opacity-50 [&_button:disabled]:opacity-50 [&:disabled_*]:cursor-not-allowed"
        >
        {oneLineRow ? null : noteField}
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="micro text-text-faint">{tf("os.card.reportOf", { subject: subjectName })}</p>
              {/* 상단 멘트 모드 토글의 하단 반영 — 모드가 바뀌면 이 배지와 아래 입력 구성이 함께 바뀐다. */}
              <span
                className="border-line text-text-dim rounded-pill border px-1.5 py-px text-xs font-bold"
                title={
                  isEnglishRow
                    ? t("os.card.templateBadgeTitle")
                    : para
                      ? t("os.card.modeBTitle")
                      : t("os.card.modeATitle")
                }
              >
                {isEnglishRow ? t("os.card.templateBadge") : para ? t("os.ment.b") : t("os.ment.a")}
              </span>
              {/* 🔴 잠근 이유를 **잠긴 칸 옆에** 적는다 — 발송 버튼 옆 사유 알약은 한참 아래라, 문구를 쓰려다
                  막힌 사람은 그걸 못 본다(원장 2026-07-30 "왜 비활성화됐는지 알 방법이 없다"와 같은 함정). */}
              {isAbsent && !alreadySent ? (
                <span
                  className="border-danger/40 bg-danger-soft text-danger rounded-pill border px-1.5 py-px text-xs font-bold"
                  title={t("os.card.absentBadgeTitle")}
                >
                  {t("os.gate.absent")}
                </span>
              ) : null}
            </div>
            {aiOn ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={generating || !isRowActionable(subject, "autowrite", undefined, { progressOptional }) || alreadySent}
              title={
                alreadySent
                  ? t("os.row.genSentLocked")
                  : isRowActionable(subject, "autowrite", undefined, { progressOptional })
                  ? undefined
                  : optoutRow
                    ? lockNotice
                    : subject.attendanceRaw === "absent"
                      ? t("os.row.genAbsent")
                      : t("os.row.genNoProgress")
              }
              onClick={() => onAutoWrite(subjectName)}
            >
              <EyIcon name="sparkle" size={13} /> {generating ? t("os.card.generating") : t("os.row.gen")}
            </Button>
            ) : null}
          </div>
          {/* 영어 행 템플릿 칸(2026-09-10) — 배선은 onescreen-client, 카드는 자리만(todayInputs와 같은 슬롯 규약). */}
          {isEnglishRow ? templatePanel : null}
          {para ? (
            // 모드 B — 저장·발송 계약은 그대로 단일 문자열, 화면만 2칸(joinComment이 빈 줄로 합침).
            <div className="flex flex-1 flex-col gap-1.5">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-text-faint text-xs font-bold">{t("os.card.para1")}</span>
                <textarea
                  value={paras.p1}
                  onChange={(e) => onSubjectDraft(subjectName, joinComment(e.target.value, paras.p2))}
                  placeholder={optoutRow ? lockShort : tf("os.card.para1Ph", { subject: subjectName })}
                  className="border-line focus:border-primary scrollbar-thin min-h-[84px] flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm leading-relaxed outline-none"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-text-faint text-xs font-bold">{t("os.card.para2")}</span>
                <textarea
                  value={paras.p2}
                  onChange={(e) => onSubjectDraft(subjectName, joinComment(paras.p1, e.target.value))}
                  placeholder={optoutRow ? lockShort : t("os.card.para2Ph")}
                  className="border-line focus:border-primary scrollbar-thin min-h-[84px] flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm leading-relaxed outline-none"
                />
              </label>
            </div>
          ) : (
            <>
            {/* 맨 위 '수업 평가' 표는 편집 칸에서 빼서 읽기 전용으로(원장 2026-10-26). 저장 글은 다시 붙인 그대로다. */}
            <LevelsLead lead={draftLead.lead} />
            <textarea
              // 영어 글 칸 — '사진·PDF 넣기'가 이 칸의 커서 줄을 읽어 그 자리에 첨부 줄을 넣는다(카드는 한 학생만 그린다).
              id={isEnglishRow ? ENGLISH_DRAFT_TEXTAREA_ID : undefined}
              // 뗀 표만큼 커서 위치를 보정하라는 표식 — 첨부 줄 넣기가 전체 글 기준 위치를 쓴다(onescreen-client insertEnglishMediaFor).
              data-caret-offset={draftLead.lead && draftLead.body ? draftLead.lead.length + 2 : 0}
              value={draftLead.body}
              onChange={(e) => onSubjectDraft(subjectName, joinLevelsLead(draftLead.lead, e.target.value))}
              // 시범 대상 = 자동작성 전엔 보기만, 자동작성 뒤엔 고칠 수 있다(원장 2026-10-23 *"자동작성하고나면 수정은 할수있게"*).
              readOnly={pilotLocked}
              placeholder={
                optoutRow
                  ? lockShort // 잠긴 줄에 "'자동작성'을 먼저 눌러 만듭니다"를 띄우면 거짓 안내다(원장 2026-11-04)
                  : pilot
                  ? t("os.card.mentPhPilot")
                  : isEnglishRow
                    ? t("os.card.mentPhTemplate")
                    : tf("os.card.mentPh", { subject: subjectName })
              }
              // 영어 템플릿 글은 20줄 안팎이라 기본 높이로는 절반도 안 보인다 — 영어 행만 키운다.
              // 새 수학 보고서 글도 항목이 일곱 개 안팎이라 110px 칸에선 고치기가 불편했다(원장 2026-10-27 *"칸이 너무 작아서 불편"*) —
              // 글 길이만큼 자라고(화면 높이 70%까지) 손잡이로도 늘린다.
              className={`border-line focus:border-primary scrollbar-thin ${
                isEnglishRow
                  ? "min-h-[280px] resize-none"
                  : pilot
                    ? "field-sizing-content min-h-[280px] max-h-[70dvh] resize-y"
                    : "min-h-[110px] resize-none"
              } flex-1 rounded-lg border ${pilotLocked ? "bg-bg-soft" : "bg-background"} px-3 py-2 text-sm leading-relaxed outline-none`}
            />
            </>
          )}
        </div>

        {/* 학습 추세(종합분석) — 4a. '자동 작성'이 최근 시험·과제 흐름을 요약해 채운다. 표본 부족 시 빈 채로 둠(수동 입력 가능).
            영어 행은 그리지 않는다 — 추세는 수학 점수 이력에서 나오고, 영어 카드는 템플릿 글만 싣는다. */}
        {isEnglishRow ? null : (
          <div className="flex flex-col gap-1.5">
            {/* 제목 줄 오른쪽에 '학습 추세 미발송' — 표와 같은 체크(같은 계정 설정). 반 없는 행엔 없다. */}
            <div className="flex items-center justify-between gap-2">
              <p className="micro text-text-faint">{t("os.card.trend")}</p>
              {trendOptOut && subject?.classId ? (
                <label
                  className="text-text-dim inline-flex cursor-pointer items-center gap-1 text-xs font-medium whitespace-nowrap"
                  title={t("os.row.trendOptOutTitle")}
                >
                  <input
                    type="checkbox"
                    checked={trendOptOut.hidden(subjectName)}
                    onChange={() => trendOptOut.toggle(subjectName)}
                    className="accent-primary size-3.5"
                  />
                  {t("os.row.trendOptOut")}
                </label>
              ) : null}
            </div>
            <textarea
              value={rep.trendDraft ?? ""}
              onChange={(e) => onSubjectTrend(subjectName, e.target.value)}
              readOnly={pilotLocked}
              placeholder={optoutRow ? lockShort : t("os.card.trendPh")}
              title={trendOptOut?.hidden(subjectName) ? t("os.row.trendOptOutOn") : undefined}
              className={`border-line focus:border-primary scrollbar-thin min-h-[64px] resize-none rounded-lg border bg-background px-3 py-2 text-sm leading-relaxed outline-none ${
                trendOptOut?.hidden(subjectName) ? "text-text-dim line-through decoration-1" : ""
              }`}
            />
          </div>
        )}
        {oneLineRow ? noteField : null}
        </fieldset>

        {/* ClassNote 자동 발송 — 저장 + 큐 적재(로컬 워커가 자동 게시). 상태는 배지로 표시.
            ⚠️ 결석 게이트는 표뷰와 동일(isRowActionable send) — 카드만 우회되는 구멍 방지(#77, 리뷰 확정). */}
        {/* ClassNote 기능이 꺼진 학원엔 발송 줄 자체가 없다 — 저장·공유 링크(아래)만 남는다(2026-09-30). */}
        {classnoteOn ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!canQueue}
            title={
              sendGate.hint ?? t("os.card.queueTitle")
            }
            onClick={() => onQueueClassnote(subjectName)}
          >
            {t("os.card.queue")}
          </Button>
          {/* 🔴 막힌 이유를 **눈에 보이게** — 버튼 title 툴팁뿐이면 강사는 알 수 없다(2026-07-21 툴팁 미표시
              사례 / 2026-07-30 원장 "왜 비활성화됐는지 알 방법이 없다"). 판정은 위 sendGate 단일 소스라
              **비활성인데 사유 알약이 없는 상태가 생길 수 없다**. */}
          {sendGate.label ? (
            <span
              className={`rounded-pill border px-2 py-0.5 text-xs font-bold ${
                sendGate.reasons[0] === "absent"
                  ? "border-danger/40 bg-danger-soft text-danger"
                  : sendGate.reasons[0] === "sent"
                    ? "border-primary/40 bg-primary-soft text-primary"
                    : sendGate.reasons[0] === "readonly"
                      ? "border-purple/40 bg-purple-soft text-purple"
                      : "border-amber/40 bg-amber-soft text-amber"
              }`}
              title={sendGate.hint ?? undefined}
            >
              {sendGate.label}
            </span>
          ) : null}
          {mentWarnings.map((w) => (
            <span
              key={w}
              className="border-amber/40 bg-amber-soft text-amber rounded-pill border px-2 py-0.5 text-xs font-bold"
              title={t(MENT_WARNING_HINT[w])}
            >
              {t(MENT_WARNING_LABEL[w])}
            </span>
          ))}
          {/* 발송 완료는 위 사유 알약이 이미 말했다 — 같은 말을 두 번 붙이지 않는다(표뷰와 동일). */}
          {!alreadySent && cnBadge ? (
            <span className={`text-xs font-bold ${cnBadge.cls}`}>{cnBadge.label}</span>
          ) : null}
          {/* 학부모 읽음(0122a) — 양성 배지만(없음 = 미읽음이 아니라 동기화 안 됨일 수 있음, types.ts 규약).
              원장 목록의 "읽음"과 같은 뜻·같은 툴팁 표기 — 강사도 확인 가능하게(원장 지시 2026-07-27). */}
          {subject.classnoteReadAt ? (
            <span
              className="text-primary text-xs font-bold"
              title={tf("os.row.readTitle", { when: readAtLabel(subject.classnoteReadAt, lang) })}
            >
              {t("os.card.read")}
            </span>
          ) : null}
        </div>
        ) : null}

        {/* ⚠️ 게시된 보고서는 재발송 차단(2026-07-22) — 수업보고서는 카드 '이미지'로 게시돼 텍스트 수정이 안 되고,
            다시 보내면 기존 글은 그대로 둔 채 새 글만 하나 더 붙는다(되돌릴 수단 없음). 그래서 버튼을 잠근다.
            정말 다시 보내야 하면 아래 '링크 재발급'(상태 리셋) 또는 관리자 발송 콘솔의 '재발송'을 쓴다. */}
        {classnoteOn && alreadySent ? (
          <p className="border-amber/40 bg-amber-soft text-amber flex items-start gap-1 rounded-md border px-2.5 py-1.5 text-xs leading-relaxed">
            <EyIcon name="alert" size={13} className="mt-0.5 shrink-0" />
            <span>
              {t("os.card.sentLockA")}
              <b>{t("os.card.sentLockWord")}</b>
              {t("os.card.sentLockB")}
              <b>{t("os.card.sentLockRecall")}</b>
              {t("os.card.sentLockC")}
              <b>{t("os.card.queue")}</b>
              {t("os.card.sentLockD")}
            </span>
          </p>
        ) : null}

        {/* 회수 완료 — '발송'이 곧 재발송이다(별도 버튼을 두지 않는다, 원장 2026-08-06:
            *"회수하고 클래스노트 발송 버튼 누르면 그게 재발송 아닌가"*). 발송 시 새 토큰이 발급된다. */}
        {classnoteOn && liveStatus === "recalled" ? (
          <p className="border-line bg-bg-soft text-text-dim flex items-start gap-1 rounded-md border px-2.5 py-1.5 text-xs leading-relaxed">
            <EyIcon name="check" size={13} className="text-primary mt-0.5 shrink-0" />
            <span>
              {t("os.card.recalledA")}
              <b>{t("os.card.recalledWord")}</b>
              {t("os.card.recalledB")}
              <b>{t("os.card.queue")}</b>
              {t("os.card.recalledC")}
            </span>
          </p>
        ) : null}

        {/* ClassNote 발송이 주 채널(위 행). 여기선 기록 저장 + PDF만. 카톡·문자 자동발송(알림톡)은 후속 —
            지금은 저장 후 아래 '학부모 공유 링크' 복사로 수동 전달. */}
        <div className="flex flex-wrap gap-1.5">
          {/* 진도 미입력 게이트 — 표뷰와 동일(isRowActionable save). 카드만 우회해 빈 보고서를 만드는 구멍 방지(#15). */}
          <Button
            variant="outline"
            size="sm"
            disabled={readonlyView || !isRowActionable(subject, "save", undefined, { progressOptional }) || alreadySent}
            title={
              alreadySent
                ? t("os.card.saveSentTitle")
                : isRowActionable(subject, "save", undefined, { progressOptional })
                  ? t("os.card.saveTitle")
                  : optoutRow
                    ? lockNotice // 진도 칸이 잠겨 있어 "진도를 먼저 입력하세요"는 거짓 안내다
                    : t("os.row.genNoProgress")
            }
            onClick={() => onSend(subjectName, "save")}
          >
            {alreadySent ? t("os.card.saveSent") : t("os.card.save")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={readonlyView || !isRowActionable(subject, "save", undefined, { progressOptional })}
            title={
              isRowActionable(subject, "save", undefined, { progressOptional })
                ? t("os.card.pdfTitle")
                : optoutRow
                  ? lockNotice
                  : t("os.row.genNoProgress")
            }
            onClick={() => onSend(subjectName, "pdf")}
          >
            PDF
          </Button>
        </div>

        {/* P2b: 학생 사진 첨부 — 항상 노출. 미저장 상태에서 추가하면 첫 첨부 시 자동저장(핸들러). */}
        {/* /r·ClassNote 스샷에 실림 → **발송분은 함께 잠근다**(첨부만 바꾸면 학부모가 본 이미지와 갈라진다). */}
        <fieldset
          disabled={locked}
          className="contents [&_input:disabled]:opacity-50 [&_button:disabled]:opacity-50 [&:disabled_*]:cursor-not-allowed"
        >
        <div className="border-line bg-bg-soft rounded-md border px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-text-faint text-xs font-bold">
                {t("os.attach.empty")}{" "}
                <span className="text-text-dim">
                  {atts.length}/{MAX_ATTACHMENTS}
                </span>
              </p>
              <label
                className={`border-line hover:bg-card cursor-pointer rounded-lg border px-2 py-1 text-xs font-bold ${
                  uploadingAtt || atts.length >= MAX_ATTACHMENTS ? "pointer-events-none opacity-50" : ""
                }`}
              >
                {uploadingAtt ? t("os.card.uploading") : t("os.card.attachAdd")}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.cell,.show,audio/mpeg,audio/mp4,.mp3,.m4a"
                  multiple
                  className="hidden"
                  disabled={uploadingAtt || atts.length >= MAX_ATTACHMENTS}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = ""; // 같은 파일 재선택 허용
                    if (files.length) onAddFiles(subjectName, files);
                  }}
                />
              </label>
            </div>
            {/* 거짓 약속 차단(2026-07-21) — 학원설정에서 첨부가 꺼져 있으면 저장은 되지만 /r·인쇄·ClassNote
                어디에도 안 실린다(워커도 파일첨부 경로를 안 탐). 강사가 헛수고하지 않도록 입력 시점에 고지. */}
            {attachmentsHidden ? (
              <p className="border-amber/40 bg-amber-soft text-amber mb-1.5 rounded border px-2 py-1.5 text-xs leading-snug">
                {t("os.attach.offA")}
                <b>{t("os.attach.offB")}</b>
                {t(classnoteOn ? "os.attach.offC" : "os.attach.offCLink")} {t("os.card.attachOffAsk")}
              </p>
            ) : null}
            {atts.length ? (
              <div className="grid grid-cols-3 gap-1.5">
                {atts.map((a) => (
                  <div key={a.path} className="group relative">
                    {attachmentUrls?.[a.path] && isImageAttachment(a.name || a.path) ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 세션 내 signed URL 썸네일(최적화 불필요)
                      <img
                        src={attachmentUrls[a.path]}
                        alt={a.name}
                        className="bg-card h-16 w-full rounded object-contain"
                      />
                    ) : (
                      // 비이미지(문서·오디오) = 파일 칩
                      <div className="bg-card text-text-dim flex h-16 w-full flex-col items-center justify-center gap-0.5 rounded px-1 text-center">
                        <EyIcon name="file" size={16} className="text-text-faint" />
                        <span className="w-full truncate text-xs">{a.name}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(subjectName, a.path)}
                      className="bg-danger absolute top-0.5 right-0.5 inline-flex size-4 items-center justify-center rounded text-white opacity-0 transition group-hover:opacity-100"
                      aria-label={tf("os.attach.deleteAria", { name: a.name })}
                    >
                      <EyIcon name="close" size={11} strokeWidth={1.8} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-text-faint text-xs">
                {t(classnoteOn ? "os.card.attachHint" : "os.card.attachHintLink")}
              </p>
            )}
          </div>
        </fieldset>

        {/* 저장 후 발급된 학부모 공개 링크 — 강사가 복사해 카톡/문자로 직접 전달(발송 시스템 P0). */}
        {/* P2a: 열람 수 배지 + 취소(열람 차단)/재발급(새 토큰). 취소된 링크는 재발급만 노출. */}
          {subject.classId ? (
            <VideoHomeworkCheck classId={subject.classId} studentId={student.id}
              subjectKey={subject.subjectKey ?? "math"} grade={student.grade}
              previousHomework={subject.prevReport?.homeworkToday}
            homeworkDate={subject.prevReport?.date}
            readOnly={readonlyView} />
        ) : null}

        {rep.sent && sharePath ? (
          <div className="border-line bg-bg-soft rounded-md border px-3 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-text-faint text-xs font-bold">{t("os.card.shareLink")}</p>
              <div className="flex items-center gap-2 text-xs">
                {typeof rep.viewCount === "number" && rep.viewCount > 0 ? (
                  <span className="text-text-dim">{tf("os.card.views", { n: rep.viewCount })}</span>
                ) : null}
                {rep.revoked ? <span className="text-danger font-bold">{t("os.card.revoked")}</span> : null}
              </div>
            </div>
            {rep.revoked ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-text-dim text-xs">{t("os.card.revokedHint")}</p>
                <div className="flex items-center gap-1.5">
                  {/* ⚠️ 링크를 막아도 **ClassNote 게시글(스크린샷)은 남아 있다** — 지우려면 회수해야 한다. */}
                  {/* 열람 전용에선 회수 숨김 — 아래 게시판 블록의 RecallButton과 같은 이유. */}
                  {readonlyView ? null : (
                    <RecallButton
                      shareToken={rep.shareToken ?? null}
                      classnoteStatus={liveStatus ?? null}
                      studentName={student.name}
                      readAt={subject.classnoteReadAt ?? null}
                    />
                  )}
                  <Button variant="outline" size="sm" disabled={readonlyView} onClick={() => onReissue(subjectName)}>
                    {t("os.card.reissue")}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <code className="text-text-dim min-w-0 flex-1 truncate text-xs">{shareUrl}</code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (shareCopyWarning && !window.confirm(shareCopyWarning)) return;
                      // 복사는 **지금 열려 있는 호스트** 기준으로 — env가 비었거나 도메인이 달라도 유효한 주소가 나간다.
                      void navigator.clipboard?.writeText(`${window.location.origin}${sharePath}`);
                      toast.success(t("os.card.copied"));
                    }}
                  >
                    {t("os.card.copy")}
                  </Button>
                </div>
                {/* 🔴 게시된 보고서에는 **회수·재발송만** 노출한다(2026-08-06 원장).
                    게시글은 **이미지**로 올라가므로 '취소'(링크 차단)·'재발급'(새 토큰)은 학부모 눈에
                    아무 변화도 만들지 못한다 — 원장 지적: *"학부모는 현재 주소보다 이미지를 볼 것"*.
                    반쪽 수습을 고를 수 있게 두면 "취소했으니 됐다"는 오해를 부른다.
                    ClassNote로 안 나가고 링크만 카톡으로 보낸 보고서(게시 이력 없음)에서는 아래 else로
                    기존 취소·재발급이 그대로 뜬다 — 그쪽은 링크가 곧 내용이라 여전히 유효하다. */}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {postedToBoard ? (
                    <>
                      {/* 열람 전용에선 회수도 숨김 — RecallButton은 disabled prop이 없고, 회수는
                          학부모 게시글 삭제라 열람 화면에 열어 둘 이유가 없다(서버도 캡으로 거절). */}
                      {readonlyView ? null : (
                        <RecallButton
                          shareToken={rep.shareToken ?? null}
                          classnoteStatus={liveStatus ?? null}
                          studentName={student.name}
                          readAt={subject.classnoteReadAt ?? null}
                        />
                      )}
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" disabled={readonlyView} onClick={() => onReissue(subjectName)}>
                        {t("os.card.reissue")}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={readonlyView} onClick={() => onRevoke(subjectName)}>
                        {t("os.card.revoke")}
                      </Button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}
