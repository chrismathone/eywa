"use client";

/**
 * 카드 뷰 우측 '학부모 미리보기' — 왼쪽 입력이 바뀌면 **즉시** 반영되는 실시간 미리보기(2026-08-05 원장 요청:
 * *"입력란을 왼쪽에 배치하고 우측에는 실제 학부모에게 나가는 형태를 미리보기 식으로"*).
 *
 * 🔴 **발송물과 같은 것을 그린다** — 별도 미리보기 마크업을 만들지 않고 `/r`(학부모 공개 링크)·인쇄가 쓰는
 *    [ParentReportCard](./parent-report-card.tsx)를 **그대로** 렌더한다. 표시 항목 토글(showTextbook·
 *    showAttitude…)도 학원설정 실제 값을 그대로 넘긴다. 필드 문자열은 저장과 같은 [buildReportFields]
 *    (../report-fields.ts)가 만든다. 즉 미리보기·저장·발송이 **한 소스**다.
 *
 * ⚠️ 딱 두 가지는 미리보기가 보여줄 수 없다 — 화면에 그 사실을 적어 둔다(거짓 약속 금지):
 *   ① **학습 추이 그래프**: 과거 회차 점수를 서버에서 모아야 그린다(원스크린은 안 싣는다 — 전원이 매일 여는
 *      경로에 학생마다 추가 쿼리를 붙일 수 없다). 설정이 켜져 있으면 "발송본에 자동 포함"이라고 알린다.
 *   ② **아직 저장 안 한 첨부**: 업로드가 끝나 signed URL이 잡힌 것만 그린다(그 전엔 개수만 알린다).
 */
import { ParentReportCard } from "./parent-report-card";
import { buildReportFields } from "../report-fields";
import { isImageAttachment } from "../attachment-utils";
import type { ReportSettings } from "@/features/owner/settings-types";
import type { OneScreenStudent, Subject } from "../types";

/** 미리보기에 필요한 학원(테넌트) 재료 — 로스터가 서버에서 확정해 내려준다. */
export type ReportPreviewContext = {
  settings: ReportSettings;
  academyName: string;
  logoSrc: string | null;
  teacherName: string;
  /** 대상 날짜(YYYY-MM-DD) — 발송본 제목의 보고일과 같은 값. */
  reportDate: string;
  showDailyTest: boolean;
  showCheckTest: boolean;
};

export function ReportPreview({
  ctx,
  student,
  subject,
  draft,
  trendDraft,
  attachments,
  attachmentUrls,
}: {
  ctx: ReportPreviewContext;
  student: OneScreenStudent;
  subject: Subject;
  draft: string;
  trendDraft?: string;
  attachments: { path: string; name: string }[];
  attachmentUrls?: Record<string, string>;
}) {
  const fields = buildReportFields({
    subject,
    homework: student.homework,
    attitude: student.attitude,
    tests: student.tests,
    draft,
    trendDraft,
    showDailyTest: ctx.showDailyTest,
    showCheckTest: ctx.showCheckTest,
  });
  // URL이 잡힌 첨부만 = /r과 같은 규약(해석 실패분 제외). 아직 못 잡은 건 아래 안내로 개수만 알린다.
  const resolved = attachments
    .map((a) => ({ ...a, url: attachmentUrls?.[a.path] ?? "" }))
    .filter((a) => a.url);
  const pendingAttachments = attachments.length - resolved.length;
  const imagesPending = pendingAttachments > 0 && attachments.some((a) => isImageAttachment(a.name || a.path));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <p className="micro text-text-faint">학부모 화면 미리보기</p>
        <p className="text-text-faint text-[11px]">왼쪽에서 고치면 바로 반영됩니다</p>
      </div>
      {/* 학부모가 보는 것과 같은 카드. 배경을 한 겹 깔아 '입력 영역이 아니라 결과물'임을 눈으로 가른다. */}
      <div className="border-line bg-bg-soft flex justify-center rounded-2xl border p-3">
        <ParentReportCard
          report={{
            reportDate: ctx.reportDate || null,
            teacherName: ctx.teacherName || null,
            textbook: fields.textbook || null,
            progress: fields.progress || null,
            dailyTest: fields.dailyTest || null,
            checkTest: fields.checkTest || null,
            examInfo: null, // 레거시 합본 폴백 — 새 보고서는 항상 일일/확인 분리값을 쓴다.
            homeworkScore: fields.homeworkScore || null,
            homeworkToday: fields.homeworkToday || null,
            attitude: fields.attitude || null,
            notes: fields.notes || null,
            trendNote: fields.trendNote ?? null,
            makeup: fields.makeup,
          }}
          student={{ name: student.name, school: student.school ?? null, grade: student.grade }}
          academyName={ctx.academyName}
          logoSrc={ctx.logoSrc}
          settings={ctx.settings}
          attachments={resolved}
        />
      </div>
      {ctx.settings.showTrendGraph ? (
        <p className="text-text-faint text-[11px] leading-snug">
          학습 추이 그래프는 지난 회차 점수로 그려져 <b>발송본에만</b> 들어갑니다(미리보기 생략).
        </p>
      ) : null}
      {imagesPending ? (
        <p className="text-text-faint text-[11px] leading-snug">
          첨부 {pendingAttachments}건은 업로드가 끝나면 미리보기에 나타납니다.
        </p>
      ) : null}
    </div>
  );
}
