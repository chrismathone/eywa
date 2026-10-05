/** Read only the owned synthetic browser DB; never load environment files. */
import postgres from "postgres";
const db = postgres({ host: "127.0.0.1", port: 55444, database: "makeup_browser",
  username: "makeup_test", password: "makeup_local_only", max: 1, onnotice: () => {}, connect_timeout: 5 });
try {
  console.log(JSON.stringify({
    cases: await db`select id,eligibility,target_minutes,outstanding_minutes,committed_minutes from makeup_cases order by created_at desc limit 5`,
    activity: await db`select pid,state,wait_event_type,wait_event,left(query,100) as query from pg_stat_activity where datname='makeup_browser'`,
  }, null, 2));
} finally { await db.end({ timeout: 5 }); }
