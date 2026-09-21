import { requireAccess } from "@/lib/auth/require-access";
import { isModuleEnabled } from "@/lib/modules";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getCurrentUser } from "@/lib/auth/current-user";
import { BillingContent } from "./_components/billing-content";
import { TextbooksFace } from "./_components/textbooks-face";
import { ExpensesPanel } from "./_components/expenses-panel";
import { CalculatorPanel } from "./_components/calculator-panel";
import { RefundsFace } from "./_components/refunds-face";
import { SessionTermsFace } from "./_components/session-terms-face";
import { SessionVerificationFace } from "./_components/session-verification-face";
import { TeacherSettlementFace } from "./_components/teacher-settlement-face";
import { FaceTabs, type Face } from "@/components/face-tabs";
import { MakeeduSyncBadge } from "@/components/makeedu-sync-badge";

type Sp = Record<string, string | undefined>;
type BillingTab = "billing" | "textbooks" | "expenses" | "calculator" | "refunds" | "sessions" | "verify" | "payroll";

function resolveTab(sp: Sp): BillingTab {
  return sp.tab === "textbooks"
    ? "textbooks"
    : sp.tab === "expenses"
      ? "expenses"
      : sp.tab === "calculator"
        ? "calculator"
        : sp.tab === "refunds"
          ? "refunds"
          : sp.tab === "sessions"
            ? "sessions"
            : sp.tab === "verify"
              ? "verify"
              : sp.tab === "payroll"
                ? "payroll"
                : "billing";
}

// 교재 단가표는 교재 면과 수강료 계산기 면의 "내부탭"으로 들어가 두 곳에서 쓰인다(최상위 면 아님).
const FACES: Face[] = [
  { key: "billing", label: "수납", href: "/billing" },
  { key: "textbooks", label: "교재", href: "/billing?tab=textbooks" },
  { key: "expenses", label: "지출", href: "/billing?tab=expenses" },
  { key: "calculator", label: "수강료 계산기", href: "/billing?tab=calculator" },
  { key: "sessions", label: "회차 확정", href: "/billing?tab=sessions" },
  { key: "verify", label: "시수 검증", href: "/billing?tab=verify" },
  { key: "refunds", label: "환불 요청서", href: "/billing?tab=refunds" },
];

/** 회차 정산 모듈에 속한 면 — 모듈이 꺼지면 세우지 않는다. */
const SESSION_FACE_KEYS: ReadonlySet<string> = new Set(["sessions", "verify", "payroll"]);

// 강사 정산(급여)은 원장 전용 면 — master에게만 탭 노출(급여 PII).
const PAYROLL_FACE: Face = { key: "payroll", label: "강사 정산", href: "/billing?tab=payroll" };

// 면마다 문서 제목을 달리해 창 타이틀바가 "수납관리 · 교재"로 라이브 갱신(route-window 관찰).
export async function generateMetadata({ searchParams }: { searchParams: Promise<Sp> }) {
  let tab = resolveTab(await searchParams);
  // 강사 정산 탭은 원장 전용 — 비-master가 URL로 와도 제목에 "강사 정산"을 노출하지 않는다(본문도 수납으로 폴백).
  if (tab === "payroll") {
    const u = await getCurrentUser();
    if (u?.systemRole !== "master") tab = "billing";
  }
  const suffix =
    tab === "textbooks"
      ? " · 교재"
      : tab === "expenses"
        ? " · 지출"
        : tab === "calculator"
          ? " · 수강료 계산기"
          : tab === "refunds"
            ? " · 환불 요청서"
            : tab === "sessions"
              ? " · 회차 확정"
              : tab === "verify"
                ? " · 시수 검증"
                : tab === "payroll"
                  ? " · 강사 정산"
                  : "";
  return { title: `수납관리${suffix} — aywa` };
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const user = await requireAccess("billing");
  const sp = await searchParams;
  const tab = resolveTab(sp);
  // 강사 정산 탭은 원장(master)에게만 노출. 비-master가 URL로 직접 오면 수납 면으로 폴백.
  const isMaster = user.systemRole === "master";
  // 회차 정산 모듈(회차 확정·시수 검증·강사 정산) — 꺼진 학원(새 학원 기본)은 면을 세우지 않고 주소도 수납으로 떨군다.
  // 침산은 켜져 있어 종전과 같다(2026-09-22 방향 B).
  const sessionOn = isModuleEnabled((await getTenantSettings()).modules.disabled, "session_billing");
  const baseFaces = isMaster ? [...FACES, PAYROLL_FACE] : FACES;
  const faces = sessionOn ? baseFaces : baseFaces.filter((f) => !SESSION_FACE_KEYS.has(f.key));
  const effectiveTab =
    (tab === "payroll" && !isMaster) || (!sessionOn && SESSION_FACE_KEYS.has(tab)) ? "billing" : tab;

  return (
    <div className="space-y-4 print:space-y-0">
      {(effectiveTab === "billing" || effectiveTab === "textbooks") && (
        <div className="print:hidden">
          {/* 교재 면의 기본 하위탭은 '교재신청'이고 그걸 갱신하는 도메인은 textbook_checks다.
              예전엔 catalog(= sync-all 임포터 목록에 없는 수동 도메인)를 가리켜 배지 날짜가 한 달째
              굳어 있었고, 옆의 '지금 동기화'를 눌러도 영원히 안 바뀌었다(고장난 것처럼 보임). */}
          <MakeeduSyncBadge domain={effectiveTab === "billing" ? "invoices" : "textbook_checks"} />
        </div>
      )}
      <div className="print:hidden">
        <FaceTabs faces={faces} active={effectiveTab} ariaLabel="수납관리 면 전환" />
      </div>
      {effectiveTab === "textbooks" ? (
        <TextbooksFace sp={sp} />
      ) : effectiveTab === "expenses" ? (
        <ExpensesPanel sp={sp} />
      ) : effectiveTab === "calculator" ? (
        <CalculatorPanel sp={sp} />
      ) : effectiveTab === "refunds" ? (
        <RefundsFace sp={sp} />
      ) : effectiveTab === "sessions" ? (
        <SessionTermsFace period={sp.period} subject={sp.subject} q={sp.q} page={sp.page} allocation={sp.allocation} confirmation={sp.confirmation} />
      ) : effectiveTab === "verify" ? (
        <SessionVerificationFace period={sp.period} subject={sp.subject} page={sp.page} />
      ) : effectiveTab === "payroll" ? (
        <TeacherSettlementFace period={sp.period} />
      ) : (
        <BillingContent sp={sp} />
      )}
    </div>
  );
}
