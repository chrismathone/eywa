/** 원장 시안 1 — 숫자 중심 "경영 계기판". 지표 8칸 + 돈 4칸 + 추이·퇴원 사유. */
import { BigStat } from "@/components/atoms/big-stat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Columns, HBars, Panel } from "../_components/parts";
import { ACADEMY, manwon } from "../_data/fake";

export function Owner1() {
  const m = ACADEMY.money;
  const rate = Math.round((m.paid / m.billed) * 100);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ACADEMY.kpi.map((k) => (
          <BigStat key={k.label} label={k.label} value={k.value} unit={k.unit} sub={k.sub} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BigStat
          label="이번 달 실청구"
          value={manwon(m.billed)}
          unit="원"
          tone="primary"
          icon={<EyIcon name="invoice" size={16} />}
          sub="청구 − 할인"
        />
        <BigStat
          label="수납"
          value={manwon(m.paid)}
          unit="원"
          tone="green"
          icon={<EyIcon name="wallet" size={16} />}
          sub={`수납률 ${rate}%`}
        />
        <BigStat
          label="미수"
          value={manwon(m.unpaid)}
          unit="원"
          tone="danger"
          valueClass="text-danger"
          icon={<EyIcon name="alertCircle" size={16} />}
          sub={`${m.unpaidCount}건`}
        />
        <BigStat
          label="강사 정산 예정"
          value={manwon(m.payout)}
          unit="원"
          tone="purple"
          icon={<EyIcon name="banknote" size={16} />}
          sub={`실청구 대비 ${Math.round((m.payout / m.billed) * 100)}%`}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="6개월 실청구" note="단위 만원" className="lg:col-span-2">
          <Columns labels={ACADEMY.months} values={ACADEMY.billedTrend} />
        </Panel>
        <Panel title="이번 달 퇴원 사유" count={`${ACADEMY.kpi[1].value}명`}>
          <HBars
            items={ACADEMY.withdrawReasons.map((r) => ({ label: r.label, value: r.n }))}
            barClass="bg-neutral-fill"
            format={(v) => `${v}명`}
          />
          <ul className="mt-3 flex flex-col gap-1 text-xs">
            {ACADEMY.withdrawReasons.map((r) => (
              <li key={r.label} className="truncate">
                <span className="font-bold">{r.label}</span> · {r.detail}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title="등록 · 퇴원 6개월" note="단위 명">
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-bold">등록</p>
            <Columns labels={ACADEMY.months} values={ACADEMY.joinTrend} barClass="bg-green" height="h-20" />
          </div>
          <div>
            <p className="mb-2 text-xs font-bold">퇴원</p>
            <Columns labels={ACADEMY.months} values={ACADEMY.leaveTrend} barClass="bg-danger" height="h-20" />
          </div>
        </div>
      </Panel>
    </div>
  );
}
