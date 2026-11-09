import { ContributionLink as Link } from "./student-contribution-scope";
import { familyBonus, familyRates, type FamilyLoyalty } from "../model/family-loyalty";
import type { ContributionConfig } from "../model/config";
import { numberText } from "./presentation";

export function FamilyLoyaltyCard({ family, config, studentId }: { family: FamilyLoyalty; config: ContributionConfig; studentId: string }) {
  const points = familyBonus(family, config), rates = familyRates(config);
  if (family.state !== "ready") return <section className="rounded-xl border border-line bg-secondary p-5" aria-label="가족 재원 확인">
    <h3 className="font-semibold">가족 동시 재원 · 점수 확인 대기</h3>
    <p className="mt-2 text-sm">{family.state === "restricted" ? "가족 전체 자료의 열람 권한이 필요합니다. 담당 관리자 화면에서 확인해 주세요." : "가족 또는 수강 자료를 읽지 못했습니다. 0점으로 처리하지 않고 충성도 순위를 보류합니다."}</p>
  </section>;
  return <section className="rounded-2xl border border-amber/40 bg-gradient-to-r from-amber-soft via-background to-card p-5 text-foreground" aria-label="가족 동시 재원 충성도">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-xs font-bold tracking-wider text-att-late-ink">가족 동시 재원 · 우선 배점</p>
        <h3 className="mt-2 text-2xl font-bold">{family.activeCount! >= 2 ? `${family.activeCount}남매 함께 재원` : "연결된 가족의 재원 현황"}</h3>
        <p className="mt-1 text-sm">본인 포함 {family.activeCount}명 · {family.asOf} 기준 정규 수강 확인</p></div>
      <div className="rounded-xl bg-card px-6 py-3 text-right shadow-sm"><p className="text-xs text-att-late-ink">현재 가족 가점{!rates.enabled && " · 평가 제외"}</p><strong className="text-3xl text-att-late-ink">+{numberText(points ?? 0)}<span className="ml-1 text-sm">점</span></strong></div>
    </div>
    <div className="mt-4 flex flex-wrap gap-2">{family.members.map(m => <Link key={m.id} href={`/students/${m.id}`} className={`rounded-full border px-3 py-2 text-sm ${m.active ? "border-amber/30 bg-card" : "border-line bg-secondary text-text-dim"}`}>
      <strong>{m.name}</strong>{m.id === studentId && " (본인)"} · {m.active ? "재원" : "가산 제외"}{m.basis === "phone" && " · 자동 연결"}
    </Link>)}</div>
    <p className="mt-3 text-xs leading-relaxed">본인 포함 2명 +{numberText(rates.two)}점 · 3명 +{numberText(rates.three)}점 · 4명 이상 +{numberText(rates.fourPlus)}점. 현재 가족 상태에 한 번 가산하며 월별 실적에 누적하지 않습니다. 본인이 휴원·퇴원하면 가족 가점은 제외됩니다.</p>
    <p className="mt-2 text-xs">같은 보호자 휴대폰 또는 직접 지정한 형제 관계 기준 · 이름만 같은 보호자는 가산하지 않습니다.{family.needsReview > 0 && ` 확인할 관계 ${family.needsReview}건이 있습니다.`} <Link href={`/students/${studentId}/edit`} className="font-semibold underline">가족 연결 확인·수정 →</Link></p>
  </section>;
}

export function FamilyLoyaltyOverview({ rows, config }: { rows: { id: string; family: FamilyLoyalty }[]; config: ContributionConfig }) {
  const groups = new Map<string, FamilyLoyalty>();
  for (const r of rows) if (r.family.state === "ready" && r.family.selfActive && r.family.activeCount! >= 2) {
    const key = r.family.members.filter(m => m.active).map(m => m.id).sort().join("|");
    if (!groups.has(key)) groups.set(key, r.family);
  }
  const families = [...groups.values()].sort((a,b) => b.activeCount! - a.activeCount!);
  return <section className="rounded-2xl border border-amber/30 bg-amber-soft/70 p-5" aria-label="함께 다니는 가족">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-bold text-foreground">함께 다니는 가족, 더 큰 신뢰</h2><p className="mt-1 text-sm">조회한 학생의 가족 {families.length}개 연결 그룹 · 3남매 이상 {families.filter(f => f.activeCount! >= 3).length}그룹</p></div><span className="rounded-full bg-amber-soft px-3 py-1 text-xs font-bold text-att-late-ink">가족 재원 가점 우선 반영</span></div>
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{families.slice(0,6).map(f => <article key={f.members.map(m=>m.id).sort().join("|")} className="rounded-xl border border-amber/30 bg-card p-4">
      <div className="flex justify-between gap-2"><strong className="text-att-late-ink">{f.activeCount}남매 재원</strong><span className="font-bold text-att-late-ink">각 +{numberText(familyBonus(f,config) ?? 0)}점</span></div>
      <div className="mt-3 flex flex-wrap gap-2">{f.members.filter(m=>m.active).map(m=><Link key={m.id} className="rounded-lg bg-amber-soft px-2 py-1 text-sm font-medium underline-offset-4 hover:underline" href={`/student-contribution/${m.id}`}>{m.name}</Link>)}</div>
    </article>)}</div>
    {!families.length && <p className="mt-3 text-sm">현재 연결 자료에서 동시 재원 가족을 확인하지 못했습니다. 학생 정보의 형제자매 연결을 확인해 주세요.</p>}
    <p className="mt-3 text-xs">가족 수가 많은 순으로 최대 6그룹 표시 · 전체 가족 학생은 아래 ‘형제자매 함께 재원’ 필터로 확인하세요. 가족 관계가 다르게 연결된 경우 그룹 수가 실제 가구 수와 다를 수 있습니다.</p>
  </section>;
}
