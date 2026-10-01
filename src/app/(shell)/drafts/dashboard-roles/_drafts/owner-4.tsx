"use client";

/** 원장 시안 4 — 사람 중심 "사람 · 정산". 강사별 시수·정산 예정·작성률·연차 — 가장 민감한 화면. */
import { BigStat } from "@/components/atoms/big-stat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { Meter, Panel, SubjectBadge } from "../_components/parts";
import { ACADEMY, STAFF, manwon, seedOf } from "../_data/fake";

const TABLE =
  "w-full border-collapse text-sm [&_th]:bg-bg-soft [&_th]:px-3 [&_th]:py-2 [&_th]:font-bold [&_td]:px-3 [&_td]:py-2 [&_tbody_tr]:border-t [&_tr]:border-line [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint";

export function Owner4() {
  const maps = useSubjectMaps();
  const keys = maps.options.map((o) => o.value);
  const rows = STAFF.map((name, i) => {
    const s = seedOf(name);
    return {
      name,
      subject: keys.length ? keys[i % keys.length]! : "",
      classes: 2 + (s % 4),
      hours: 40 + (s % 50),
      payout: 180 + (s % 260),
      rate: 68 + (s % 31),
      leave: 3 + (s % 9),
    };
  });
  const payoutSum = rows.reduce((a, r) => a + r.payout, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BigStat label="이번 달 정산 예정" value={manwon(payoutSum)} unit="원" tone="purple" icon={<EyIcon name="banknote" size={16} />} sub={`강사 ${rows.length}명`} />
        <BigStat label="실청구 대비" value={Math.round((payoutSum / ACADEMY.money.billed) * 100)} unit="%" tone="neutral" sub="인건비 비율" />
        <BigStat label="보고서 작성률" value={Math.round(rows.reduce((a, r) => a + r.rate, 0) / rows.length)} unit="%" tone="green" sub="이번 달 평균" />
        <BigStat label="연차 사용 예정" value={3} unit="건" tone="amber" sub="이번 주" />
      </div>
      <Panel title="강사별" count={`${rows.length}명`} note="정산 = 급여명세서와 같은 계산">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className="text-left">강사</th>
              <th className="text-center">과목</th>
              <th className="text-center">맡은 반</th>
              <th className="text-center">이번 달 시수</th>
              <th className="text-right">정산 예정</th>
              <th className="text-center">보고서 작성률</th>
              <th className="text-center">연차 남음</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="font-bold">{r.name} 선생님</td>
                <td className="text-center">{r.subject ? <SubjectBadge subject={r.subject} /> : "—"}</td>
                <td className="num text-center">{r.classes}</td>
                <td className="num text-center">{r.hours}시간</td>
                <td className="num text-right font-bold">{manwon(r.payout)}원</td>
                <td>
                  <div className="flex justify-center">
                    <Meter value={r.rate} />
                  </div>
                </td>
                <td className="num text-center">{r.leave}일</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
