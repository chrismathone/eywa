import Link from "next/link";
import { CalendarOff, Settings2 } from "lucide-react";
import { FaceTabs, type Face } from "@/components/face-tabs";
import { getStudentOptions } from "@/features/billing/server/textbook-queries";
import { getTuitionCatalogActive } from "@/features/billing/server/tuition-catalog-queries";
import { currentPeriod } from "@/features/billing/calc";
import { koreanHolidaysForYear, holidayName } from "@/features/billing/holidays-data";
import { getTenantSettings } from "@/features/owner/server/queries";
import { TuitionCalculator } from "./tuition-calculator";
import { TuitionPricesPanel } from "./tuition-prices-panel";
import { CatalogPanel } from "./catalog-panel";

type Sp = Record<string, string | undefined>;
type CalcSub = "calculator" | "prices" | "catalog" | "holidays";

function resolveSub(sp: Sp): CalcSub {
  return sp.csub === "prices"
    ? "prices"
    : sp.csub === "catalog"
      ? "catalog"
      : sp.csub === "holidays"
        ? "holidays"
        : "calculator";
}

const SUB_FACES: Face[] = [
  { key: "calculator", label: "계산기", href: "/billing?tab=calculator" },
  { key: "prices", label: "수강료 단가", href: "/billing?tab=calculator&csub=prices" },
  { key: "catalog", label: "교재 단가표", href: "/billing?tab=calculator&csub=catalog" },
  { key: "holidays", label: "공휴일", href: "/billing?tab=calculator&csub=holidays" },
];

// 수강료 계산기 면 — ijw "계산기 모드 ↔ 설정"을 서브탭(계산기/수강료 단가/교재 단가표/공휴일)으로 이식.
// 교재 단가표는 교재 면과 같은 CatalogPanel을 재사용(두 곳에서 동일 탭).
export async function CalculatorPanel({ sp }: { sp: Sp }) {
  const sub = resolveSub(sp);

  return (
    <div className="space-y-4">
      <FaceTabs faces={SUB_FACES} active={sub} ariaLabel="수강료 계산기 면 전환" />
      {sub === "prices" ? (
        <TuitionPricesPanel sp={sp} />
      ) : sub === "catalog" ? (
        <CatalogPanel sp={sp} base={{ tab: "calculator", csub: "catalog" }} />
      ) : sub === "holidays" ? (
        <HolidayPanel />
      ) : (
        <CalculatorTab />
      )}
    </div>
  );
}

async function CalculatorTab() {
  const [students, settings, catalog] = await Promise.all([
    getStudentOptions(),
    getTenantSettings(),
    getTuitionCatalogActive(),
  ]);
  return (
    <TuitionCalculator
      students={students}
      defaultPeriod={currentPeriod()}
      holidays={settings.operations.holidays}
      catalog={catalog}
    />
  );
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function dowOf(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? "" : DOW[new Date(t).getUTCDay()];
}

// 공휴일 면 — 학원 휴원일은 학원설정(/owner)에서 편집(테넌트 설정=master 전용). 여기선 계산에 반영되는
// 휴원일 + 대한민국 공휴일(ijw 이식, 음력·대체 포함)을 읽기 전용으로 보여준다(소비처는 계산기의 countSessions).
async function HolidayPanel() {
  const settings = await getTenantSettings();
  const year = Number(currentPeriod().slice(0, 4)) || 2026;
  const tenantHolidays = [...settings.operations.holidays].sort();
  const national = koreanHolidaysForYear(year);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="bg-card border-line shadow-card space-y-3 rounded-md border p-5">
        <header className="flex items-center justify-between">
          <h2 className="text-foreground inline-flex items-center gap-1.5 text-[15px] font-bold">
            <CalendarOff className="text-primary size-4" />
            학원 지정 휴원일
          </h2>
          <Link
            href="/owner?tab=operations"
            className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition"
          >
            <Settings2 className="size-3.5" />
            학원설정에서 편집
          </Link>
        </header>
        <p className="text-text-faint text-[11px]">
          계산기에서 차시를 셀 때 <b>항상 제외</b>됩니다. 학원 휴무·시험기간 등 학원 단위 휴원일은
          학원설정 › 운영에서 관리합니다.
        </p>
        {tenantHolidays.length === 0 ? (
          <p className="text-text-dim border-line rounded-md border border-dashed px-3 py-6 text-center text-xs">
            지정된 휴원일이 없습니다.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {tenantHolidays.map((d) => (
              <li key={d} className="border-line bg-bg-soft num rounded-sm border px-2 py-1 text-xs">
                {d} <span className="text-text-faint">({dowOf(d)})</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-card border-line shadow-card space-y-3 rounded-md border p-5">
        <h2 className="text-foreground text-[15px] font-bold">
          {year}년 대한민국 공휴일 <span className="text-text-faint text-xs font-normal">({national.length}일)</span>
        </h2>
        <p className="text-text-faint text-[11px]">
          계산기의 <b>“대한민국 공휴일 제외”</b> 체크 시 차시에서 빠집니다. 음력(설·추석)·대체공휴일·
          부처님오신날까지 포함됩니다(ijw 공휴일 데이터 이식, 2024–2030).
        </p>
        <ul className="divide-line divide-y">
          {national.map((d) => (
            <li key={d} className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-foreground">{holidayName(d)}</span>
              <span className="text-text-dim num text-xs">
                {d} ({dowOf(d)})
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
