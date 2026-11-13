import { canReadSalary } from "@/features/payroll/server/salary-access";
import { requireAccess } from "@/lib/auth/require-access";
import { redirectStatsFirst } from "@/lib/auth/stats-first";
import { isModuleEnabled } from "@/lib/modules";
import { getTenantSettings } from "@/features/owner/server/queries";
import { BillingContent } from "./_components/billing-content";
import { TextbooksFace } from "./_components/textbooks-face";
import { ExpensesPanel } from "./_components/expenses-panel";
import { CalculatorPanel } from "./_components/calculator-panel";
import { RefundsFace } from "./_components/refunds-face";
import { SessionTermsFace } from "./_components/session-terms-face";
import { TeacherSettlementFace } from "./_components/teacher-settlement-face";
import { FaceTabs, type Face } from "@/components/face-tabs";
import { MakeeduSyncBadge } from "@/components/makeedu-sync-badge";
import { canManageTenant, canAccessTenant } from "@/lib/auth/perm-matrix";
import { redirect } from "next/navigation";
import { legacyVerificationHref } from "@/features/billing/session-terms/panel-href";

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
  { key: "billing", label: "수납", href: "/billing?list=1" },
  { key: "textbooks", label: "교재", href: "/billing?tab=textbooks" },
  { key: "expenses", label: "지출", href: "/billing?tab=expenses" },
  { key: "calculator", label: "수강료 계산기", href: "/billing?tab=calculator" },
  { key: "sessions", label: "회차 확정", href: "/billing?tab=sessions" },
  { key: "refunds", label: "환불 요청서", href: "/billing?tab=refunds" },
];

/** 회차 정산 모듈에 속한 면 — 모듈이 꺼지면 세우지 않는다. */
const SESSION_FACE_KEYS: ReadonlySet<string> = new Set(["sessions", "verify", "payroll"]);

// 강사 정산(급여)은 원장 전용 면 — master에게만 탭 노출(급여 PII).
const PAYROLL_FACE: Face = { key: "payroll", label: "강사 정산", href: "/billing?tab=payroll" };

// 면마다 문서 제목을 달리해 창 타이틀바가 "수납관리 · 교재"로 라이브 갱신(route-window 관찰).
export async function generateMetadata({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  let tab = resolveTab(sp);
  // 강사 정산 탭은 원장 전용 — 비-master가 URL로 와도 제목에 "강사 정산"을 노출하지 않는다(본문도 수납으로 폴백).
  if (tab === "payroll" && !(await canReadSalary())) tab = "billing";
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
              ? sp.panel === "verify" ? " · 회차 확정 · 청구 시수 대조" : " · 회차 확정"
              : tab === "verify"
                ? " · 회차 확정 · 청구 시수 대조"
                : tab === "payroll"
                  ? " · 강사 정산"
                  : "";
  return { title: `수납관리${suffix} — 에이와` };
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const tab = resolveTab(sp);
  const user = await requireAccess(tab === "payroll" ? "payroll_settings" : "billing");
  if (tab === "verify") redirect(legacyVerificationHref(sp));
  // 강사 정산 탭은 원장(master)·총괄(super_admin)에게만 노출(감사 D6 — 총괄은 게이트 자동 통과). 그 밖이 URL로 오면 수납 면으로 폴백.
  const isMaster = await canReadSalary();
  const canBilling = await canAccessTenant(user.systemRole, "billing");
  // 원장·관리자가 메뉴로 열면 통계가 먼저(stats-first.ts) — 필터·탭이 실린 주소와 '목록으로'(list=1)는 그대로 목록.
  if (canBilling) await redirectStatsFirst(user.systemRole, sp, "/billing");
  // 회차 정산 모듈(회차 확정·시수 검증·강사 정산) — 꺼진 학원(새 학원 기본)은 면을 세우지 않고 주소도 수납으로 떨군다.
  // 침산은 켜져 있어 종전과 같다(2026-09-22 방향 B).
  const sessionOn = isModuleEnabled((await getTenantSettings()).modules.disabled, "session_billing");
  const baseFaces = [...(canBilling ? FACES : []), ...(isMaster ? [PAYROLL_FACE] : [])];
  const faces = sessionOn ? baseFaces : baseFaces.filter((f) => !SESSION_FACE_KEYS.has(f.key));
  const effectiveTab =
    (tab === "payroll" && !isMaster) || (!sessionOn && SESSION_FACE_KEYS.has(tab)) ? "billing" : tab;
  if (effectiveTab !== "payroll" && !canBilling) await requireAccess("billing");
  // 엑셀 가져오기(원장 2026-09-29) — 수납 면 = 청구서, 지출 면 = 지출. 일괄 작업이라 billing **full**만(올리기 주소도 같은 판정).
  // 버튼은 각 면의 검색 줄(ExcelMenu — 내보내기와 한 버튼)에 선다.
  const importKind = effectiveTab === "billing" ? "invoices" : effectiveTab === "expenses" ? "expenses" : null;
  const canImport = importKind !== null && (await canManageTenant(user.systemRole, "billing"));

  return (
    <div className="space-y-4 print:space-y-0">
      {/* 동기화 시각은 면 탭과 **같은 줄 오른쪽 끝**(원장 2026-10-15 *"동기화 6시간 우상단 이것 때문에 여백낭비 … 같은행으로 맞춰서 여백 최소화"*) —
          예전엔 배지가 제 줄을 따로 써서 탭 위가 한 줄 비었다. 좁으면 배지가 탭 아래 줄로 접힌다(flex-wrap).
          경고 상세는 배지 아래에 띄운다(`overlay`) — 흐름 안에서 펼치면 상자 폭만큼 배지 칸이 넓어져 탭 아래 줄로 넘어갔다(누른 배지가 자리를 옮김). */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="min-w-0 max-w-full self-start">
          <FaceTabs faces={faces} active={effectiveTab} ariaLabel="수납관리 면 전환" />
        </div>
        {effectiveTab === "billing" || effectiveTab === "textbooks" ? (
          <div className="ml-auto">
            {/* 교재 면의 기본 하위탭은 '교재신청'이고 그걸 갱신하는 도메인은 textbook_checks다.
                예전엔 catalog(= sync-all 임포터 목록에 없는 수동 도메인)를 가리켜 배지 날짜가 한 달째
                굳어 있었고, 옆의 '지금 동기화'를 눌러도 영원히 안 바뀌었다(고장난 것처럼 보임). */}
            <MakeeduSyncBadge domain={effectiveTab === "billing" ? "invoices" : "textbook_checks"} overlay />
          </div>
        ) : null}
      </div>
      {effectiveTab === "textbooks" ? (
        <TextbooksFace sp={sp} />
      ) : effectiveTab === "expenses" ? (
        <ExpensesPanel sp={sp} canImport={canImport} />
      ) : effectiveTab === "calculator" ? (
        <CalculatorPanel sp={sp} />
      ) : effectiveTab === "refunds" ? (
        <RefundsFace sp={sp} />
      ) : effectiveTab === "sessions" ? (
        <SessionTermsFace period={sp.period} subject={sp.subject} q={sp.q} page={sp.page} only={sp.only} allocation={sp.allocation} confirmation={sp.confirmation} panel={sp.panel} status={sp.status} params={sp} />
      ) : effectiveTab === "payroll" ? (
        <TeacherSettlementFace period={sp.period} />
      ) : (
        <BillingContent sp={sp} canImport={canImport} />
      )}
    </div>
  );
}
