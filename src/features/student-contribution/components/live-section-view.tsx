import { ContributionLink as Link } from "./student-contribution-scope";
import type { LiveItem, LiveSection } from "@/features/students/ontology/live-contract";
import { kstDateOf } from "@/lib/date-kst";

const states = { ready: "확인됨", partial: "일부 확인", forbidden: "열람 제한", off: "사용 안 함", schema_missing: "자료 연결 전", failed: "조회 실패" };
const messages = { forbidden: "이 자료를 열람할 권한이 없습니다.", off: "새 보강관리를 사용하지 않고 있습니다. 기존 예약은 별도로 표시합니다.",
  schema_missing: "이 자료를 연결하기 위한 설정을 확인해야 합니다.", failed: "자료를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.", ready: "기록된 자료가 없습니다.", partial: "확인할 수 있는 자료가 없습니다." };

function Item({ item }: { item: LiveItem }) {
  return <li className="min-w-0 py-3">
    {item.date && <p className="mb-1 text-xs tabular-nums">{kstDateOf(item.date) ?? "날짜 확인 필요"}</p>}
    <Link href={item.evidence[0]!.href} className="line-clamp-3 break-words text-sm font-semibold text-primary hover:underline">{item.title}</Link>
    <p className="mt-1 line-clamp-3 break-words text-xs leading-relaxed">{item.detail}</p>
  </li>;
}
export function LiveSectionView({ section }: { section: LiveSection }) {
  if (section.state === "off") return null;
  const readable = section.state === "ready" || section.state === "partial";
  return <article className="min-w-0 rounded-xl border border-line bg-card">
    <div className="flex items-center justify-between gap-3 border-b border-line-faint px-4 py-3">
      <h3 className="text-sm font-semibold">{section.label}</h3>
      <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${section.state === "ready" ? "bg-secondary" : "bg-primary-softer"}`}>{states[section.state]}</span>
    </div>
    <div className="px-4">
      {section.items.length ? <><ul className="divide-y divide-line-faint">{section.items.slice(0, 3).map((item) => <Item key={item.id} item={item} />)}</ul>
        {section.items.length > 3 && <details className="border-t border-line-faint py-3"><summary className="cursor-pointer text-xs text-primary">{section.items.length - 3}건 더 보기</summary><ul className="divide-y divide-line-faint">{section.items.slice(3).map((item) => <Item key={item.id} item={item} />)}</ul></details>}</>
        : <p className="py-5 text-sm leading-relaxed">{messages[section.state]}</p>}
      {section.note && <p className="border-t border-line-faint py-3 text-xs leading-relaxed">{section.note}</p>}
    </div>
    {readable && <div className="flex items-center justify-between gap-2 border-t border-line-faint px-4 py-3 text-xs">
      <span className="tabular-nums">{section.total === null ? "전체 건수 확인 전" : `확인한 자료 ${section.total.toLocaleString("ko-KR")}건`}</span>
      <Link href={section.href} className="font-medium text-primary underline underline-offset-4">원본에서 보기</Link>
    </div>}
  </article>;
}
