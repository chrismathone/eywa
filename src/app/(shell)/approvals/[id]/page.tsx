import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "@/components/icons/eywa-icon-compat";
import { Pill } from "@/components/atoms/pill";
import { requireAccess } from "@/lib/auth/require-access";
import { APPROVAL_FORM_LABEL, docStatusLabel } from "@/features/approvals/types";
import { formatLeaveDays } from "@/features/leave/request-days";
import { getApprovalDoc, isMyTurn } from "@/features/approvals/server/queries";
import { ApprovalStamps } from "./_stamps";
import { DecidePanel, WithdrawPanel } from "./_decide-panel";

export const metadata = { title: "결재 문서 — eywa" };

const LEAVE_KIND_LABEL = { annual: "연차", half: "반차" } as const;

// ── 결재 이력 타임라인(하이웍스 '문서 진행 이력' 대응) ─────────────────────────
// 기안 → 처리된 단계(승인/반려 + 의견) → 종결(또는 "현재 N차 차례"). 결재 의견은 여기로 흡수한다
// (같은 의견을 두 번 그리지 않는다).

type TimelineTone = "neutral" | "green" | "danger" | "primary";

type TimelineEvent = {
  key: string;
  /** 줄 머리 — "기안"·"1차 검토"·"문서 종결"·"현재 2차 김예원 차례" */
  label: string;
  person: string | null;
  /** 결과 단어("승인"·"반려"·"회수") — tone 색으로 찍는다. */
  result: string | null;
  tone: TimelineTone;
  time: string | null;
  note: string | null;
};

const DOT_TONE: Record<TimelineTone, string> = {
  neutral: "bg-bg-soft border-line border",
  green: "bg-green",
  danger: "bg-danger",
  primary: "bg-primary",
};

const TEXT_TONE: Record<TimelineTone, string> = {
  neutral: "text-text-dim",
  green: "text-green",
  danger: "text-danger",
  primary: "text-primary",
};

/** ISO → "2026-08-14 12:34" (분까지). raw ISO 전체를 그대로 찍지 않는다. */
function fmtTime(iso: string | null): string | null {
  return iso ? iso.slice(0, 16).replace("T", " ") : null;
}

function buildTimeline(doc: NonNullable<Awaited<ReturnType<typeof getApprovalDoc>>>): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      key: "draft",
      label: "기안",
      person: doc.drafterName,
      result: null,
      tone: "neutral",
      time: fmtTime(doc.submittedAt),
      note: null,
    },
  ];

  for (const s of doc.steps) {
    if (s.decision === "pending") continue; // 처리된 칸만 — 미처리 칸은 결재란 도장이 이미 보여준다
    events.push({
      key: `step-${s.stepNo}`,
      label: `${s.stepNo}차 ${s.roleLabel}`,
      person: s.approverName,
      result: s.decision === "approved" ? "승인" : "반려",
      tone: s.decision === "approved" ? "green" : "danger",
      time: fmtTime(s.decidedAt),
      note: s.comment,
    });
  }

  if (doc.status === "pending") {
    const current = doc.steps.find((s) => s.stepNo === doc.currentStep);
    events.push({
      key: "turn",
      label: `현재 ${doc.currentStep}차 ${current?.approverName ?? ""} 차례`.replace("  ", " "),
      person: null,
      result: null,
      tone: "primary",
      time: null,
      note: null,
    });
  } else {
    const closed = docStatusLabel(doc.status);
    events.push({
      key: "closed",
      label: "문서 종결",
      person: null,
      result: closed.label,
      tone: doc.status === "approved" ? "green" : doc.status === "rejected" ? "danger" : "neutral",
      time: fmtTime(doc.completedAt),
      note: doc.outcomeNote,
    });
  }
  return events;
}

/**
 * 결재 문서 1건 — **하이웍스 결재 문서 배치**(원장 스크린샷 2026-08-14 기준):
 * 가운데 큰 표제("휴가신청서") → 정보 격자표(문서 종류·번호·기안자·일시·상태) → **원형 도장 결재란 표**
 * (참조 행 포함) → 본문(양식 항목) → 결재 이력 → 처리(내 차례면 승인·반려, 기안자면 회수).
 *
 * 열람 자격은 RLS(기안자·결재자·참조자·원장)가 정한다 — 못 보는 문서는 조회가 비어 404로 떨어진다
 * ([[#77]]: 화면 조건이 아니라 데이터 게이트가 판정한다).
 */
export default async function ApprovalDocPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("approvals");
  const { id } = await params;

  const doc = await getApprovalDoc(id).catch(() => null);
  if (!doc) notFound();

  const status = docStatusLabel(doc.status);
  const myTurn = isMyTurn(doc, user.id);
  const canWithdraw =
    doc.drafterId === user.id &&
    doc.status === "pending" &&
    doc.steps.every((s) => s.decision === "pending");
  const leave = doc.leave;
  const timeline = buildTimeline(doc);

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-4 p-4 md:p-6">
      <Link
        href="/approvals"
        className="text-text-dim hover:text-primary inline-flex items-center gap-1 text-xs font-medium transition print:hidden"
      >
        <ArrowLeft className="size-3.5" /> 결재함으로
      </Link>

      {/* 문서 — A4 종이 한 장 느낌(흰 판). 배치는 하이웍스 결재 문서 그대로. */}
      <article className="border-line bg-card shadow-card space-y-5 rounded-2xl border p-6">
        {/* ① 가운데 큰 표제 — 양식 이름이 곧 문서 제목이다(하이웍스 "휴가 신청서"). */}
        <h1 className="text-foreground text-center text-[22px] font-bold tracking-tight">
          {APPROVAL_FORM_LABEL[doc.form] ?? "결재 문서"}
        </h1>

        {/* ② 정보 격자표 — 문서 종류·번호·기안자·일시·상태(하이웍스 상단 그리드). */}
        <table className="border-line w-full border-collapse border text-sm">
          <tbody className="[&_th]:bg-bg-soft/60 [&_th]:text-text-dim [&_td]:text-foreground [&_th]:border-line [&_td]:border-line [&_th]:border [&_td]:border [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_td]:text-[13px]">
            <tr>
              <th className="w-[96px]">문서 종류</th>
              <td>공통 · {APPROVAL_FORM_LABEL[doc.form] ?? doc.form}</td>
              <th className="w-[96px]">문서 번호</th>
              <td className="num">{doc.docNo}</td>
            </tr>
            <tr>
              <th>기안자</th>
              <td>
                {doc.drafterName}
                {doc.drafterJobTitle ? (
                  <span className="text-text-faint"> {doc.drafterJobTitle}</span>
                ) : null}
              </td>
              <th>기안 일시</th>
              <td className="num">{fmtTime(doc.submittedAt)}</td>
            </tr>
            <tr>
              <th>상태</th>
              <td>
                <Pill color={status.color}>{status.label}</Pill>
              </td>
              <th>완료 일시</th>
              <td className="num">{fmtTime(doc.completedAt) ?? "—"}</td>
            </tr>
          </tbody>
        </table>

        {/* ③ 결재란 — 원형 도장 표(참조 행 포함). */}
        <ApprovalStamps doc={doc} />

        {leave ? (
          <table className="border-line w-full border-collapse border text-sm">
            <tbody className="[&_th]:bg-bg-soft/60 [&_th]:text-text-dim [&_td]:text-foreground [&_th]:border-line [&_td]:border-line [&_th]:border [&_td]:border [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_td]:text-[13px]">
              <tr>
                <th className="w-[110px]">휴가 종류</th>
                <td>{LEAVE_KIND_LABEL[leave.kind]}</td>
                <th className="w-[110px]">일수</th>
                <td className="num">{formatLeaveDays(leave.days)}</td>
              </tr>
              <tr>
                <th>기간</th>
                <td className="num" colSpan={3}>
                  {leave.startDate}
                  {leave.endDate !== leave.startDate ? ` ~ ${leave.endDate}` : ""}
                </td>
              </tr>
              <tr>
                <th>사유</th>
                <td className="break-keep" colSpan={3}>
                  {leave.reason ?? "—"}
                </td>
              </tr>
              <tr>
                <th>연차 근거</th>
                <td className="text-text-dim text-xs" colSpan={3}>
                  사용 기간{" "}
                  <span className="num">
                    {leave.periodStart} ~ {leave.periodEnd}
                  </span>{" "}
                  · 부여 <span className="num">{formatLeaveDays(leave.grantedDays)}</span> — 기안
                  시점으로 동결된 값입니다
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="text-text-faint text-sm">양식 내용을 불러오지 못했습니다.</p>
        )}

        {/* 참조는 결재란 표의 [참조] 행이 담당한다(중복 표시 금지). */}

        {/* 결재 이력 — 기안부터 종결까지 시간순. 결재 의견은 각 줄에 실린다(따로 그리지 않는다). */}
        <section className="border-line space-y-2 border-t pt-4">
          <p className="micro">결재 이력</p>
          <ol>
            {timeline.map((e, i) => (
              <li key={e.key} className="relative pb-3 pl-5 last:pb-0">
                {i < timeline.length - 1 ? (
                  <span aria-hidden className="border-line absolute top-[14px] bottom-[-2px] left-[4.5px] border-l" />
                ) : null}
                <span
                  aria-hidden
                  className={`absolute top-[4px] left-0 size-[10px] rounded-full ${DOT_TONE[e.tone]}`}
                />
                <p className="text-[13px] leading-tight">
                  <b className={e.tone === "primary" ? "text-primary" : "text-foreground"}>{e.label}</b>
                  {e.person ? <span className="text-text-dim ml-1.5">{e.person}</span> : null}
                  {e.result ? (
                    <span className={`ml-1.5 font-medium ${TEXT_TONE[e.tone]}`}>{e.result}</span>
                  ) : null}
                  {e.time ? <span className="num text-text-faint ml-2 text-[11px]">{e.time}</span> : null}
                </p>
                {e.note ? <p className="text-text-dim mt-0.5 text-xs break-keep">{e.note}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      </article>

      {myTurn ? <DecidePanel documentId={doc.id} /> : null}
      {canWithdraw ? <WithdrawPanel documentId={doc.id} /> : null}
    </div>
  );
}
