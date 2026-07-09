import { History, LogIn } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { Pagination } from "@/components/pagination";
import {
  getStaffActivityLog,
  getStaffLoginEvents,
  getStaffRecentAccess,
  ACTIVITY_PAGE_SIZE,
} from "@/features/audit/server/activity-queries";
import type { AccessSession, LoginEventRow } from "@/features/audit/server/activity-queries";
import { activityDetail, activityOpLabel, deviceLabel, type ActivityOp } from "@/features/audit/activity";

const OP_COLOR: Record<ActivityOp, PillColor> = { INSERT: "primary", UPDATE: "blue", DELETE: "danger" };

const when = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });

/**
 * 최근 접속(순수 프레젠테이션 — 데이터는 부모가 Promise.all로 병렬 조회해 주입, B4 준수). 사무실만(RLS + 탭 게이트).
 * 세션마다 로그인 시각(started)·마지막 활동을 함께 보여줘 "장시간 연속 사용"과 "재접속"을 사무실이 판단 가능.
 * `auto`(로그인 없이 유지된 지속세션)는 "세션 유지"로 표기 — 재로그인 없이 접속 중임을 나타냄(적대리뷰 오분류 완화).
 */
function RecentAccess({ sessions, logins }: { sessions: AccessSession[]; logins: LoginEventRow[] }) {
  if (sessions.length === 0 && logins.length === 0) return null;
  return (
    <section className="bg-card border-line space-y-2 rounded-md border p-4">
      <p className="micro flex items-center gap-1.5">
        <LogIn className="text-text-dim size-3.5" /> 최근 접속
      </p>
      {sessions.length > 0 ? (
        <ul className="divide-line divide-y text-sm">
          {sessions.map((s) => (
            <li key={s.sessionId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
              <Pill color={s.auto ? "neutral" : "primary"}>{s.auto ? "세션 유지" : "최근 로그인"}</Pill>
              <span className="text-foreground">{deviceLabel(s.userAgent)}</span>
              {s.ip ? <span className="text-text-faint num text-xs">{s.ip}</span> : null}
              <span className="text-text-dim num ml-auto text-xs">
                로그인 {when(s.startedAt)} · 마지막 활동 {when(s.lastActive)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {logins.length > 0 ? (
        <div className="border-line border-t pt-2">
          <p className="text-text-faint mb-1 text-xs">로그인 기록(직접 로그인)</p>
          <ul className="text-text-dim space-y-0.5 text-xs">
            {logins.map((l) => (
              <li key={l.id} className="num flex flex-wrap gap-x-2">
                <span>{when(l.at)}</span>
                <span className="not-num">{deviceLabel(l.userAgent)}</span>
                {l.ip ? <span>{l.ip}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/**
 * 직원 상세 "활동 로그" 탭 — 이 직원이 시스템에서 한 변경(생성·수정·삭제)을 최신순으로.
 * activity_log(0081a DB 트리거)가 소스 — 사무실(master/admin/manager)만 열람(RLS + 페이지 게이트 이중).
 * 책임추적: "누가·언제·무엇을 어떻게 바꿨나"를 자동 기록(앱에서 빠뜨려도 누락 없음).
 */
export async function ActivityLogTab({ userId, page }: { userId: string; page: number }) {
  // 독립 3쿼리 병렬(B4) — activity_log(무거운 count) 완료를 기다리며 접속 조회가 지연되지 않게.
  const [{ rows, total }, sessions, logins] = await Promise.all([
    getStaffActivityLog(userId, page),
    getStaffRecentAccess(userId),
    getStaffLoginEvents(userId),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
  const hrefForPage = (p: number) =>
    p > 1 ? `/staff/${userId}?tab=activity&page=${p}` : `/staff/${userId}?tab=activity`;

  return (
    <div className="space-y-4">
      <RecentAccess sessions={sessions} logins={logins} />
      {total === 0 ? (
        <EmptyState
          image="audit"
          icon={() => <History size={32} strokeWidth={1.5} />}
          title="기록된 활동이 없습니다"
          description="이 직원이 학생·반·수납·지출·출결·공지 등 핵심 데이터를 생성·수정·삭제하면 여기에 자동으로 남습니다."
        />
      ) : (
        <section className="space-y-3">
          <p className="micro">
            활동 <span className="text-foreground font-bold">{total}</span>건
            <span className="text-text-faint ml-2 normal-case">· 핵심 데이터 변경을 자동 기록(책임추적)</span>
          </p>
          <ul className="bg-card border-line divide-line divide-y rounded-md border">
            {rows.map((r) => {
              const { head, changes } = activityDetail(r.table, r.op, r.targetLabel, r.changed);
              return (
                <li key={r.id} className="flex items-start gap-3 px-4 py-2.5">
                  <Pill color={OP_COLOR[r.op]}>{activityOpLabel(r.op)}</Pill>
                  <div className="min-w-0 flex-1">
                    {changes.length <= 1 ? (
                      // 변경 0~1건: 한 줄 인라인.
                      <p className="text-foreground text-sm break-keep">
                        {head}
                        {changes.length ? ` — ${changes[0]}` : ""}
                      </p>
                    ) : (
                      // 변경 여러 건: 머리말 + 항목별 줄바꿈 리스트.
                      <>
                        <p className="text-foreground text-sm font-medium break-keep">{head}</p>
                        <ul className="mt-1 space-y-0.5">
                          {changes.map((c, i) => (
                            <li key={i} className="text-text-dim flex gap-1.5 text-[13px] break-keep">
                              <span className="text-text-faint select-none">·</span>
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    <p className="text-text-faint num mt-1 text-xs">{when(r.createdAt)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <Pagination page={page} totalPages={totalPages} hrefForPage={hrefForPage} total={total} />
        </section>
      )}
    </div>
  );
}
