import { EyIcon } from "@/components/icons/eywa-icons";
import type { ApprovalDocRow } from "@/features/approvals/server/queries";

/**
 * 결재란 — **하이웍스 결재 문서의 도장 표** 문법(원장 스크린샷 2026-08-14).
 * 세로 라벨 [결재] + 결재자당 열 하나(맨 앞은 기안자). 윗행 = 역할("1차 검토"), 아랫행 = **원형 도장** +
 * 이름 + 처리일. 참조자가 있으면 맨 아래 [참조] 행(이름 + 체크).
 *
 * 도장 문법: 승인 = 네이비 원(하이웍스 파란 도장의 우리 브랜드 대응) · 반려 = 빨간 원 ·
 * 지금 차례 = 점선 '대기' 원 + 열 배경 살짝 · 아직 차례 아님 = 빈 점선 원.
 * ⚠️ 사람 표시는 **이름 텍스트만** — 이름 앞 아바타/이니셜 배지는 이 프로젝트에서 영구 금지다.
 */

type StampKind = "drafted" | "approved" | "rejected" | "turn" | "waiting";

type Col = {
  key: string;
  role: string;
  name: string;
  date: string | null;
  stamp: StampKind;
  /** 지금 결재할 차례인 열 — 배경을 칠해 어디서 멈췄는지 보이게. */
  active: boolean;
};

const STAMP_CLS: Record<StampKind, string> = {
  drafted: "border-line text-text-dim",
  approved: "border-primary text-primary",
  rejected: "border-danger text-danger",
  turn: "border-dashed border-primary/60 text-primary/70",
  waiting: "border-dashed border-line",
};

const STAMP_TEXT: Record<StampKind, string> = {
  drafted: "상신",
  approved: "승인",
  rejected: "반려",
  turn: "대기",
  waiting: "",
};

/** ISO → "08/14". 도장 아래 처리일 — 연도까지는 정보 격자표·이력이 담당한다. */
function mmdd(iso: string | null): string | null {
  return iso ? iso.slice(5, 10).replace("-", "/") : null;
}

export function ApprovalStamps({ doc }: { doc: ApprovalDocRow }) {
  const cols: Col[] = [
    {
      key: "draft",
      role: "기안",
      name: doc.drafterName,
      date: mmdd(doc.submittedAt),
      stamp: "drafted",
      active: false,
    },
    ...doc.steps.map((s): Col => {
      const turn =
        doc.status === "pending" && doc.currentStep === s.stepNo && s.decision === "pending";
      return {
        key: `step-${s.stepNo}`,
        role: `${s.stepNo}차 ${s.roleLabel}`,
        name: s.approverName,
        date: mmdd(s.decidedAt),
        stamp:
          s.decision === "approved"
            ? "approved"
            : s.decision === "rejected"
              ? "rejected"
              : turn
                ? "turn"
                : "waiting",
        active: turn,
      };
    }),
  ];

  return (
    // 결재자가 늘면 표가 옆으로 자란다 — 좁은 창에서는 표 안에서만 가로 스크롤.
    <div className="overflow-x-auto">
      <table className="border-line border-collapse border text-center">
        <tbody>
          <tr>
            <th
              rowSpan={2}
              className="border-line bg-bg-soft/60 text-text-dim w-9 border px-2.5 text-xs font-semibold"
            >
              결재
            </th>
            {cols.map((c) => (
              <th
                key={c.key}
                className={`border-line border px-2 py-1 text-[10px] font-semibold text-text-dim ${
                  c.active ? "bg-primary-soft/30" : "bg-bg-soft/60"
                }`}
              >
                {c.role}
              </th>
            ))}
          </tr>
          <tr>
            {cols.map((c) => (
              <td
                key={c.key}
                className={`border-line min-w-[84px] border px-2 pt-2 pb-1.5 align-top ${
                  c.active ? "bg-primary-soft/30" : ""
                }`}
              >
                <span
                  className={`mx-auto flex size-11 items-center justify-center rounded-full border-2 text-[12px] font-bold ${STAMP_CLS[c.stamp]}`}
                >
                  {STAMP_TEXT[c.stamp]}
                </span>
                <p className="text-foreground mt-1 text-[12px] font-medium whitespace-nowrap">
                  {c.name}
                </p>
                <p className="num text-text-faint text-[10px]">{c.date ?? " "}</p>
              </td>
            ))}
          </tr>
          {doc.refs.length > 0 ? (
            <tr>
              <th className="border-line bg-bg-soft/60 text-text-dim border px-2.5 py-1.5 text-xs font-semibold">
                참조
              </th>
              <td
                colSpan={cols.length}
                className="border-line border px-3 py-1.5 text-left text-[12px]"
              >
                <span className="text-foreground inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                  {doc.refs.map((r) => (
                    <span key={r.userId} className="inline-flex items-center gap-0.5">
                      {r.name}
                      <span className="text-primary">
                        <EyIcon name="check" size={12} />
                      </span>
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
