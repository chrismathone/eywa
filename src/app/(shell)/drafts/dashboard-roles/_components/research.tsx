/**
 * 조사 요약(첫 화면) — 지금 운영실 항목 전수 × 민감도 제안, 침산 직원 분포, 기존 권한과 잇는 법, 원장이 정할 것.
 * 서버 컴포넌트(상태 없음). 표 = 열 제목과 값은 같은 축 · 열 구분선은 `--line-faint`.
 * 슈퍼관리자 계정이 든 행·문장(`superAdminOnly`)은 슈퍼관리자가 볼 때만 — 원장에겐 슈퍼관리자가 '관리자'로 보인다.
 */
import type { ReactNode } from "react";
import { Pill } from "@/components/atoms/pill";
import { toneColor } from "@/lib/design/semantic-color";
import { BUNDLES } from "../_data/bundles";
import { ACTIVE_STAFF, BUNDLE_PEOPLE, INVENTORY, OWNER_DECIDES, STAFF_DIST, TIER_TONE, WIRING, type Tier } from "../_data/research";

const TABLE =
  "w-full border-collapse text-sm [&_th]:bg-bg-soft [&_th]:px-3 [&_th]:py-2 [&_th]:font-bold [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_tr]:border-line [&_tbody_tr]:border-t [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint";

function TierBadge({ tier }: { tier: Tier }) {
  return <Pill color={toneColor(TIER_TONE[tier])}>{tier}</Pill>;
}

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="bg-card shadow-card overflow-hidden rounded-2xl">
      <header className="px-4 pt-3.5 pb-2">
        <h3 className="text-base font-bold">{title}</h3>
        {sub ? <p className="text-xs">{sub}</p> : null}
      </header>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

export function Research({ superAdmin }: { superAdmin: boolean }) {
  const staff = STAFF_DIST.filter((r) => superAdmin || !r.superAdminOnly);
  const wiring = WIRING.filter((w) => superAdmin || !w.superAdminOnly);
  const active = superAdmin ? ACTIVE_STAFF.withSuperAdmin : ACTIVE_STAFF.base;
  const counts = INVENTORY.reduce<Record<Tier, number>>(
    (acc, r) => ({ ...acc, [r.tier]: acc[r.tier] + 1 }),
    { "원장 전용": 0, 관리자급: 0, 실무: 0, 누구나: 0 },
  );
  return (
    <div className="flex flex-col gap-5">
      <Section
        title="역할 묶음 4개 — 운영 DB로 정함"
        sub={`침산 활성 직원 ${active}명(2026-10-01 읽기 전용 조회). 강사 17명은 운영실이 잠겨 있고(원스크린), 열람 1명은 역할 설정으로 꺼져 있어 대상에서 뺐다.`}
      >
        <table className={TABLE}>
          <thead>
            <tr>
              <th className="text-left">시스템 역할</th>
              <th className="text-left">직급 · 부서</th>
              <th className="text-left">담당 과목</th>
              <th className="text-center">인원</th>
              <th className="text-left">운영실 지금</th>
              <th className="text-left">묶음</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((r) => (
              <tr key={`${r.role}-${r.title}`}>
                <td>{r.role}</td>
                <td>{r.title}</td>
                <td>{r.subject}</td>
                <td className="num text-center font-bold">{r.n}</td>
                <td>{r.now}</td>
                <td className="font-bold">{r.bundle}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-3 grid gap-2 lg:grid-cols-2">
          {BUNDLES.map((b) => (
            <li key={b.id} className="bg-bg-soft rounded-xl px-3 py-2 text-sm">
              <span className="font-bold">{b.label}</span> · {b.rule} ·{" "}
              {superAdmin ? (BUNDLE_PEOPLE[b.id].withSuperAdmin ?? BUNDLE_PEOPLE[b.id].base) : BUNDLE_PEOPLE[b.id].base}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title={`지금 운영실 항목 ${INVENTORY.length}개 × 민감도 제안`}
        sub={`원장 전용 ${counts["원장 전용"]} · 관리자급 ${counts.관리자급} · 실무 ${counts.실무} · 누구나 ${counts.누구나}. 지금은 원장만 보는 칸이 하나도 없다 — 카드는 메뉴 권한으로만 걸러진다.`}
      >
        <table className={`${TABLE} table-fixed`}>
          <colgroup>
            <col className="w-20" />
            <col className="w-56" />
            <col />
            <col className="w-52" />
            <col className="w-28" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th className="text-center">영역</th>
              <th className="text-left">항목</th>
              <th className="text-left">담긴 것</th>
              <th className="text-left">지금 보는 역할</th>
              <th className="text-center">제안</th>
              <th className="text-left">메모</th>
            </tr>
          </thead>
          <tbody>
            {INVENTORY.map((r) => (
              <tr key={`${r.area}-${r.item}`}>
                <td className="text-center">{r.area}</td>
                <td className="font-bold">{r.item}</td>
                <td>{r.data}</td>
                <td>{r.now}</td>
                <td className="text-center">
                  <TierBadge tier={r.tier} />
                </td>
                <td>{r.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-stretch">
        <Section title="기존 권한 체계와 잇는 법">
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
            {wiring.map((w) => (
              <li key={w.text}>{w.text}</li>
            ))}
          </ol>
        </Section>
        <Section title="원장이 정할 것 — 경계가 애매한 항목">
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
            {OWNER_DECIDES.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ol>
        </Section>
      </div>
    </div>
  );
}
