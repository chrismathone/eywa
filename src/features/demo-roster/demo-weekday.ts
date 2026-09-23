import { sql } from "drizzle-orm";
import type { WeekdayGrouping } from "@/features/owner/settings-types";

type SqlTx = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * 그 구성의 수업 요일을 기본뷰가 한 칸으로 묶는 프리셋.
 * 동네형·타겟학교·반 나눔 = 월·수 / 화·목. 동시수강 = 월·화 / 수·목.
 */
export function demoWeekdayGrouping(scenarioId: string): WeekdayGrouping {
  return scenarioId === "dual" ? "mon-tue-seq" : "mon-wed-fri";
}

/**
 * 수학·영어의 요일 병합만 바꾼다. 과목 배열이 없으면 일반판 네 과목을 만들고,
 * 있으면 그 두 과목의 칸만 고친다. operations 객체가 이미 있을 때만 호출한다.
 */
export async function writeDemoWeekdayGrouping(tx: SqlTx, tenantId: string, scenarioId: string) {
  const grouping = demoWeekdayGrouping(scenarioId);
  await tx.execute(sql`
    update tenant_settings
    set data = jsonb_set(
      coalesce(data, '{}'::jsonb),
      '{operations,subjects}',
      (
        select jsonb_agg(
          case
            when elem->>'key' in ('math', 'english')
              then jsonb_set(elem, '{weekdayGrouping}', to_jsonb(${grouping}::text), true)
            else elem
          end
          order by ord
        )
        from jsonb_array_elements(
          case
            when jsonb_typeof(data #> '{operations,subjects}') = 'array'
             and jsonb_array_length(data #> '{operations,subjects}') > 0
            then data #> '{operations,subjects}'
            else jsonb_build_array(
              jsonb_build_object('key', 'math', 'label', '수학', 'color', 'blue', 'weekdayGrouping', ${grouping}::text, 'testMax', 5),
              jsonb_build_object('key', 'english', 'label', '영어', 'color', 'rose', 'weekdayGrouping', ${grouping}::text, 'testMax', 5),
              jsonb_build_object('key', 'korean', 'label', '국어', 'color', 'gold', 'weekdayGrouping', 'mon-thu', 'testMax', 5),
              jsonb_build_object('key', 'science', 'label', '과학', 'color', 'purple', 'weekdayGrouping', 'mon-thu', 'testMax', 5)
            )
          end
        ) with ordinality as listed(elem, ord)
      ),
      true
    )
    where tenant_id = ${tenantId}
  `);
}
