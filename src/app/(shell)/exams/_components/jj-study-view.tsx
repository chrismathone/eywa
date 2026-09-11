/**
 * 성적관리 › 영어 › **JJ실** — 학생별 기간 학습(인재원 설명서 8번)을 **eywa 반으로 묶어** 보여 준다. 서버 컴포넌트.
 *
 * 숫자는 매번 인재원에 묻는다(eywa엔 짝만 있다). 강사는 짝이 걸린 자기 학생(세 갈래 스코프)만 본다(queries.ts).
 * 🔑 반별(사용자 2026-09-11 *"학생별 반별 … 유기적으로"*): 반 줄 = 그 반 학생의 합계·평균, 학생 줄 = 학생 상세(같은
 *    기간)로, 반 이름 = 반 상세로, '이 반만' = 반 칩과 같은 주소로.
 * ⚠️ 강사는 인재원 반 이름(className)으로 좁혀 부르지 않는다 — 인재원 반은 eywa 반과 1:1이 아니라 학원 전체를 받아
 *    eywa 학생 id로 거른다. 묶는 반도 eywa 반이다(class-groups.ts).
 * ⚠️ 반 정보(eywa 수강)를 못 읽어도 표는 산다 — 묶지 않은 채 그 사실을 적는다.
 */
import { SearchX } from "@/components/icons/eywa-icon-compat";
import { EmptyState } from "@/components/empty-state";
import { groupRowsByClass, hasMultiClassStudent } from "@/features/ijw/class-groups";
import type { JjRange } from "@/features/ijw/range";
import { getJjClassOptions, getJjStudyList, loadJjMembership, type JjViewer } from "@/features/ijw/server/queries";
import { JjClassFilter } from "./jj-class-filter";
import { JJ_SCOPE_FAILED, JjFailBanner, JjLinkColumnNotice, JjNote, JjPeriodLine, rangeNote } from "./jj-shared";
import { JjStudyTable } from "./jj-study-table";

export async function JjStudyView({
  viewer,
  range,
  classFilter,
  classHref,
}: {
  viewer: JjViewer;
  range: JjRange;
  /** 주소의 `jjClass`(eywa 반 id). 선택지에 없으면 무시하고 그 사실을 적는다. */
  classFilter: string | null;
  classHref: (classId: string | null) => string;
}) {
  // 스코프를 못 구했으면 좁게 떨어진 상태 — 빈 표 대신 그 사실을 말한다(인재원도 부르지 않는다).
  if (viewer.scopeFailed) return <JjFailBanner message={JJ_SCOPE_FAILED} />;
  const [res, member, options] = await Promise.all([
    getJjStudyList(viewer, range.from, range.to),
    loadJjMembership(viewer.tenantId),
    getJjClassOptions(viewer),
  ]);
  if (!res.ok) return <JjFailBanner message={res.message} detail={res.detail} />;
  if (res.scopeNotReady) return <JjLinkColumnNotice teacher />;
  const membership = member.ok ? member.membership : null;
  const filter = classFilter && options?.some((c) => c.id === classFilter) ? classFilter : null;
  const groups = membership
    ? groupRowsByClass(res.rows, membership, {
        classFilter: filter,
        includeUnlinked: !viewer.teacherStudentIds,
        nameOf: (r) => r.eywa?.name ?? (r.name || r.ijwId),
      })
    : null;
  const shown = groups ? new Set(groups.flatMap((g) => g.rows.map((r) => r.ijwId))).size : res.rows.length;
  const linked = res.rows.filter((r) => r.eywa).length;
  const filterName = filter ? options?.find((c) => c.id === filter)?.name : null;
  return (
    <div className="space-y-3">
      {res.columnMissing ? <JjLinkColumnNotice /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <JjPeriodLine
          from={res.from}
          to={res.to}
          basis="study"
          note={rangeNote(range, "기본: 최근 7일")}
          extra={filterName ? `반 ${filterName} · 학생 ${shown}명` : `학생 ${res.rows.length}명 · eywa 연결 ${linked}명`}
        />
        {options ? <JjClassFilter classes={options} value={filter} hrefFor={classHref} /> : null}
      </div>
      {!member.ok ? <JjNote title={member.detail}>반 정보를 불러오지 못해 반으로 묶지 않았습니다.</JjNote> : null}
      {/* 원인을 가른다 — 목록을 못 읽은 것과 '고른 반이 선택지에 없는 것'은 다른 사실이다(적대 리뷰 2026-09-11). */}
      {classFilter && !filter && options ? (
        <JjNote>고른 반을 찾을 수 없어(담당 반이 아니거나 운영이 끝난 반) 전체를 보여 줍니다.</JjNote>
      ) : classFilter && !options && member.ok ? (
        <JjNote>반 목록을 불러오지 못해 전체를 보여 줍니다.</JjNote>
      ) : null}
      {groups && groups.length ? (
        <p className="text-text-faint text-xs">
          반 줄 = 그 반 학생의 합계·평균(정답률은 푼 문제 수로 가중)
          {viewer.teacherStudentIds ? " · 내 학생 기준(다른 선생님 학생은 세지 않습니다)" : ""}
          {hasMultiClassStudent(groups) ? " · 영어 반 두 곳을 함께 다니는 학생은 두 반 모두에 셉니다" : ""}
        </p>
      ) : null}
      {shown === 0 ? (
        <EmptyState
          image="exams"
          icon={() => <SearchX size={32} strokeWidth={1.8} />}
          title="보여 줄 학생이 없습니다"
          description={
            filter
              ? "이 반에서 인재원 학습 계정과 연결된 학생이 없습니다(연결은 관리자가 합니다)."
              : viewer.teacherStudentIds
                ? "담당 학생 중 인재원 학습 계정과 연결된 학생이 없습니다(연결은 관리자가 합니다)."
                : "인재원에 영어 학생이 아직 없습니다."
          }
        />
      ) : (
        <JjStudyTable
          groups={groups}
          rows={res.rows}
          from={res.from}
          to={res.to}
          classHref={filter ? null : classHref}
          allowedClassIds={options ? new Set(options.map((c) => c.id)) : null}
        />
      )}
    </div>
  );
}
