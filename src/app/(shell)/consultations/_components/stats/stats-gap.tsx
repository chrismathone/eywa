import { WindowLink } from "@/components/workspace/window-link";
import { Pill } from "@/components/atoms/pill";
import type { GapStats } from "@/features/consultations/stats-model";

const fmt = (n: number) => n.toLocaleString("ko-KR");

/**
 * 상담 공백 재원생 — 옛 통계 화면의 '상담 필요 학생'을 옮겨 온 것(원장 *"학생당 상담 빈도"* — 오래 상담이 없는 재원생 수).
 * 🔴 기준을 적는다: 오늘 기준 · 재원생(테스트 학생 제외) · **목록 필터와 무관**(마지막 상담은 누가 했든 마지막이다).
 * 강사는 담당 학생만(옛 화면에서 전교생 명단이 샌 자리 — queries.ts 주석).
 */
export function StatsGap({ gap, teacherScoped }: { gap: GapStats; teacherScoped: boolean }) {
  const who = teacherScoped ? "담당 재원생" : "재원생";
  const today = `${Number(gap.today.slice(5, 7))}/${Number(gap.today.slice(8, 10))}`;
  return (
    <div className="border-line space-y-2 rounded-2xl border p-3">
      <div>
        <p className="text-foreground text-sm font-bold">상담 공백</p>
        <p className="text-muted-foreground text-xs break-keep">
          오늘({today}) 기준 · {gap.full ? `${who} ${fmt(gap.enrolled)}명 중` : who} · 목록 필터와 무관
        </p>
      </div>
      {gap.full ? (
        <dl className="grid grid-cols-4 gap-1 text-center">
          <GapCell label="30일+" value={gap.d30 + gap.never} />
          <GapCell label="60일+" value={gap.d60 + gap.never} />
          <GapCell label="90일+" value={gap.d90 + gap.never} />
          <GapCell label="이력 없음" value={gap.never} />
        </dl>
      ) : (
        <p className="text-foreground text-sm">
          30일 넘게 상담 없음 <b className="num">{fmt(gap.d30plus)}</b>명
        </p>
      )}
      {gap.full ? <p className="text-muted-foreground text-xs break-keep">30·60·90일+에는 상담 이력이 없는 원생도 들어 있다.</p> : null}
      {gap.top.length > 0 ? (
        <ul className="divide-line divide-y">
          {gap.top.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
              <WindowLink href={`/students/${s.id}`} title={s.name} className="text-foreground min-w-0 truncate text-sm font-medium hover:underline">
                {s.name}
                {s.grade ? <span className="text-muted-foreground ml-1 text-xs">{s.grade}</span> : null}
              </WindowLink>
              <span className="flex shrink-0 items-center gap-2">
                {s.last === null ? (
                  <Pill color="danger">이력 없음</Pill>
                ) : (
                  <span className="num text-muted-foreground text-xs">{s.days !== null ? `${s.days}일째` : "—"}</span>
                )}
                <WindowLink href={`/consultations/new?studentId=${s.id}`} title="새 상담" className="text-primary text-xs font-medium hover:underline">
                  상담 기록 +
                </WindowLink>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground py-2 text-center text-sm">최근 30일 안에 모든 {who}을 상담했습니다</p>
      )}
    </div>
  );
}

function GapCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-bg-soft rounded-lg px-1 py-1.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="num text-foreground text-base font-bold">{fmt(value)}</dd>
    </div>
  );
}
