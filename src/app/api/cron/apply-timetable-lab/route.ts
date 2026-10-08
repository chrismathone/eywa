import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { bearerMatches } from '@/lib/http/secret-compare';
import { openMasterDb } from '@/features/timetable/server/master-sheet-store';
import { runApplyJob } from '@/features/timetable-lab/server/apply-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || !bearerMatches(request.headers.get('authorization') ?? '', process.env.CRON_SECRET)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sql = openMasterDb();
  let jobs: { id: string }[];
  try { jobs = await sql<{ id: string }[]>`select id from timetable_lab_apply_jobs where status='pending' and apply_at<=now() order by apply_at,id limit 50`; }
  finally { await sql.end({ timeout: 5 }); }
  let applied = 0, failed = 0, skipped = 0;
  const deadline = Date.now() + 45000;
  for (const job of jobs) {
    if (Date.now() > deadline) break;
    try { if (await runApplyJob(job.id)) applied++; else skipped++; }
    catch { failed++; }
  }
  if (applied) {
    revalidatePath('/timetable'); revalidatePath('/classes'); revalidatePath('/students', 'layout'); revalidatePath('/ecs'); revalidatePath('/attendance');
  }
  return NextResponse.json({ applied, failed, skipped });
}
