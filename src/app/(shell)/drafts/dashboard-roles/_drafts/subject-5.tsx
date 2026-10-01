/** 과목 관리자 시안 5 — 사람 중심 "강사 운영". 내 과목 강사의 맡은 반·작성률·보강 담당. 정산·시급·계약·연차 없음. */
import { HBars, Meter, Panel } from "../_components/parts";
import { subjectFake } from "../_data/fake";
import type { DraftProps } from "./types";

const TABLE =
  "w-full border-collapse text-sm [&_th]:bg-bg-soft [&_th]:px-3 [&_th]:py-2 [&_th]:font-bold [&_td]:px-3 [&_td]:py-2 [&_tbody_tr]:border-t [&_tr]:border-line [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint";

export function Subject5({ subject }: DraftProps) {
  const f = subjectFake(subject);
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Panel title="내 과목 강사" count={`${f.teachers.length}명`}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className="text-left">강사</th>
              <th className="text-center">맡은 반</th>
              <th className="text-center">보고서 작성률</th>
              <th className="text-center">보강 담당</th>
            </tr>
          </thead>
          <tbody>
            {f.teachers.map((t) => (
              <tr key={t.name}>
                <td className="font-bold">{t.name} 선생님</td>
                <td className="num text-center">{t.classes}개</td>
                <td>
                  <div className="flex justify-center">
                    <Meter value={t.reportRate} />
                  </div>
                </td>
                <td className="num text-center">{t.makeups}건</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="이번 주 보강 담당 분배" note="건수">
        <HBars items={f.teachers.map((t) => ({ label: `${t.name} 선생님`, value: t.makeups }))} barClass="bg-purple" format={(v) => `${v}건`} />
      </Panel>
    </div>
  );
}
