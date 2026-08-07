import Link from "next/link";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getPeriodDefsForEditor } from "@/features/periods/server/queries";
import { SettingsCard } from "./section-form";
import { SessionYearEditor } from "./session-year-editor";

/**
 * 세션 기간 설정 — 학원이 정한 과목별 수업 구간(달력월이 아님).
 *
 * ⚠️ 다른 설정 탭과 달리 `tenant_settings` jsonb가 아니라 **별도 테이블**(operating_periods, 0189a)이다.
 *    구간 겹침을 DB로 막아야 하는데 jsonb엔 EXCLUDE 제약을 걸 수 없기 때문. 그래서 저장도
 *    `saveOwnerSection`이 아니라 전용 액션(savePeriodsForSubject)을 쓴다.
 *    "설정은 owner 단일 진입점" 규칙은 tenant_settings 직접 쓰기 금지(#59)에 대한 것이라 충돌하지 않는다.
 */
export async function SessionsSection({ year }: { year: number }) {
  const settings = await getTenantSettings();
  const subjects = buildSubjectMaps(settings.operations.subjects).options;
  const defs = await getPeriodDefsForEditor(year);
  const holidays = settings.operations.holidays.map((h) => h.date);

  const years = [year - 1, year, year + 1];

  return (
    <div className="space-y-4">
      <SettingsCard
        title="세션 기간"
        description={
          <>
            학원이 정한 <b>과목별 수업 구간</b>입니다. 달력월(1일~말일)과 다릅니다 — 공휴일로 빠진 요일을 채우느라
            다음 달까지 넘어가도 그대로 두시면 됩니다(예: 2월 세션이 3/5까지). 주말은 사이에 낀 날이라 세션에
            포함되고, 공휴일·휴원일은 수업 횟수에서 빠집니다.
            <br />
            <b>세션을 비워 둔 달은 지금처럼 달력월로 동작합니다</b> — 한 과목만 먼저 넣어보셔도 됩니다.
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-text-dim text-[11px]">연도</span>
          {years.map((y) => (
            <Link
              key={y}
              href={`/owner?tab=sessions&year=${y}`}
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                y === year ? "bg-primary text-primary-foreground" : "bg-surface text-text-dim border-line border"
              }`}
            >
              {y}년
            </Link>
          ))}
        </div>
      </SettingsCard>

      <SessionYearEditor year={year} subjects={subjects} defs={defs} holidays={holidays} />

      <p className="text-text-faint text-[12px]">
        수업 횟수 검산은 <b>알림일 뿐</b>이라 4회가 아니어도 그대로 저장됩니다 — 방학·휴원으로 일부러 짧은 달이
        있을 수 있으니까요. 공휴일 목록은 운영 체계 탭에서 관리합니다.
      </p>
    </div>
  );
}
