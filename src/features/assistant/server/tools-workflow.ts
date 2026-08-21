import "server-only";
// AI 비서 업무 흐름 툴 2종(수업보고서 발송 현황·내 결재함, 2026-08-20 권한 커버리지 배선) —
// 기존 features/report-admin·approvals 조회 함수의 **read-only 래핑**(새 쿼리 없음).
// 쿠키 세션 createClient 경유 → RLS 자동 상속 + 메뉴 게이트(tool-gate, #77).
//
// PII 방침: 결재 문서는 **제목·양식·상태·기안자·단계**까지만 싣는다 — 휴가 사유·지출 금액 명세 등
// 상세 본문은 넘기지 않는다(문서 관계자만 보는 내용이고, 비서 답변은 DB에 남는다).

import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { getClassnoteQueue } from "@/features/report-admin/server/queries";
import { humanizeClassnoteError } from "@/features/report-admin/classnote-error";
import { getApprovalBoxes } from "@/features/approvals/server/queries";
import { APPROVAL_FORM_LABEL, docStatusLabel, type ApprovalForm } from "@/features/approvals/types";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { requireMenu } from "./tool-gate";

/** timestamptz(UTC ISO) → KST 날짜 — UTC slice(0,10)는 KST 새벽 기안을 전날로 민다(tools-records와 같은 규약). */
function kstDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : kstToday(d);
}

/** 목록으로 넘길 상한 — 요약 숫자가 본체이고 목록은 "누구부터 손볼지"를 보여주는 표본이다. */
const LIST_CAP = 12;

export const reportSendStatusTool = betaZodTool({
  name: "get_report_send_status",
  description:
    "수업보고서의 학부모 발송(ClassNote) 현황을 돌려준다: 최근 N일 발송 요청의 상태 집계(대기·처리 중·성공·실패·동명이인 보류)와 손봐야 할 건 목록(학생·날짜·사유), 발송 PC(워커) 연결 상태. '보고서 발송 잘 되고 있어?', '학부모한테 안 나간 보고서 있어?' 류 질문에 사용. 작성 여부(누가 안 썼는지)는 get_report_writing_status가 담당한다.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(14).optional().describe("집계 기간(일). 기본 3일"),
  }),
  run: async ({ days }) => {
    const denied = await requireMenu("lesson_reports", "수업보고서 발송 현황");
    if (denied) return denied;
    const view = await getClassnoteQueue(days ?? 3);
    if (!view) return JSON.stringify({ error: "발송 현황을 조회할 수 없습니다." });
    const s = view.summary;
    return JSON.stringify({
      기간: `${view.since} ~ ${view.todayKst}`,
      집계: {
        전체: s.total,
        대기: s.queued,
        처리중: s.processing,
        멈춤: s.stuck,
        성공: s.success,
        실패: s.failed,
        동명이인보류: s.nameConflict,
        발송보류: s.blockedShared,
      },
      // 🔴 "이미 잃은 것" — 재발송 기한(7일)을 넘겨 영영 못 나간 건수([[#105]]). 0이면 언급하지 않는다.
      기한만료_재발송불가: view.expiredUnsent || undefined,
      실제발송여부: view.sendEnabled ? "실제 발송 켜짐" : "실제 발송 꺼짐(테스트 모드)",
      발송PC: view.workers.map((w) => ({
        이름: w.hostname,
        상태: w.online ? "연결됨" : `연결 끊김(${w.lastSeenMinutes}분 전 마지막 신호)`,
      })),
      손봐야_할_건: view.items.slice(0, LIST_CAP).map((i) => ({
        학생: i.studentName,
        날짜: i.reportDate,
        // 워커 기술 원문은 그대로 넘기지 않는다 — 한글 요약만(UI raw 노출 금지의 상류 차단).
        사유: humanizeClassnoteError(i.error) ?? "확인 필요",
      })),
      진행중_건수: view.pending.length,
    });
  },
});

export const myApprovalsTool = betaZodTool({
  name: "get_my_approvals",
  description:
    "전자결재 내 결재함을 돌려준다: 내 차례인 결재 대기 문서, 곧 내 차례가 올 예정 문서, 내가 올린 진행 중 문서. '내가 결재할 거 있어?', '내 휴가 신청 어떻게 됐어?' 류 질문에 사용. 문서 상세 내용(휴가 사유·지출 명세)은 제공하지 않는다.",
  inputSchema: z.object({}),
  run: async () => {
    const denied = await requireMenu("approvals", "전자결재 문서");
    if (denied) return denied;
    const user = await getCurrentUser();
    if (!user) return JSON.stringify({ error: "로그인이 필요합니다." });
    const boxes = await getApprovalBoxes(user.id);
    // 표가 아직 없는 배포(0212a 전)·조회 실패를 "결재할 게 없다"로 바꾸지 않는다.
    if (!boxes.ready) return JSON.stringify({ error: "전자결재 기능이 아직 준비되지 않았습니다." });
    if (boxes.loadError) return JSON.stringify({ error: "결재함을 불러오지 못했습니다." });
    const brief = (docs: typeof boxes.waiting) =>
      docs.slice(0, LIST_CAP).map((d) => ({
        문서번호: d.docNo,
        양식: APPROVAL_FORM_LABEL[d.form as ApprovalForm] ?? d.form,
        제목: d.title,
        기안자: d.drafterName,
        기안일: kstDay(d.submittedAt),
        상태: docStatusLabel(d.status).label,
      }));
    return JSON.stringify({
      결재대기: { 건수: boxes.waiting.length, 문서: brief(boxes.waiting) },
      결재예정: { 건수: boxes.upcoming.length, 문서: brief(boxes.upcoming) },
      내가올린_진행중: { 건수: boxes.inProgress.length, 문서: brief(boxes.inProgress) },
    });
  },
});
