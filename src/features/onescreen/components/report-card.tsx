import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill } from "@/components/atoms/pill";
import { subjectTone, toneSoftClass } from "../data";
import { isReportEligible } from "../grid";
import { splitLessons } from "../curriculum";
import { DeltaChip } from "./delta-chip";
import type { OneScreenStudent, Subject, TestScore } from "../types";

// shareToken: 저장 시 발급되는 학부모 공개 링크(/r/[token]) 토큰. 세션 내 저장 후에만 존재.
// classnoteStatus: ClassNote 발송 큐 상태(queued/processing/success/failed/too_old) — 발송 후에만.
// revoked: 공유링크 취소됨(P2a) — 링크 열람 차단, 재발급 필요. viewCount: 학부모 열람 수.
export type SubjectReport = {
  draft: string;
  trendDraft?: string; // 학습 추세(종합분석) 초안 — 4a. 멘트(draft)와 별개, 자동작성 시 함께 채움.
  sent: boolean;
  shareToken?: string;
  classnoteStatus?: string;
  revoked?: boolean;
  viewCount?: number;
  attachments?: { path: string; name: string }[]; // 학생 사진 첨부(P2b)
};

const MAX_ATTACHMENTS = 6;

/** classnote_status → 표시 라벨 + 색. 표 뷰(onescreen-grid)와 공용(중복 방지) → export. */
export function classnoteBadge(status?: string): { label: string; cls: string } | null {
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
    default:
      return null;
  }
}

function fmt(t: TestScore) {
  return t.score == null ? "미입력" : `${t.score}/${t.max}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-text-faint shrink-0 text-[12px]">{label}</span>
      <span className="text-foreground flex flex-wrap items-center justify-end gap-1.5 text-[12px] font-semibold">
        {children}
      </span>
    </div>
  );
}

/** 선택 과목 1개 기준 요약 — 오늘 진도는 그 과목만, 테스트·태도는 그날 공통. */
function MiniSummary({ st, subject }: { st: OneScreenStudent; subject: Subject }) {
  const { daily, check } = st.tests;
  const { key, tone } = subjectTone(subject.name);
  return (
    <div className="border-line rounded-md border px-3 py-2">
      <Row label="오늘 진도">
        {/* 다중 차시는 한 줄로 쏟지 않고 **차시별 줄바꿈**(pill 스택). 첫 줄에만 과목 접두. */}
        {(() => {
          const lessons = splitLessons(subject.today);
          if (lessons.length === 0)
            return <span className="text-text-faint text-[12px]">미입력</span>;
          return (
            <span className="flex flex-col items-end gap-0.5">
              {lessons.map((l, i) => (
                <span
                  key={i}
                  className={`rounded-pill px-1.5 py-px text-[11px] font-semibold ${toneSoftClass(tone)}`}
                >
                  {i === 0 ? `${key} · ${l}` : l}
                </span>
              ))}
            </span>
          );
        })()}
      </Row>
      <Row label="일일테스트">
        <span className="tabular">{fmt(daily)}</span>
        <DeltaChip score={daily.score} prev={daily.prevScore} />
      </Row>
      <Row label="확인테스트">
        <span className="tabular">{fmt(check)}</span>
        <DeltaChip score={check.score} prev={check.prevScore} />
      </Row>
      <Row label="태도 · 과제">{(st.attitude ?? "—") + " · " + (st.homework || "—")}</Row>
    </div>
  );
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
  homeworks,
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
}: {
  student: OneScreenStudent;
  reports: Record<string, SubjectReport>;
  attitudes: readonly string[];
  homeworks: readonly string[];
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
}) {
  const [selIdx, setSelIdx] = useState(0);
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
  const atts = rep.attachments ?? []; // 학생 사진 첨부(P2b)
  const uploadingAtt = uploadingSubject === subjectName;

  return (
    <div className="bg-card border-line shadow-card flex flex-col rounded-md border">
      <header className="border-line border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="micro text-text-faint">
              {student.subjects.length > 1 ? "today 보고서 · 과목별" : "today 보고서"}
            </p>
            <p className="text-foreground text-[15px] font-bold">{student.name} · 학부모 보고</p>
          </div>
          {/* 실발송이 아니라 lesson_reports 기록 저장(PDF만 실제 인쇄). "발송 완료" 거짓 약속 방지. */}
          {rep.sent ? <Pill color="primary">기록 저장</Pill> : null}
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
                className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-[12px] font-semibold transition ${
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

      <div className="flex flex-1 flex-col gap-3 px-4 py-3">
        <MiniSummary st={student} subject={subject} />

        {/* 교재명·보강·출결 — edutrix 강사 필드 패리티(0089a). 교재명은 학부모 카드에도 표시(설정 토글). */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={subject.textbook ?? ""}
              onChange={(e) => onTextbook(subjectName, e.target.value)}
              placeholder="교재명 (예: 개념원리 중2-1)"
              aria-label={`${subjectName} 교재명`}
              className="border-line bg-card focus:border-primary h-8 min-w-0 flex-1 rounded-sm border px-2 text-[12px] outline-none transition-colors"
            />
            <button
              type="button"
              onClick={() => onMakeup(subjectName)}
              aria-pressed={!!subject.makeup}
              title="보강 수업 표시"
              className={`shrink-0 rounded-pill px-2.5 py-1 text-[12px] font-semibold transition ${
                subject.makeup ? "bg-amber-soft text-amber" : "border-line text-text-dim hover:bg-bg-soft border"
              }`}
            >
              보강
            </button>
          </div>
          {student.attendance !== "출석" ? (
            <span
              className={`self-start rounded-pill px-2 py-0.5 text-[11px] font-semibold ${
                student.attendance === "지각" ? "bg-amber-soft text-amber" : "bg-danger text-white"
              }`}
            >
              오늘 {student.attendance}
            </span>
          ) : null}
        </div>

        <div>
          <p className="micro text-text-faint mb-1.5">수업 태도</p>
          <div className="flex flex-wrap gap-1.5">
            {attitudes.map((a) => {
              const on = student.attitude === a;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => onAttitude(a)}
                  aria-pressed={on}
                  className={`rounded-pill px-2.5 py-1 text-[12px] font-semibold transition ${
                    on
                      ? "bg-primary text-primary-foreground"
                      : "border-line text-text-dim hover:bg-bg-soft border"
                  }`}
                >
                  {a}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="micro text-text-faint mb-1.5">과제</p>
          <div className="flex flex-wrap gap-1.5">
            {homeworks.map((h) => {
              const on = student.homework === h;
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => onHomework(h)}
                  aria-pressed={on}
                  className={`rounded-pill px-2.5 py-1 text-[12px] font-semibold transition ${
                    on
                      ? "bg-primary text-primary-foreground"
                      : "border-line text-text-dim hover:bg-bg-soft border"
                  }`}
                >
                  {h}
                </button>
              );
            })}
          </div>
          {/* 오늘 과제(숙제 내용) — 0096a(edutrix 패리티, 사용률 90%). 위 칩은 '지난 과제 수행', 이건 '오늘 내줄 숙제'.
              AI 멘트 마무리("오늘 과제는 ~입니다") 재료 + 학부모 카드 표시(설정 토글). */}
          <input
            type="text"
            value={subject.homeworkToday ?? ""}
            onChange={(e) => onHomeworkToday(subjectName, e.target.value)}
            placeholder="오늘 과제 (예: 개념편 p10~16, 유형편 p6~11)"
            aria-label={`${subjectName} 오늘 과제`}
            className="border-line bg-card focus:border-primary mt-1.5 h-8 w-full min-w-0 rounded-sm border px-2 text-[12px] outline-none transition-colors"
          />
        </div>

        {/* 특이사항(강사 메모) — AI 멘트 입력(4c). 자유서술. 학부모엔 생성 문구만 나감. */}
        <div className="flex flex-col gap-1.5">
          <p className="micro text-text-faint">특이사항 (메모)</p>
          <textarea
            value={student.note ?? ""}
            onChange={(e) => onNote(e.target.value)}
            placeholder="예: 조퇴함 / 개념이 어려워 연습문제 한 번 더 · 자동작성 시 학부모 문장으로 풀어 씁니다"
            className="border-line focus:border-primary scrollbar-thin min-h-[52px] resize-none rounded-md border bg-background px-3 py-2 text-[13px] leading-relaxed outline-none"
          />
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <p className="micro text-text-faint">{subjectName} 보고서</p>
            <Button
              variant="ghost"
              size="sm"
              disabled={generating || !isReportEligible(subject)}
              title={isReportEligible(subject) ? undefined : "오늘 진도를 먼저 입력하세요"}
              onClick={() => onAutoWrite(subjectName)}
            >
              <EyIcon name="sparkle" size={13} /> {generating ? "생성 중…" : "자동 작성"}
            </Button>
          </div>
          <textarea
            value={rep.draft}
            onChange={(e) => onSubjectDraft(subjectName, e.target.value)}
            placeholder={`'자동 작성'을 누르면 ${subjectName} 진도·테스트·태도로 초안을 만들어 줍니다. 그대로 보내거나 수정하세요.`}
            className="border-line focus:border-primary scrollbar-thin min-h-[110px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-[13px] leading-relaxed outline-none"
          />
        </div>

        {/* 학습 추세(종합분석) — 4a. '자동 작성'이 최근 시험·과제 흐름을 요약해 채운다. 표본 부족 시 빈 채로 둠(수동 입력 가능). */}
        <div className="flex flex-col gap-1.5">
          <p className="micro text-text-faint">학습 추세 (종합분석)</p>
          <textarea
            value={rep.trendDraft ?? ""}
            onChange={(e) => onSubjectTrend(subjectName, e.target.value)}
            placeholder="'자동 작성'을 누르면 최근 시험·과제 점수 흐름을 요약해 줍니다. 기록이 적으면 비어 있을 수 있습니다."
            className="border-line focus:border-primary scrollbar-thin min-h-[64px] resize-none rounded-md border bg-background px-3 py-2 text-[13px] leading-relaxed outline-none"
          />
        </div>

        {/* ClassNote 자동 발송 — 저장 + 큐 적재(로컬 워커가 자동 게시). 상태는 배지로 표시. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            title="저장 후 ClassNote 발송 큐에 올립니다 — 워커가 자동으로 게시합니다"
            onClick={() => onQueueClassnote(subjectName)}
          >
            ClassNote 발송
          </Button>
          {cnBadge ? <span className={`text-[11px] font-semibold ${cnBadge.cls}`}>{cnBadge.label}</span> : null}
        </div>

        {/* ⚠️ 게시된 보고서 수정 경고 — 수업보고서는 카드 '이미지'로 게시돼 텍스트 수정이 안 됨(교체=이미지 재생성 필요, 준비 중).
            이미 게시(success)된 뒤 내용을 고쳐 다시 보내면 게시판에 새 글이 추가되고 기존 이미지는 남는다. */}
        {rep.classnoteStatus === "success" ? (
          <p className="border-amber/40 bg-amber-soft text-amber flex items-start gap-1 rounded-md border px-2.5 py-1.5 text-[11px] leading-relaxed">
            <EyIcon name="alert" size={13} className="mt-0.5 shrink-0" />
            <span>
              이미 학부모 게시판에 올라간 보고서입니다. 내용을 고쳐 <b>다시 보내면 새 글이 추가</b>되고, 기존 게시글(이미지)은
              자동으로 교체되지 않습니다. <b>게시된 보고서 수정·교체는 준비 중</b>입니다.
            </span>
          </p>
        ) : null}

        {/* ClassNote 발송이 주 채널(위 행). 여기선 기록 저장 + PDF만. 카톡·문자 자동발송(알림톡)은 후속 —
            지금은 저장 후 아래 '학부모 공유 링크' 복사로 수동 전달. */}
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            title="보고서를 기록에 저장합니다 — 아래 학부모 공유 링크를 복사해 카톡·문자로 보낼 수 있습니다"
            onClick={() => onSend(subjectName, "save")}
          >
            저장
          </Button>
          <Button variant="ghost" size="sm" title="학부모 보고서 미리보기·인쇄" onClick={() => onSend(subjectName, "pdf")}>
            PDF
          </Button>
        </div>

        {/* P2b: 학생 사진 첨부 — 항상 노출. 미저장 상태에서 추가하면 첫 첨부 시 자동저장(핸들러). */}
        {/* /r·ClassNote 스샷에 실림. 변경 시 재발송 필요. */}
        <div className="border-line bg-bg-soft rounded-md border px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-text-faint text-[11px] font-semibold">
                학생 사진 첨부 <span className="text-text-dim">{atts.length}/{MAX_ATTACHMENTS}</span>
              </p>
              <label
                className={`border-line hover:bg-card cursor-pointer rounded-md border px-2 py-1 text-[11px] font-semibold ${
                  uploadingAtt || atts.length >= MAX_ATTACHMENTS ? "pointer-events-none opacity-50" : ""
                }`}
              >
                {uploadingAtt ? "업로드 중…" : "사진 추가"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
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
            {atts.length ? (
              <div className="grid grid-cols-3 gap-1.5">
                {atts.map((a) => (
                  <div key={a.path} className="group relative">
                    {attachmentUrls?.[a.path] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 세션 내 signed URL 썸네일(최적화 불필요)
                      <img
                        src={attachmentUrls[a.path]}
                        alt={a.name}
                        className="bg-card h-16 w-full rounded object-contain"
                      />
                    ) : (
                      <div className="bg-card text-text-faint flex h-16 w-full items-center justify-center rounded px-1 text-center text-[10px]">
                        {a.name}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(subjectName, a.path)}
                      className="bg-danger absolute top-0.5 right-0.5 inline-flex size-4 items-center justify-center rounded text-white opacity-0 transition group-hover:opacity-100"
                      aria-label={`${a.name} 삭제`}
                    >
                      <EyIcon name="close" size={11} strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-text-faint text-[11px]">
                사진을 추가하면 학부모 링크·ClassNote 게시글에 함께 실립니다.
              </p>
            )}
          </div>

        {/* 저장 후 발급된 학부모 공개 링크 — 강사가 복사해 카톡/문자로 직접 전달(발송 시스템 P0). */}
        {/* P2a: 열람 수 배지 + 취소(열람 차단)/재발급(새 토큰). 취소된 링크는 재발급만 노출. */}
        {rep.sent && shareUrl ? (
          <div className="border-line bg-bg-soft rounded-md border px-3 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-text-faint text-[11px] font-semibold">학부모 공유 링크</p>
              <div className="flex items-center gap-2 text-[10px]">
                {typeof rep.viewCount === "number" && rep.viewCount > 0 ? (
                  <span className="text-text-dim">{rep.viewCount}회 열람</span>
                ) : null}
                {rep.revoked ? <span className="text-danger font-semibold">취소됨</span> : null}
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
  );
}
