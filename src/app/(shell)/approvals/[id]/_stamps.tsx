import { EyIcon } from "@/components/icons/eywa-icons";
import type { ApprovalDocRow } from "@/features/approvals/server/queries";

/**
 * 결재란 — 종이 결재 양식 문법(원장 스크린샷 2026-08-14): 칸 = **위 직급 / 가운데 사인 칸 / 아래 이름**.
 * 세로 라벨 [결재] + 사람당 열 하나(맨 앞은 기안자). 참조자가 있으면 맨 아래 [참조] 행(이름 + 체크).
 *
 * 사인 칸 규칙(종이처럼 **빈 칸도 자리를 차지한다** — 고정 높이):
 *   승인 = 네이비 원형 도장 + 처리일 · 반려 = 빨간 원형 도장 + 처리일 ·
 *   지금 차례 = 파란 외곽 `결재` 칩(#decide 앵커 — 아래 처리 패널로) + 열 배경 ·
 *   아직 차례 아님 = **완전히 빈 칸**(점선 원도 없음 — "사인 란도 작성칸이지만 비워놓고") ·
 *   기안 = 중립 '상신' 도장 + 기안일.
 *
 * ⚠️ 위/가운데/아래를 tr 세 개로 가르면 칸 안에 가로 표선이 생겨 종이 결재 룩이 깨진다 —
 *    헤더(직급)만 tr로 두고 **사인+이름은 한 td 안에** 쌓는다.
 * ⚠️ 사람 표시는 **이름 텍스트만** — 이름 앞 아바타/이니셜 배지는 이 프로젝트에서 영구 금지다.
 */

type SignKind = "drafted" | "approved" | "rejected" | "turn" | "blank";

type Col = {
  key: string;
  /** 칸 머리 — 직급(없으면 역할 라벨 폴백). */
  title: string;
  name: string;
  date: string | null;
  sign: SignKind;
  /** 지금 결재할 차례인 열 — 배경을 칠해 어디서 멈췄는지 보이게. */
  active: boolean;
};

const STAMP_CLS: Record<Exclude<SignKind, "turn" | "blank">, string> = {
  drafted: "border-line text-text-dim",
  approved: "border-primary text-primary",
  rejected: "border-danger text-danger",
};

const STAMP_TEXT: Record<Exclude<SignKind, "turn" | "blank">, string> = {
  drafted: "상신",
  approved: "승인",
  rejected: "반려",
};

/** ISO → "08/14". 도장 아래 처리일 — 연도까지는 정보 격자표·이력이 담당한다. */
function mmdd(iso: string | null): string | null {
  return iso ? iso.slice(5, 10).replace("-", "/") : null;
}

/** 사인 칸 내용 — 종이처럼 칸 높이는 항상 같고, 상태에 따라 내용만 달라진다. */
function SignArea({ col }: { col: Col }) {
  if (col.sign === "blank") return null; // 빈 사인 칸 — 자리만 지킨다
  if (col.sign === "turn") {
    return (
      <a
        href="#decide"
        className="border-primary text-primary hover:bg-primary-soft/50 inline-flex items-center rounded-md border px-2.5 py-1 text-[12px] font-bold transition"
      >
        결재
      </a>
    );
  }
  return (
    <span className="inline-flex flex-col items-center gap-1">
      <span
        className={`flex size-14 items-center justify-center rounded-full border-2 text-[15px] font-bold ${STAMP_CLS[col.sign]}`}
      >
        {STAMP_TEXT[col.sign]}
      </span>
      <span className="num text-text-faint text-[10px] leading-none">{col.date ?? ""}</span>
    </span>
  );
}

export function ApprovalStamps({ doc }: { doc: ApprovalDocRow }) {
  const cols: Col[] = [
    {
      key: "draft",
      title: doc.drafterJobTitle ?? "기안",
      name: doc.drafterName,
      date: mmdd(doc.submittedAt),
      sign: "drafted",
      active: false,
    },
    ...doc.steps.map((s): Col => {
      const turn =
        doc.status === "pending" && doc.currentStep === s.stepNo && s.decision === "pending";
      return {
        key: `step-${s.stepNo}`,
        title: s.approverJobTitle ?? s.roleLabel,
        name: s.approverName,
        date: mmdd(s.decidedAt),
        sign:
          s.decision === "approved"
            ? "approved"
            : s.decision === "rejected"
              ? "rejected"
              : turn
                ? "turn"
                : "blank",
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
                className={`border-line text-text-dim border px-2 py-1 text-[10px] font-semibold ${
                  c.active ? "bg-primary-soft/30" : "bg-bg-soft/60"
                }`}
              >
                {c.title}
              </th>
            ))}
          </tr>
          <tr>
            {cols.map((c) => (
              <td
                key={c.key}
                className={`border-line min-w-[96px] border px-2 pt-1.5 pb-1.5 align-bottom ${
                  c.active ? "bg-primary-soft/30" : ""
                }`}
              >
                {/* 사인 칸 — 고정 높이로 항상 확보(빈 칸도 종이처럼 자리가 있다 · 원장 "사인란 더 크게"). */}
                <span className="flex h-20 items-center justify-center">
                  <SignArea col={c} />
                </span>
                <p className="text-foreground mt-0.5 text-[12px] font-medium whitespace-nowrap">
                  {c.name}
                </p>
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
