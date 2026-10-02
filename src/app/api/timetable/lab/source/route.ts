import { getCurrentUser } from '@/lib/auth/current-user';
import { canManageTenant } from '@/lib/auth/perm-matrix';
import { readLabSource } from '@/features/timetable-lab/server/source';
import { kstToday } from '@/lib/date-kst';
import { thisMonday } from '@/features/timetable/lib/week';
import { logDbError } from '@/lib/supabase/db-error';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: '로그인 후 기존 시간표를 불러올 수 있습니다.' }, { status: 401, headers });
  const grants = await Promise.all([canManageTenant(user.systemRole, 'timetable'), canManageTenant(user.systemRole, 'classes')]);
  if (grants.some(allowed => !allowed)) return Response.json({ error: '시간표와 반을 관리할 수 있는 계정으로 불러와 주세요.' }, { status: 403, headers });
  const date = new URL(request.url).searchParams.get('date') || kstToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    return Response.json({ error: '불러올 기준일을 확인해 주세요.' }, { status: 400, headers });
  }
  try {
    return Response.json(await readLabSource(user.tenantId, thisMonday(date), user.id), { headers });
  } catch (error) {
    logDbError(error, 'timetable-lab-source');
    return Response.json({ error: '시간표를 모두 읽지 못했습니다. 잠시 후 다시 불러와 주세요. 현재 연습안은 유지됩니다.' }, { status: 503, headers });
  }
}
