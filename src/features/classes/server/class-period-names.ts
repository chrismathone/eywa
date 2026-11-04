import "server-only";
import postgres from "postgres";
import { nextClosedClassName } from "../closed-name";
import { applyClassTerms, prepareClassTerms } from "./class-term-store";

/** Cron only. Retryable even if the earlier enrollment RPC already completed on a prior attempt. */
export async function finishEndedClassNames() {
  if (!process.env.DATABASE_URL) throw new Error("반 관리 DB 연결을 확인해 주세요.");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
  try {
    return await sql.begin("isolation level serializable", async (tx) => {
      await tx`set local lock_timeout='5s'`;
      const candidates = await tx<{ tenant_id: string }[]>`
        select distinct c.tenant_id from classes c where c.is_active and not c.is_makeup_pool
          and (c.closed_at < (now() at time zone 'Asia/Seoul')::date
            or public.class_period_closed_end(c.id) is not null)`;
      let changed = 0;
      for (const { tenant_id: tenant } of candidates) {
        const classes = await tx<
          {
            id: string;
            class_name: string;
            subject: string;
            closed_at: string | null;
            is_active: boolean;
            is_makeup_pool: boolean;
            end_date: string | null;
          }[]
        >`select id,class_name,subject,closed_at::text,is_active,is_makeup_pool,
          case when closed_at < (now() at time zone 'Asia/Seoul')::date then closed_at
            when closed_at is null then public.class_period_closed_end(id) end::text as end_date
          from classes where tenant_id=${tenant} order by id for update`;
        const actor = { id: null, tenantId: tenant, displayName: "시스템(운영 기간 종료)" };
        for (const c of classes) {
          if (!c.is_active || c.is_makeup_pool || !c.end_date) continue;
          const name = nextClosedClassName(
            c.class_name,
            c.end_date,
            classes
              .filter((v) => v.subject === c.subject && v.id !== c.id)
              .map((v) => v.class_name),
          );
          if (c.closed_at) {
            // 종강일 뒤로 남은 배치도 닫는다 — 2026-11-02 전에 종강한 반에 남은 줄을 거두고, 종강일을 다른 길로
            // 넣은 반도 다음 밤에 맞춘다(시트 가져오기가 없는 반을 "제거"로 띄우던 원인).
            const terms = await prepareClassTerms(tx, tenant, [
              { classId: c.id, date: c.end_date, closeSchedules: true },
            ]);
            if (name === c.class_name && !terms[0]!.enrollments.length && !terms[0]!.schedules?.length) continue;
            await applyClassTerms(tx, actor, terms);
          } else {
            if (name === c.class_name) continue;
            const rows = await tx`update classes set class_name=${name} where tenant_id=${tenant}
              and id=${c.id} and class_name=${c.class_name} and is_active and closed_at is null returning id`;
            if (rows.length !== 1) throw new Error("운영 종료 반 정보가 변경되었습니다.");
            await tx`insert into audit_logs(tenant_id,actor_name,action,target_type,target_label,metadata)
              values(${tenant},${actor.displayName},'class_update','class',${name},
                ${tx.json({
                  classId: c.id,
                  fromName: c.class_name,
                  toName: name,
                  periodEnd: c.end_date,
                  note: "운영 기간 종료일을 반 이름에 표시",
                })})`;
          }
          c.class_name = name;
          changed++;
        }
      }
      return changed;
    });
  } finally {
    await sql.end();
  }
}
