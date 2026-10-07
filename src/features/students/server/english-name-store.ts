import "server-only";
import postgres from "postgres";

/** Only call after the action has checked tenant, permission and student scope. */
export async function saveEnglishName(input: {
  tenantId: string; studentId: string; englishName: string | null; previousEnglishName: string | null;
}): Promise<"saved" | "duplicate" | "conflict"> {
  if (!process.env.DATABASE_URL) throw new Error("Database connection unavailable");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
  try {
    return await sql.begin("isolation level read committed", async (tx) => {
      await tx`set local lock_timeout='5s'`;
      await tx`set local statement_timeout='10s'`;
      // Transaction lock works across app instances and releases on commit/rollback.
      await tx`select pg_advisory_xact_lock(hashtextextended(${'student-english-name:' + input.tenantId}, 0))`;
      if (input.englishName !== null) {
        const duplicates = await tx`
          select id from public.students
          where tenant_id=${input.tenantId} and id<>${input.studentId}
            and lower(btrim(english_name, E' \\t\\n\\r'))=lower(${input.englishName})
          limit 1`;
        if (duplicates.length) return "duplicate" as const;
      }
      const rows = await tx`
        update public.students set english_name=${input.englishName}
        where tenant_id=${input.tenantId} and id=${input.studentId}
          and english_name is not distinct from ${input.previousEnglishName}::text
        returning id`;
      return rows.length === 1 ? "saved" as const : "conflict" as const;
    });
  } finally {
    await sql.end();
  }
}
