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
 * 🔴 **폭은 실제 발송 이미지와 같은 512px**(원장 2026-08-05 "실제 학부모가 보는 이미지 크기로") — ClassNote
 *    워커가 viewport 800px에서 `.report-capture`(`max-w-lg`)를 2x로 캡처하므로 학부모가 받는 이미지는
 *    1024px 폭 = CSS 512px이다(실측한 실제 발송 이미지 1024×3660으로 확인). 여기서 줄이면 "글자가 이만큼
 *    보이겠구나"가 거짓이 된다.
 *
 * ⚠️ 한 가지만 미리보기가 못 보여준다 — 화면에 적어 둔다(거짓 약속 금지):
 *    **아직 업로드 중인 첨부**(signed URL이 잡힌 것만 그린다 — 그 전엔 개수만 알린다).
 *    학습 추이 그래프는 지연 조회(`loadReportTrend`)로 채운다 — 지난 회차는 서버, 오늘 회차는 지금 입력값.
 */
import { ParentReportCard } from "./parent-report-card";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { buildReportFields } from "../report-fields";
import { buildTrendPoints, type TrendReportRow } from "../report-trend";
import { isImageAttachment } from "../attachment-utils";
import type { ReportSettings } from "@/features/owner/settings-types";
import type { JjReportSnapshot } from "@/features/ijw/snapshot";
import type { OneScreenStudent, Subject } from "../types";

/** 아직 저장 안 한 오늘 회차를 그래프의 **현재 점**으로 끼워 넣기 위한 임시 id(실제 보고서 id와 안 겹친다). */
const PREVIEW_ROW_ID = "__preview__";

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
  trendHidden = false,
  attachments,
  attachmentUrls,
  trendRows,
  templateMode,
  jj,
}: {
  ctx: ReportPreviewContext;
  student: OneScreenStudent;
  subject: Subject;
  draft: string;
  trendDraft?: string;
  /** '학습 추세 미발송'(원장 2026-09-18) — 저장과 **같은 함수**(buildReportFields)에 실어 미리보기도 추세를 뺀다. */
  trendHidden?: boolean;
  attachments: { path: string; name: string }[];
  attachmentUrls?: Record<string, string>;
  /** 지난 회차 시험·과제 이력(지연 조회). 아직 안 왔으면 undefined = 그래프만 비고 나머지는 그대로 그린다. */
  trendRows?: TrendReportRow[];
  /**
   * 템플릿 모드(영어, 사용자 2026-09-10) — 조립된 글(draft)이 본문. 학부모 카드에 **그대로** 넘긴다:
   * 미리보기가 따로 판정하면 /r·ClassNote 이미지와 갈린다. 안 넘기면 수학 카드 그대로.
   */
  templateMode?: boolean;
  /**
   * 영어 행의 인재원 하루치(화면이 받아 둔 것) — 글의 그림 자리 줄에 그린다. 발송본은 저장 때 서버가 다시 받은
   * 저장본으로 그리므로, 여기 그림은 "지금 저장하면 들어갈 모양"이다.
   */
  jj?: JjReportSnapshot | null;
}) {
  // 🔴 껍데기(머리·안내)만 언어를 탄다 — 아래 ParentReportCard는 **학부모가 보는 것 그대로**라
  //    한국어 고정이다(미리보기가 발송물과 달라지면 미리보기의 존재 이유가 없어진다).
  const t = useSheetT();
  const tf = useSheetTf();
  const fields = buildReportFields({
    subject,
    homework: student.homework,
    attitude: student.attitude,
    tests: student.tests,
    draft,
    trendDraft,
    trendHidden,
    showDailyTest: ctx.showDailyTest,
    showCheckTest: ctx.showCheckTest,
  });
  // URL이 잡힌 첨부만 = /r과 같은 규약(해석 실패분 제외). 아직 못 잡은 건 아래 안내로 개수만 알린다.
  const resolved = attachments
    .map((a) => ({ ...a, url: attachmentUrls?.[a.path] ?? "" }))
    .filter((a) => a.url);
  const pendingAttachments = attachments.length - resolved.length;
  const imagesPending = pendingAttachments > 0 && attachments.some((a) => isImageAttachment(a.name || a.path));

  // 학습 추이 그래프 — 발송본에서 눈에 띄게 큰 블록이라(실제 이미지 1024×3660 중 약 1/5) 빼면 미리보기가
  // 실제와 달라진다. 지난 회차는 서버에서 받아오고, **오늘 회차는 아직 저장 전이라 지금 입력값으로 끼워 넣는다**
  // → 점수를 치는 순간 그래프의 마지막 점이 같이 움직인다(왼쪽 수정 → 오른쪽 즉시 반영이라는 이 화면의 규약).
  const trend = trendRows
    ? buildTrendPoints(
        [
          ...trendRows.filter((r) => r.date !== ctx.reportDate),
          { id: PREVIEW_ROW_ID, date: ctx.reportDate, examInfo: fields.examInfo, homeworkScore: fields.homeworkScore },
        ],
        PREVIEW_ROW_ID,
      )
    : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <p className="micro text-text-faint">{t("os.preview.title")}</p>
        <p className="text-text-faint text-xs">{t("os.preview.live")}</p>
      </div>
      {/* 학부모가 보는 것과 같은 카드. 배경을 한 겹 깔아 '입력 영역이 아니라 결과물'임을 눈으로 가른다.
          🔴 폭을 **실제 발송 이미지와 같게** 둔다(원장 2026-08-05 "실제 학부모가 보는 이미지 크기로"):
             ClassNote 워커는 viewport 800px에서 `.report-capture`를 캡처하고, 그 루트가 `max-w-lg`(512px)라
             학부모가 받는 이미지의 콘텐츠 폭이 곧 **512px**이다(classnote-core.mjs). 그래서 여기서 줄이거나
             늘리지 않는다 — 줄이면 "글자가 이 정도로 보이겠구나"가 거짓이 된다.
             폭이 모자란 화면에서만 자연히 축소된다(max-w-full). */}
      <div className="border-line bg-bg-soft mx-auto flex w-full max-w-[544px] justify-center rounded-2xl border p-4">
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
            // 반이 붙은 행의 보강 = 그날 정규까지 한 "(정규+보강)" — 저장될 값과 같은 판정(makeup-label.ts).
            hasClass: subject.classId != null,
          }}
          student={{ name: student.name, school: student.school ?? null, grade: student.grade }}
          academyName={ctx.academyName}
          logoSrc={ctx.logoSrc}
          settings={ctx.settings}
          attachments={resolved}
          trend={trend}
          templateMode={templateMode}
          jj={jj}
        />
      </div>
      {imagesPending ? (
        <p className="text-text-faint text-xs leading-snug">
          {tf("os.preview.pending", { n: pendingAttachments })}
        </p>
      ) : null}
    </div>
  );
}
