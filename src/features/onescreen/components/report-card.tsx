import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill } from "@/components/atoms/pill";
import { effectiveClassnoteStatus, isAlreadySent, isReportEligible, isRowActionable } from "../grid";
import { evaluateSendGate } from "../send-gate";
import { checkMentConsistency, MENT_WARNING_HINT, MENT_WARNING_LABEL } from "../ment-consistency";
import { parentUnreadBadge, progressAnomalyBadge } from "../roster-signals";
import { AttendancePills, type AttendanceExtra, type BasicAttendance } from "./attendance-pills";
import { FieldSelect } from "./field-select";
import { HomeworkRateInput } from "./homework-rate-input";
import { isImageAttachment } from "../attachment-utils";
import { splitComment, joinComment } from "../comment-paragraphs";
import type { OneScreenStudent } from "../types";

// shareToken: 저장 시 발급되는 학부모 공개 링크(/r/[token]) 토큰. 세션 내 저장 후에만 존재.
// classnoteStatus: ClassNote 발송 큐 상태(queued/processing/success/failed/too_old) — 발송 후에만.
// revoked: 공유링크 취소됨(P2a) — 링크 열람 차단, 재발급 필요. viewCount: 학부모 열람 수.
export type SubjectReport = {
  draft: string;
  trendDraft?: string; // 학습 추세(종합분석) 초안 — 4a. 멘트(draft)와 별개, 자동작성 시 함께 채움.
  sent: boolean;
  shareToken?: string;
  /** null = 이번 세션에서 명시적으로 해제됨(재발급·첨부변경). undefined = 아직 모름 — 둘은 다르다. */
  classnoteStatus?: string | null;
  revoked?: boolean;
  viewCount?: number;
  attachments?: { path: string; name: string }[]; // 학생 사진 첨부(P2b)
};

const MAX_ATTACHMENTS = 6;

/** classnote_status → 표시 라벨 + 색. 표 뷰(onescreen-grid)와 공용(중복 방지) → export. */
export function classnoteBadge(status?: string | null): { label: string; cls: string } | null {
  switch (status) {
    case "queued":
      return { label: "ClassNote 발송 대기", cls: "text-text-dim" };
    case "processing":
      return { label: "ClassNote 처리 중", cls: "text-text-dim" };
    case "success":
      return { label: "ClassNote 발송 완료", cls: "text-primary" };
    case "failed":
      return { label: "ClassNote 발송 실패", cls: "text-danger" };
    case "too_old":
      return { label: "ClassNote 발송 제외(오래됨)", cls: "text-text-dim" };
    case "revoked":
      return { label: "링크 취소됨 — 재발급 필요", cls: "text-danger" };
    case "name_conflict":
      return { label: "동명이인 — 자동 발송 차단", cls: "text-danger" };
    case "blocked_shared":
      // 워커 프리플라이트 게이트가 오발송 위험(한 보드에 2가족+ 등)으로 보류 — 사유는 classnote_error에 한글로.
      return { label: "공유 보드 — 자동 발송 차단", cls: "text-danger" };
    case "subject_off":
      // 원장 설정(classnoteSubjects) 밖 과목 — 저장만 되고 게시 안 됨. "발송 대기" 오인 방지(#2 확정).
      return { label: "발송 대상 아님(과목 설정)", cls: "text-text-dim" };
    case "absent":
      // 서버 결석 게이트(#77) 반환 상태(세션 내 표시 전용 — DB엔 안 남음). 저장만 되고 발송 제외.
      return { label: "결석 — 발송 제외", cls: "text-text-dim" };
    default:
      return null;
  }
}

/** 학부모 읽음 툴팁용 KST 일시("7월 18일 13:01") — 원장 목록(report-list readAtLabel)과 같은 표기. 표뷰 공용 → export. */
export function readAtLabel(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
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
  onSubjectDraft,
  onSubjectTrend,
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
}: {
  student: OneScreenStudent;
  reports: Record<string, SubjectReport>;
  attitudes: readonly string[];
  onAttitude: (a: string) => void;
  onHomework: (h: string) => void;
  onTextbook: (subjectName: string, text: string) => void; // 교재명(과목별) — 0089a
  onHomeworkToday: (subjectName: string, text: string) => void; // 오늘 과제(숙제 내용, 과목별) — 0096a
  onMakeup: (subjectName: string) => void; // 보강 토글(과목별) — 0089a
  onSubjectDraft: (subjectName: string, text: string) => void;
  onSubjectTrend: (subjectName: string, text: string) => void; // 학습 추세 초안 편집(4a)
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
    onSet: (classId: string, status: BasicAttendance, extra?: AttendanceExtra) => void;
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
}) {
  const [ownIdx, setOwnIdx] = useState(0);
  const selIdx = subjectIndex ?? ownIdx;
  const setSelIdx = onSubjectIndex ?? setOwnIdx;
  const idx = Math.min(selIdx, student.subjects.length - 1);
  const subject = student.subjects[idx];
  if (!subject) return null;
  const subjectName = subject.name;
  const rep = reports[subjectName] ?? { draft: "", sent: false };
  // 학부모 공개 링크 — 저장 후(shareToken 존재) 노출. 강사가 복사해 카톡/문자로 전달.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = rep.shareToken ? `${origin}/r/${rep.shareToken}` : "";
  const generating = generatingSubject === subjectName; // 이 과목 AI 멘트 생성 중
  const cnBadge = classnoteBadge(rep.classnoteStatus); // ClassNote 발송 상태 배지
  // 재발송 차단(2026-07-22) — 화면 state가 로스터 스냅샷을 이긴다.
  // ⚠️ `??`가 아니라 effectiveClassnoteStatus: 재발급·첨부변경이 상태를 **명시적으로 지운**(null) 뒤에도
  //    `??`면 스냅샷의 옛 "success"가 되살아나 잠금이 안 풀린다(적대 검수 확정).
  const liveStatus = effectiveClassnoteStatus(rep.classnoteStatus, subject.classnoteStatus);
  const alreadySent = isAlreadySent(liveStatus);
  // 발송 게이트 = 표뷰와 **같은 단일 소스**(send-gate.ts) — 카드만 다른 판정을 쓰면 한쪽에서만
  // "왜 안 눌리지"가 생긴다(#77). 멘트 미작성도 여기서 막는다(빈 멘트 절대 가드가 어차피 거절).
  const sendGate = evaluateSendGate({
    alreadySent,
    isAbsent: subject.attendanceRaw === "absent",
    hasProgress: isReportEligible(subject),
    hasDraft: !!rep.draft?.trim(),
  });
  const canQueue = sendGate.canSend;
  // 멘트 ↔ 기록 불일치(시험날 진도·멘트에만 있는 점수) — 표뷰와 같은 판정. 막지 않고 알린다.
  const mentWarnings = checkMentConsistency({
    ment: rep.draft ?? "",
    progress: subject.today ?? "",
    dailyTest: student.tests.daily.score != null ? "y" : "",
    checkTest: student.tests.check.score != null ? "y" : "",
  });
  const atts = rep.attachments ?? []; // 학생 사진 첨부(P2b)
  const uploadingAtt = uploadingSubject === subjectName;
  // 로스터 신호(G2·G3) — 카드 헤더 배지. 진도 신호는 math 전용 데이터라 수학 과목 보유 학생만(표뷰와 동일 규약).
  const hasMathSubject = student.subjects.some((su) => !su.subjectKey || su.subjectKey === "math");
  const showProgressBadge = hasMathSubject && progressAnomalyBadge(student.progressSignal);
  // 학부모 읽음(G3)도 같은 게이트 — RPC는 학생의 **모든** 보고서를 세는데 발송분이 아직 전부 수학이라
  // (subject='english' 0건, 2026-07-29), 영어 강사 화면에 달면 "당신의 영어 보고서가 미확인"으로 읽힌다.
  // 📌 영어 발송이 시작되면 RPC에 과목을 넘겨 과목별로 세고 이 게이트를 그때 푼다.
  const unreadBadge = hasMathSubject ? parentUnreadBadge(student.parentRead) : null;
  // 멘트 모드 B = 초안을 2문단(수업 내용 / 태도·특이사항)으로 나눠 편집. 값은 단일 문자열 그대로 저장.
  const para = noticeMode === "B";
  const paras = splitComment(rep.draft);

  return (
    // @container — 아래 본문 2열 분기는 **창 폭이 아니라 이 카드 폭** 기준(3열 그리드 안이라 브레이크포인트가 안 맞음).
    <div className="bg-card border-line shadow-card @container flex flex-col rounded-2xl border">
      <header className="border-line border-b px-3 py-2.5">
        <div className="flex items-center justify-between">
          <div>
            <p className="micro text-text-faint">
              {student.subjects.length > 1 ? "today 보고서 · 과목별" : "today 보고서"}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-foreground text-[15px] font-bold">{student.name} · 학부모 보고</p>
              {/* 로스터 신호(G2·G3) — 표뷰와 동일 판정(roster-signals.ts). 카드는 학생 단위라 진도 배지는
                  수학 과목 보유 시(진도 파이프라인=math 전용). 카피 "미확인"(단정 금지). */}
              {unreadBadge ? (
                <span
                  className="bg-amber-soft text-amber rounded-pill px-1.5 py-px text-[10px] font-bold"
                  title={`최근 보고서 ${unreadBadge.count}건을 학부모가 아직 확인하지 않았습니다 — 다른 경로(직접 안내 등) 확인이 필요할 수 있어요`}
                >
                  학부모 미확인 {unreadBadge.count}회
                </span>
              ) : null}
              {showProgressBadge ? (
                <span
                  className="bg-danger-soft text-danger rounded-pill px-1.5 py-px text-[10px] font-bold"
                  title="진도 기록에 점프·겹침이 감지됐습니다 — 학생 상세 > 진도 탭에서 확인하세요"
                >
                  진도 확인 필요
                </span>
              ) : null}
            </div>
          </div>
          {/* 실발송이 아니라 lesson_reports 기록 저장(PDF만 실제 인쇄). "발송 완료" 거짓 약속 방지. */}
          {rep.sent ? <Pill color="primary">기록 저장</Pill> : null}
        </div>
        {/* 출결·수업타임 — **이름 바로 아래**(표뷰와 같은 자리). 원장 2026-08-05: *"표 모드에서는 출석/지각/
            결석이 바로 이름 아래에 보이는데 카드에서는 못찾겠"* — 예전엔 아래 교재명 블록 안에 묻혀 있었다.
            행(반) 단위(subject.classId)라 과목 알약 아래에 둔다(선택 과목이 바뀌면 이 값도 바뀐다).
            보강 행·반 모호(같은 과목 2반)는 기록할 자리가 없어 배지만(출석부에서 기록). */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="micro text-text-faint">출결</span>
          {attendance && !student.isMakeup && subject.classId ? (
            <AttendancePills
              value={subject.attendanceRaw}
              note={subject.attendanceNote}
              units={subject.attendanceUnits}
              pending={attendance.pendingKeys.has(`${student.id}::${subject.classId}`)}
              onSet={(s, extra) => attendance.onSet(subject.classId!, s, extra)}
              studentName={student.name}
              readOnly={attendance.readOnly}
            />
          ) : (
            <span
              className={`rounded-pill px-2 py-0.5 text-[11px] font-bold ${
                student.attendance === "지각"
                  ? "bg-amber-soft text-amber"
                  : student.attendance === "결석"
                    ? "bg-danger text-white"
                    : "bg-bg-soft text-text-dim"
              }`}
              title={
                student.isMakeup || !subject.classId
                  ? "이 행은 반이 없어 출석부에 기록할 자리가 없습니다 — 출결·수업타임은 출석부에서 입력하세요"
                  : undefined
              }
            >
              {student.attendance}
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
                className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-[12px] font-bold transition ${
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
          2열(@2xl≥672px) = **입력 전부(진도·테스트·교재·태도·과제·메모) / 문장 작성·발송**.
          🔴 3열이었다가 2열로 되돌렸다(2026-08-05 원장): 열을 셋으로 벌리면 카드가 넓어야 해서
             **미리보기가 우측에 설 폭이 안 나온다**. 문장·발송 열은 0.78fr로 **좁게** 둔다(원장:
             "멘트 자동완성 및 첨부 섹션은 가로 너비를 좀 줄여서") — 그만큼이 미리보기 몫이 된다.
          ⚠️ **학부모 미리보기는 이 카드 안이 아니라 페이지 열이다** — 카드 안에 두면 카드 폭을 입력과
             나눠 써서, 보고서 열이 좁은 화면에선 입력까지 1열로 찌그러졌다. */}
      <div className="grid flex-1 grid-cols-1 items-start gap-2.5 px-3 py-2.5 @[560px]:grid-cols-[minmax(0,1fr)_minmax(0,0.78fr)] @[560px]:gap-x-3">
        {/* 1열 — 오늘 진도 · 테스트(옛 가운데 열). 원장 2026-08-05: *"이걸 하나의 섹션으로 합쳐버리면
            안되나? 공간낭비 최소화할 수 있게? 굳이 따로 할 필요 있나?"* 카드를 따로 세우니 열 하나가
            콘텐츠보다 훨씬 길어 아래가 통째로 비었고, 게다가 이 카드 맨 위 요약(오늘 진도/일일/확인/
            태도·과제)이 **그 카드와 같은 값을 두 번** 보여주고 있었다 → 요약(MiniSummary)은 삭제하고
            진짜 입력을 여기로 들였다. */}
        <div className="flex flex-col gap-3">
        {/* 오늘 진도·테스트 — **입력 열의 맨 위**. 원장 2026-08-05: *"메모 입력파트까지 1개의 섹션으로
            합쳐도 될거같고"* — 진도·테스트를 따로 세우면 열이 하나 더 필요해 미리보기가 우측에 설 폭이
            안 나온다. 입력은 진도→테스트→교재→태도→과제→메모까지 **한 열**로 세로 흐름. */}
        {todayInputs}

        {/* 교재명·보강·출결 — edutrix 강사 필드 패리티(0089a). 교재명은 학부모 카드에도 표시(설정 토글). */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={subject.textbook ?? ""}
              onChange={(e) => onTextbook(subjectName, e.target.value)}
              placeholder="교재명 (예: 개념원리 중2-1)"
              aria-label={`${subjectName} 교재명`}
              className="border-line bg-card focus:border-primary h-8 min-w-0 flex-1 rounded-lg border px-2 text-[12px] outline-none transition-colors"
            />
            <button
              type="button"
              onClick={() => onMakeup(subjectName)}
              aria-pressed={!!subject.makeup}
              title={
                subject.classId
                  ? "그날 정규 수업에 더해 보강까지 한 경우 — 학부모 보고서 제목이 '(정규+보강)'이 되고 한 건만 나갑니다"
                  : "보강(수업외) 수업 — 학부모 보고서 제목이 '(보강)'이 됩니다"
              }
              className={`shrink-0 rounded-pill px-2.5 py-1 text-[12px] font-bold transition ${
                subject.makeup ? "bg-amber-soft text-amber" : "border-line text-text-dim hover:bg-bg-soft border"
              }`}
            >
              보강
            </button>
          </div>
          {/* 출결·수업타임은 **카드 헤더(이름 아래)**로 올렸다(2026-08-05) — 여기 두면 교재명 블록에 묻혀
              강사가 못 찾는다(원장 제보). 같은 값을 두 번 보여주지 않는다. */}
        </div>

        <div>
          <p className="micro text-text-faint mb-1.5">수업 태도</p>
          {/* 원장 2026-07-23: 알약 → 드롭다운(표 모드와 동일 규약). 해제는 "선택 안 함". */}
          <FieldSelect
            options={attitudes}
            value={student.attitude}
            onSelect={(v) => onAttitude(v ?? "")}
            ariaLabel={`${student.name} 수업 태도`}
          />
        </div>

        <div>
          <p className="micro text-text-faint mb-1.5">과제 수행률</p>
          <HomeworkRateInput
            value={student.homework}
            onChange={onHomework}
            label={`${student.name} 과제 수행률`}
            size="lg"
          />
          {/* 오늘 과제(숙제 내용) — 0096a(edutrix 패리티, 사용률 90%). 위 칩은 '지난 과제 수행', 이건 '오늘 내줄 숙제'.
              AI 멘트 마무리("오늘 과제는 ~입니다") 재료 + 학부모 카드 표시(설정 토글). */}
          <input
            type="text"
            value={subject.homeworkToday ?? ""}
            onChange={(e) => onHomeworkToday(subjectName, e.target.value)}
            placeholder="오늘 과제 (예: 개념편 p10~16, 유형편 p6~11)"
            aria-label={`${subjectName} 오늘 과제`}
            className="border-line bg-card focus:border-primary mt-1.5 h-8 w-full min-w-0 rounded-lg border px-2 text-[12px] outline-none transition-colors"
          />
        </div>

        {/* 특이사항(강사 메모) — AI 멘트 입력(4c). 자유서술. 학부모엔 생성 문구만 나감. */}
        <div className="flex flex-col gap-1.5">
          <p className="micro text-text-faint">특이사항 (메모)</p>
          <textarea
            value={student.note ?? ""}
            onChange={(e) => onNote(e.target.value)}
            placeholder="예: 조퇴함 / 개념이 어려워 연습문제 한 번 더 · 자동작성 시 학부모 문장으로 풀어 씁니다"
            className="border-line focus:border-primary scrollbar-thin min-h-[52px] resize-none rounded-lg border bg-background px-3 py-2 text-[13px] leading-relaxed outline-none"
          />
        </div>
        </div>

        {/* 우측 열 — 문장 작성(멘트·추세) + 발송·첨부·공유링크. */}
        <div className="flex flex-1 flex-col gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="micro text-text-faint">{subjectName} 보고서</p>
              {/* 상단 멘트 모드 토글의 하단 반영 — 모드가 바뀌면 이 배지와 아래 입력 구성이 함께 바뀐다. */}
              <span
                className="border-line text-text-dim rounded-pill border px-1.5 py-px text-[10px] font-bold"
                title={
                  para
                    ? "2문단 B — 수업 내용과 태도·특이사항을 나눠 작성합니다. 상단 토글에서 바꿀 수 있습니다."
                    : "단일 A — 모든 내용을 한 문단으로 작성합니다. 상단 토글에서 바꿀 수 있습니다."
                }
              >
                {para ? "2문단 B" : "단일 A"}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={generating || !isRowActionable(subject, "autowrite") || alreadySent}
              title={
                alreadySent
                  ? "이미 발송된 보고서 — 수정할 수 없습니다"
                  : isRowActionable(subject, "autowrite")
                  ? undefined
                  : subject.attendanceRaw === "absent"
                    ? "결석 학생 — 발송 제외 (기록 저장은 가능)"
                    : "오늘 진도를 먼저 입력하세요"
              }
              onClick={() => onAutoWrite(subjectName)}
            >
              <EyIcon name="sparkle" size={13} /> {generating ? "생성 중…" : "자동 작성"}
            </Button>
          </div>
          {para ? (
            // 모드 B — 저장·발송 계약은 그대로 단일 문자열, 화면만 2칸(joinComment이 빈 줄로 합침).
            <div className="flex flex-1 flex-col gap-1.5">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-text-faint text-[11px] font-bold">1문단 · 수업 내용</span>
                <textarea
                  value={paras.p1}
                  onChange={(e) => onSubjectDraft(subjectName, joinComment(e.target.value, paras.p2))}
                  placeholder={`교재·진도·오늘 과제를 담은 첫 문단. '자동 작성'이 ${subjectName} 진도로 채워 줍니다.`}
                  className="border-line focus:border-primary scrollbar-thin min-h-[84px] flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-[13px] leading-relaxed outline-none"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-text-faint text-[11px] font-bold">2문단 · 태도 · 특이사항</span>
                <textarea
                  value={paras.p2}
                  onChange={(e) => onSubjectDraft(subjectName, joinComment(paras.p1, e.target.value))}
                  placeholder="수업 태도·특이사항을 담은 둘째 문단. 태도·특이사항이 비어 있으면 자동 작성에서도 생략됩니다."
                  className="border-line focus:border-primary scrollbar-thin min-h-[84px] flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-[13px] leading-relaxed outline-none"
                />
              </label>
            </div>
          ) : (
            <textarea
              value={rep.draft}
              onChange={(e) => onSubjectDraft(subjectName, e.target.value)}
              placeholder={`'자동 작성'을 누르면 ${subjectName} 진도·테스트·태도로 초안을 만들어 줍니다. 그대로 보내거나 수정하세요.`}
              className="border-line focus:border-primary scrollbar-thin min-h-[110px] flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-[13px] leading-relaxed outline-none"
            />
          )}
        </div>

        {/* 학습 추세(종합분석) — 4a. '자동 작성'이 최근 시험·과제 흐름을 요약해 채운다. 표본 부족 시 빈 채로 둠(수동 입력 가능). */}
        <div className="flex flex-col gap-1.5">
          <p className="micro text-text-faint">학습 추세 (종합분석)</p>
          <textarea
            value={rep.trendDraft ?? ""}
            onChange={(e) => onSubjectTrend(subjectName, e.target.value)}
            placeholder="'자동 작성'을 누르면 최근 시험·과제 점수 흐름을 요약해 줍니다. 기록이 적으면 비어 있을 수 있습니다."
            className="border-line focus:border-primary scrollbar-thin min-h-[64px] resize-none rounded-lg border bg-background px-3 py-2 text-[13px] leading-relaxed outline-none"
          />
        </div>

        {/* ClassNote 자동 발송 — 저장 + 큐 적재(로컬 워커가 자동 게시). 상태는 배지로 표시.
            ⚠️ 결석 게이트는 표뷰와 동일(isRowActionable send) — 카드만 우회되는 구멍 방지(#77, 리뷰 확정). */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!canQueue}
            title={
              sendGate.hint ?? "저장 후 ClassNote 발송 큐에 올립니다 — 워커가 자동으로 게시합니다"
            }
            onClick={() => onQueueClassnote(subjectName)}
          >
            ClassNote 발송
          </Button>
          {/* 🔴 막힌 이유를 **눈에 보이게** — 버튼 title 툴팁뿐이면 강사는 알 수 없다(2026-07-21 툴팁 미표시
              사례 / 2026-07-30 원장 "왜 비활성화됐는지 알 방법이 없다"). 판정은 위 sendGate 단일 소스라
              **비활성인데 사유 알약이 없는 상태가 생길 수 없다**. */}
          {sendGate.label ? (
            <span
              className={`rounded-pill border px-2 py-0.5 text-[11px] font-bold ${
                sendGate.reasons[0] === "absent"
                  ? "border-danger/40 bg-danger-soft text-danger"
                  : sendGate.reasons[0] === "sent"
                    ? "border-primary/40 bg-primary-soft text-primary"
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
              className="border-amber/40 bg-amber-soft text-amber rounded-pill border px-2 py-0.5 text-[11px] font-bold"
              title={MENT_WARNING_HINT[w]}
            >
              {MENT_WARNING_LABEL[w]}
            </span>
          ))}
          {/* 발송 완료는 위 사유 알약이 이미 말했다 — 같은 말을 두 번 붙이지 않는다(표뷰와 동일). */}
          {!alreadySent && cnBadge ? (
            <span className={`text-[11px] font-bold ${cnBadge.cls}`}>{cnBadge.label}</span>
          ) : null}
          {/* 학부모 읽음(0122a) — 양성 배지만(없음 = 미읽음이 아니라 동기화 안 됨일 수 있음, types.ts 규약).
              원장 목록의 "읽음"과 같은 뜻·같은 툴팁 표기 — 강사도 확인 가능하게(원장 지시 2026-07-27). */}
          {subject.classnoteReadAt ? (
            <span
              className="text-primary text-[11px] font-bold"
              title={`학부모 읽음 · ${readAtLabel(subject.classnoteReadAt)}`}
            >
              읽음
            </span>
          ) : null}
        </div>

        {/* ⚠️ 게시된 보고서는 재발송 차단(2026-07-22) — 수업보고서는 카드 '이미지'로 게시돼 텍스트 수정이 안 되고,
            다시 보내면 기존 글은 그대로 둔 채 새 글만 하나 더 붙는다(되돌릴 수단 없음). 그래서 버튼을 잠근다.
            정말 다시 보내야 하면 아래 '링크 재발급'(상태 리셋) 또는 관리자 발송 콘솔의 '재발송'을 쓴다. */}
        {alreadySent ? (
          <p className="border-amber/40 bg-amber-soft text-amber flex items-start gap-1 rounded-md border px-2.5 py-1.5 text-[11px] leading-relaxed">
            <EyIcon name="alert" size={13} className="mt-0.5 shrink-0" />
            <span>
              이미 학부모 게시판에 올라간 보고서라 <b>수정도 재발송도 할 수 없습니다</b>. ClassNote는 게시글 수정·삭제가
              안 되므로, 여기서 내용을 바꾸면 학부모가 받은 것과 기록이 갈라집니다. 정말 고쳐야 하면 아래{" "}
              <b>공유 링크 재발급</b>으로 이 건을 무효화한 뒤 다시 작성하세요.
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
            disabled={!isRowActionable(subject, "save") || alreadySent}
            title={
              alreadySent
                ? "이미 학부모에게 발송된 보고서 — 수정할 수 없습니다(고치려면 공유 링크 재발급)"
                : isRowActionable(subject, "save")
                  ? "보고서를 기록에 저장합니다 — 아래 학부모 공유 링크를 복사해 카톡·문자로 보낼 수 있습니다"
                  : "오늘 진도를 먼저 입력하세요"
            }
            onClick={() => onSend(subjectName, "save")}
          >
            {alreadySent ? "발송됨 — 수정 불가" : "저장"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!isRowActionable(subject, "save")}
            title={isRowActionable(subject, "save") ? "학부모 보고서 미리보기·인쇄" : "오늘 진도를 먼저 입력하세요"}
            onClick={() => onSend(subjectName, "pdf")}
          >
            PDF
          </Button>
        </div>

        {/* P2b: 학생 사진 첨부 — 항상 노출. 미저장 상태에서 추가하면 첫 첨부 시 자동저장(핸들러). */}
        {/* /r·ClassNote 스샷에 실림. 변경 시 재발송 필요. */}
        <div className="border-line bg-bg-soft rounded-md border px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-text-faint text-[11px] font-bold">
                사진/파일 첨부 <span className="text-text-dim">{atts.length}/{MAX_ATTACHMENTS}</span>
              </p>
              <label
                className={`border-line hover:bg-card cursor-pointer rounded-lg border px-2 py-1 text-[11px] font-bold ${
                  uploadingAtt || atts.length >= MAX_ATTACHMENTS ? "pointer-events-none opacity-50" : ""
                }`}
              >
                {uploadingAtt ? "업로드 중…" : "사진/파일 추가"}
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
              <p className="border-amber/40 bg-amber-soft text-amber mb-1.5 rounded border px-2 py-1.5 text-[11px] leading-snug">
                학원설정에서 <b>사진/파일 첨부</b>가 꺼져 있어, 첨부해도 학부모 보고서·ClassNote에는 표시되지 않습니다.
                원장님께 문의하세요.
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
                        <span className="w-full truncate text-[10px]">{a.name}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(subjectName, a.path)}
                      className="bg-danger absolute top-0.5 right-0.5 inline-flex size-4 items-center justify-center rounded text-white opacity-0 transition group-hover:opacity-100"
                      aria-label={`${a.name} 삭제`}
                    >
                      <EyIcon name="close" size={11} strokeWidth={1.8} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-text-faint text-[11px]">
                사진/파일을 추가하면 학부모 링크·ClassNote 게시글에 함께 실립니다.
              </p>
            )}
          </div>

        {/* 저장 후 발급된 학부모 공개 링크 — 강사가 복사해 카톡/문자로 직접 전달(발송 시스템 P0). */}
        {/* P2a: 열람 수 배지 + 취소(열람 차단)/재발급(새 토큰). 취소된 링크는 재발급만 노출. */}
        {rep.sent && shareUrl ? (
          <div className="border-line bg-bg-soft rounded-md border px-3 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-text-faint text-[11px] font-bold">학부모 공유 링크</p>
              <div className="flex items-center gap-2 text-[10px]">
                {typeof rep.viewCount === "number" && rep.viewCount > 0 ? (
                  <span className="text-text-dim">{rep.viewCount}회 열람</span>
                ) : null}
                {rep.revoked ? <span className="text-danger font-bold">취소됨</span> : null}
              </div>
            </div>
            {rep.revoked ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-text-dim text-[11px]">이 링크는 열람이 차단됐습니다.</p>
                <Button variant="outline" size="sm" onClick={() => onReissue(subjectName)}>
                  재발급
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <code className="text-text-dim min-w-0 flex-1 truncate text-[11px]">{shareUrl}</code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard?.writeText(shareUrl);
                      toast.success("학부모 공유 링크를 복사했습니다");
                    }}
                  >
                    복사
                  </Button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => onReissue(subjectName)}>
                    재발급
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onRevoke(subjectName)}>
                    취소
                  </Button>
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
