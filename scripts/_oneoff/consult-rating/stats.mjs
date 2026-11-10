// 상담 평점 — 모집단 통계(읽기 전용 · 숫자만 출력).
import { closeReadOnly, openReadOnly } from "../ai-credit-mvp/lib/db-readonly.mjs";
const sql = await openReadOnly();
try {
  const t = await sql`select t.slug, count(*)::int n, min(c.consulted_at)::date::text first, max(c.consulted_at)::date::text last
    from student_consultations c join tenants t on t.id=c.tenant_id group by t.slug order by n desc`;
  console.log("지점별", JSON.stringify(t));
  const cols = await sql`select column_name from information_schema.columns where table_name='student_consultations' order by ordinal_position`;
  console.log("칸", cols.map((c) => c.column_name).join(","));
  const q = await sql`select
    count(*)::int n,
    count(*) filter (where coalesce(s.is_test,false))::int test,
    count(*) filter (where c.transcription is not null and length(c.transcription)>0)::int has_transcript,
    count(*) filter (where c.ai_report is not null)::int has_ai,
    count(*) filter (where c.audio_path is not null)::int has_audio,
    count(*) filter (where c.sync_added_at is not null)::int synced,
    count(*) filter (where c.makeedu_id is not null)::int makeedu,
    percentile_cont(array[0.1,0.25,0.5,0.75,0.9,0.99]) within group (order by length(c.summary)) summary_len,
    percentile_cont(array[0.5,0.9,0.99]) within group (order by length(c.transcription)) transcript_len
    from student_consultations c join students s on s.id=c.student_id join tenants t on t.id=c.tenant_id where t.slug='cs'`;
  console.log("침산", JSON.stringify(q[0]));
  console.log("카테고리", JSON.stringify(await sql`select coalesce(category,'(없음)') k, count(*)::int n from student_consultations c join tenants t on t.id=c.tenant_id where t.slug='cs' group by 1 order by 2 desc`));
  console.log("대상", JSON.stringify(await sql`select coalesce(audience,'(없음)') k, count(*)::int n from student_consultations c join tenants t on t.id=c.tenant_id where t.slug='cs' group by 1 order by 2 desc`));
  console.log("과목", JSON.stringify(await sql`select coalesce(subject,'(없음)') k, count(*)::int n from student_consultations c join tenants t on t.id=c.tenant_id where t.slug='cs' group by 1 order by 2 desc`));
  console.log("연도", JSON.stringify(await sql`select to_char(consulted_at,'YYYY-MM') k, count(*)::int n from student_consultations c join tenants t on t.id=c.tenant_id where t.slug='cs' group by 1 order by 1 desc limit 14`));
  console.log("후속", JSON.stringify(await sql`select (follow_up_action is not null and length(follow_up_action)>0) has_action, (follow_up_date is not null) has_date, count(*)::int n from student_consultations c join tenants t on t.id=c.tenant_id where t.slug='cs' group by 1,2`));
} finally { await closeReadOnly(sql); }
