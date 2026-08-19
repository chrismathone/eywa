import { EyIcon } from "@/components/icons/eywa-icons";
import { TurnChip } from "./_decide-panel";
import type { ApprovalDocRow, ApprovalStepCell } from "@/features/approvals/server/queries";

/**
 * 결재란 — 종이 결재 양식 문법(원장 스크린샷 2026-08-14): 칸 = **위 직급 / 가운데 사인 칸 / 아래 이름**.
 * 세로 라벨 [결재] + 사람당 열 하나(맨 앞은 기안자). 참조자가 있으면 맨 아래 [참조] 행(이름 + 체크).
 *
 * 사인 칸 규칙(종이처럼 **빈 칸도 자리를 차지한다** — 고정 높이):
 *   승인 = 네이비 원형 도장 · 반려 = 빨간 원형 도장 · **전결** = 네이비 '전결' 도장(그 칸에서 즉시 종결) ·
 *   **후결** = 파란 '후결' 도장(부재 후 사후 확인 완료) · **후결 대기** = 점선 amber 칩(건너뛰어진 칸) ·
 *   생략 = **사선 + '전결 생략'**(전결로 안 거친 칸 — 하이웍스 사선 표기, 원장 2026-08-19 "결재 안 해도
 *   된다는 느낌") · 지금 차례 = 파란 외곽 `결재` 칩(누르면 결재 창) + 열 배경 ·
 *   아직 차례 아님 = **완전히 빈 칸** · 기안 = 중립 '상신' 도장. 처리일은 도장 아래(mm/dd).
 *
 * **대결**(0216a): 부재자 대신 결재한 실제 처리자(acted_by)가 있으면 도장 아래 "대결 · 이름"을 찍는다 —
 * 칸의 주인(이름 행)은 그대로 부재자다(결재란의 자리는 결재선이 정한 사람 것).
 *
 * ⚠️ 위/가운데/아래를 tr 세 개로 가르면 칸 안에 가로 표선이 생겨 종이 결재 룩이 깨진다 —
 *    헤더(직급)만 tr로 두고 **사인+이름은 한 td 안에** 쌓는다.
 * ⚠️ 사람 표시는 **이름 텍스트만** — 이름 앞 아바타/이니셜 배지는 이 프로젝트에서 영구 금지다.
 */

type SignKind =
  | "drafted"
  | "approved"
  | "rejected"
  | "final"
  | "post_approved"
  | "deferred"
  | "skipped"
  | "turn"
  | "blank";

type Col = {
  key: string;
  /** 칸 머리 — 직급(없으면 역할 라벨 폴백). */
  title: string;
  name: string;
  date: string | null;
  sign: SignKind;
  /** 대결 실제 처리자(부재자 대신 결재). null = 본인 결재. */
  actedByName: string | null;
  /** 지금 결재할 차례인 열 — 배경을 칠해 어디서 멈췄는지 보이게. */
  active: boolean;
};

type StampKind = Exclude<SignKind, "turn" | "blank" | "deferred" | "skipped">;

/**
 * 도장 색 — 의미색 캐논. 승인·전결 = positive(종결) · 반려 = critical · 후결 = info · 상신 = inert.
 * ⚠️ 승인·전결이 종전엔 primary(네이비)였다 — 결재함 배지(`docStatusLabel`)는 같은 '승인'을 초록으로
 *    그려서, 목록에서 초록으로 본 문서를 열면 도장이 네이비였다.
 * 📌 승인과 전결이 같은 색인 건 의도다(둘 다 "이 칸에서 통과") — 구분은 도장 **글자**가 한다.
 */
const STAMP_CLS: Record<StampKind, string> = {
  drafted: "border-line text-text-dim",
  approved: "border-green text-green",
  rejected: "border-danger text-danger",
  final: "border-green text-green",
  post_approved: "border-blue text-blue",
};

const STAMP_TEXT: Record<StampKind, string> = {
  drafted: "상신",
  approved: "승인",
  rejected: "반려",
  final: "전결",
  post_approved: "후결",
};

/** ISO → "08/14". 도장 아래 처리일 — 연도까지는 정보 격자표·이력이 담당한다. */
function mmdd(iso: string | null): string | null {
  return iso ? iso.slice(5, 10).replace("-", "/") : null;
}

/** 결재란 칸의 사인 종류 — 판단(decision)과 문서 상태에서 도출. 한 곳에서만 정한다. */
function signOf(step: ApprovalStepCell, doc: ApprovalDocRow): SignKind {
  switch (step.decision) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "final":
      return "final";
    case "post_approved":
      return "post_approved";
    case "deferred":
      return "deferred";
    case "skipped":
      return "skipped";
    default: {
      const turn = doc.status === "pending" && doc.currentStep === step.stepNo;
      return turn ? "turn" : "blank";
    }
  }
}

/** 사인 칸 내용 — 종이처럼 칸 높이는 항상 같고, 상태에 따라 내용만 달라진다. */
function SignArea({ col, actionable }: { col: Col; actionable: boolean }) {
  if (col.sign === "blank") return null; // 빈 사인 칸 — 자리만 지킨다
  if (col.sign === "turn") {
    // 처리할 수 있는 사람(아래 결재 패널이 뜬 사람)에게만 **버튼** — 그 외엔 상태 표시만.
    // 기안자 화면에서 버튼처럼 보이면 "눌러도 안 되는 결재 버튼"이 된다(원장 2026-08-18 제보).
    if (!actionable) {
      return (
        <span className="border-primary/50 text-primary/70 inline-flex items-center rounded-md border border-dashed px-2 py-1 text-[11px] font-semibold">
          결재 차례
        </span>
      );
    }
    return <TurnChip />;
  }
  if (col.sign === "deferred") {
    // 부재로 건너뛰어진 칸 — 사후 '후결 확인'을 기다린다(하이웍스 후열 '확인' 대응).
    return (
      <span className="border-amber/70 text-amber inline-flex items-center rounded-md border border-dashed px-2 py-1 text-[11px] font-semibold">
        후결 대기
      </span>
    );
  }
  if (col.sign === "skipped") {
    // 전결로 문서가 그 앞에서 종결돼 거치지 않은 칸 — 하이웍스처럼 사선을 그어
    // "결재하지 않아도 되는 칸"임을 보이게 한다(원장 2026-08-19).
    return (
      <span
        className="relative flex h-full w-full items-center justify-center"
        title="앞 단계 전결로 승인 종결되어 결재가 필요 없는 칸입니다"
      >
        {/* 칸 대각선(좌하→우상) — 그라디언트 헤어라인(인라인 SVG는 아이콘 가드가 차트·장식 승인 목록으로 잠근다). */}
        <span
          aria-hidden
          className="absolute inset-0 [background:linear-gradient(to_top_right,transparent_calc(50%-0.5px),var(--line-strong)_calc(50%-0.5px),var(--line-strong)_calc(50%+0.5px),transparent_calc(50%+0.5px))]"
        />
        <span className="bg-card text-text-faint relative px-1 text-[11px] font-medium">
          전결 생략
        </span>
      </span>
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

export function ApprovalStamps({
  doc,
  actionable = false,
}: {
  doc: ApprovalDocRow;
  /** 열람자가 지금 이 문서를 처리할 수 있는가(결재 패널 노출과 동일 판정) — true일 때만 '결재' 칩이 버튼. */
  actionable?: boolean;
}) {
  const cols: Col[] = [
    {
      key: "draft",
      title: doc.drafterJobTitle ?? "기안",
      name: doc.drafterName,
      date: mmdd(doc.submittedAt),
      sign: "drafted",
      actedByName: null,
      active: false,
    },
    ...doc.steps.map((s): Col => {
      const sign = signOf(s, doc);
      return {
        key: `step-${s.stepNo}`,
        title: s.approverJobTitle ?? s.roleLabel,
        name: s.approverName,
        date: mmdd(s.decidedAt),
        sign,
        actedByName: s.actedByName,
        active: sign === "turn",
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
                  <SignArea col={c} actionable={actionable} />
                </span>
                {c.actedByName ? (
                  <p className="text-text-faint text-[10px] leading-tight whitespace-nowrap">
                    대결 · {c.actedByName}
                  </p>
                ) : null}
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
