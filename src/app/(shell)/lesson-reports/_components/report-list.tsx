"use client";

// 원장 보고서 관리 > 보고서 목록/필터(5단계-2 Part C) — 강사·기간·상태·과목 필터 + 열람(/r·/print)
// + 관리자 최초 발송(미발송 native만 선택 가능 — 이미 발송·이관분은 서버·UI 이중 차단, 2026-07-10).
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { classnoteBadge } from "@/features/onescreen/components/report-card";
import { RecallButton } from "@/features/report-admin/components/recall-button";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { listReports, sendClassnoteForUnsent, setReportCoversDate } from "@/features/report-admin/server/actions";
import {
  isAdminSendable,
  type ReportListFilters,
  type ReportListRow,
  defaultReportFilters,
  type ReportSortKey,
} from "@/features/report-admin/report-filters";
import { MENT_SOURCE_LABEL, MENT_SOURCE_SHORT, parseMentSource } from "@/features/onescreen/ment-source";
import { monthLabel, monthOf, monthRange, shiftMonth } from "@/lib/date-kst";
import { EyIcon } from "@/components/icons/eywa-icons";
import { SortableTh } from "@/components/table/sortable-th";
import type { SortState } from "@/lib/table/sort";
import type { ReportFilterOptions } from "@/features/report-admin/server/queries";
import { ReportViewSettings } from "./report-view-settings";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";

// 시:분(KST). timestamptz → Asia/Seoul HH:mm. 값 없으면 빈 문자열.
function hhmmKst(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** 발송 상태 표시 — eywa 발송이력(classnote_status) 우선, 없으면 이관(edutrix)/미발송 구분. */
/** 읽음 툴팁용 KST 일시("7월 18일 13:01"). */
function readAtLabel(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function StatusCell({ status, source, readAt }: { status: string | null; source: string | null; readAt: string | null }) {
  const badge = classnoteBadge(status ?? undefined);
  // 학부모 읽음(0122a) — **양성 배지만**: 없음 = "미읽음"이 아니라 "동기화 안 됨"일 수 있어 표시하지 않는다
  // (매칭 키 없는 행의 거짓 미확인 방지 — report-filters.ts readAt 주석 참조).
  const read = readAt ? (
    <span className="text-primary ml-1.5 text-xs font-bold" title={`학부모 읽음 · ${readAtLabel(readAt)}`}>
      읽음
    </span>
  ) : null;
  if (badge)
    return (
      <>
        <span className={`text-xs font-bold ${badge.cls}`}>{badge.label}</span>
        {read}
      </>
    );
  // 발송 이력 없음: 이관분(edutrix)은 "이관"(발송 아님, 오해 방지), 그 외는 진짜 "미발송".
  if (source === "edutrix_import")
    return (
      <>
        <span className="text-text-faint text-xs" title="edutrix에서 이관된 기록(eywa 발송 아님)">이관</span>
        {read}
      </>
    );
  return <span className="text-amber text-xs">미발송</span>;
}

/** 멘트 작성 방식(0214a) 셀 — 직접(강조)/자동+수정/자동. 도입 전 행(null)은 "—"(라벨을 지어내지 않는다). */
function MentSourceCell({ value }: { value: string | null | undefined }) {
  const ms = parseMentSource(value);
  if (!ms) return <span className="text-text-faint">—</span>;
  const cls =
    ms === "manual" ? "text-primary font-bold" : ms === "auto_edited" ? "text-text-dim" : "text-text-faint";
  return (
    <span className={`text-xs ${cls}`} title={MENT_SOURCE_LABEL[ms]}>
      {MENT_SOURCE_SHORT[ms]}
    </span>
  );
}

type Result = { rows: ReportListRow[]; total: number; page: number; pageSize: number };

export function ReportList({
  options,
  initial,
  canSend,
  todayYmd,
}: {
  options: ReportFilterOptions;
  initial: Result;
  canSend: boolean; // lesson_reports 쓰기 권한(관리자 발송 열 노출 여부) — 서버 액션이 최종 게이트
  todayYmd: string; // KST 오늘 — 서버가 넘긴다(클라에서 new Date()로 구하면 첫 렌더가 서버와 어긋난다)
}) {
  const router = useRouter();
  const subjects = useSubjectMaps(); // 과목 표시는 한글 라벨(raw 키 노출 금지)
  const [filters, setFilters] = useState<ReportListFilters>(() => defaultReportFilters(todayYmd));
  const [result, setResult] = useState<Result>(initial);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();

  function run(next: ReportListFilters) {
    setFilters(next);
    setChecked(new Set()); // 페이지·필터 전환 시 선택 초기화 — 화면 밖 행 발송 방지
    start(async () => {
      const res = await listReports(next);
      if (res.ok) setResult({ rows: res.rows ?? [], total: res.total ?? 0, page: res.page ?? 0, pageSize: res.pageSize ?? 30 });
      else toast.error(res.error ?? "목록을 불러오지 못했습니다");
    });
  }
  const set = (patch: Partial<ReportListFilters>) => run({ ...filters, ...patch, page: 0 });

  // 이름 검색(학생·담임) — 입력은 즉시 반응하고 조회만 늦춘다. 글자마다 서버를 때리면 523건짜리
  // count 쿼리가 타이핑 수만큼 날아간다.
  // ⚠️ 타이머 콜백에 **두 값을 다 실어 보낸다** — `filters`를 클로저로 읽으면 학생 → 담임을 빠르게
  //    이어 칠 때 앞 입력이 아직 filters에 없어 조용히 지워진다.
  const [studentQ, setStudentQ] = useState(filters.student ?? "");
  const [teacherQ, setTeacherQ] = useState(filters.teacherName ?? "");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fireSearch = (s: string, t: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    set({ student: s.trim() || undefined, teacherName: t.trim() || undefined });
  };
  const onSearchChange = (s: string, t: string) => {
    setStudentQ(s);
    setTeacherQ(t);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fireSearch(s, t), 350);
  };
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  // 헤더 클릭 정렬 — **서버 정렬**이라 정렬을 바꾸면 1페이지부터 다시 받는다(현재 페이지만 뒤섞는 게 아니라
  // 전체가 다시 줄 선다). 상태는 화면 표(SortableTh)와 같은 3단 순환(오름 → 내림 → 해제) 규약을 그대로 쓴다.
  const sortState: SortState<ReportSortKey> = filters.sort ? { key: filters.sort, dir: filters.dir ?? "asc" } : null;
  const onSort = (next: SortState<ReportSortKey>) =>
    set({ sort: next?.key, dir: next?.dir });

  // 기간 표시 — from/to가 정확히 어느 한 달의 처음~끝이면 "그 달"로 본다(사용자가 날짜를 직접 만지면
  // 자동으로 '전체 기간' 취급이 아니라 커스텀 범위 그대로 유지되며, 월 라벨만 안 붙는다).
  const activeMonth = filters.from ? monthOf(filters.from) : monthOf(todayYmd);
  const isMonthRange =
    !!filters.from && !!filters.to && filters.from === monthRange(activeMonth).from && filters.to === monthRange(activeMonth).to;
  // ⚠️ "전체 기간"은 from/to가 **둘 다 없을 때만**이다. 사용자가 날짜를 직접 좁힌 커스텀 범위를
  // '전체 기간'이라 말하고 칩까지 켜면, 필터가 걸린 화면을 전 기간으로 오독한다(적대 검증 확정 5건).
  const isAllTime = !filters.from && !filters.to;
  const setMonthRange = (month: string) => set(monthRange(month));

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const openReport = (r: ReportListRow) => {
    const url = r.shareToken ? `${origin}/r/${r.shareToken}` : `${origin}/lesson_reports/${r.id}/print`;
    window.open(url, "_blank", "noopener");
  };

  const { rows, total, page, pageSize } = result;
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const sendable = rows.filter(isAdminSendable);
  const allChecked = sendable.length > 0 && sendable.every((r) => checked.has(r.id));
  // 멘트 작성 방식 열(0214a) — 마이그레이션 전엔 전 행 "—"뿐이라 열 자체를 숨긴다(뷰 설정 필터와 같은 게이트).
  const showMent = options.mentSourceReady ?? false;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function doSend() {
    const ids = [...checked];
    if (ids.length === 0) return;
    setBusy(true);
    const res = await sendClassnoteForUnsent(ids);
    setBusy(false);
    if (res.ok && res.dryRun) {
      toast.message("dry-run — 승인 전이라 실제 발송 안 함. 원장 설정(보고서)에서 'ClassNote 실제 발송'을 켜야 전송됩니다");
      setChecked(new Set());
    } else if (res.ok) {
      const parts = [`${res.queued ?? 0}건 발송 대기`];
      if (res.conflicts) parts.push(`${res.conflicts}건 동명이인 차단`);
      if (res.absentSkipped) parts.push(`${res.absentSkipped}건 결석 제외`);
      // 멘트가 비면 워커가 어차피 거절한다 — 큐에 올려 '실패'로 만들지 않고 사유를 여기서 밝힌다.
      if (res.emptyMent) parts.push(`${res.emptyMent}건 멘트 미작성 제외(강사가 작성 후 발송)`);
      if (res.skipped) parts.push(`${res.skipped}건 제외(이미 발송·과목 미허용·오래된 보고서)`);
      toast.success(parts.join(" · "));
      setChecked(new Set());
      run({ ...filters }); // 목록 상태 갱신
      router.refresh(); // 상단 발송 큐 카드(서버 렌더) 갱신
    } else toast.error(res.error ?? "발송 요청에 실패했습니다");
  }

  return (
    <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
      {/* 상단 **1줄** — 제목 · 월 이동 · 뷰 설정 · 발송 · 건수.
          ⚠️ 예전엔 제목+부제 / 월이동 / 필터 7개 / 발송+안내로 **4줄**이 표를 아래로 밀어냈다
          (원장 제보 2026-07-24 "공간낭비"). 기간·강사·과목·상태·읽음은 전부 뷰 설정 팝오버로 옮기고,
          여기엔 **가장 자주 쓰는 월 이동만** 남긴다. 걸린 필터는 뷰 설정 트리거 배지로 항상 드러난다.
          ⚠️ 기본이 **이번 달**인 이유는 그대로다: 전체 기간이 기본이면 '강사'로 정렬했을 때 1페이지가
          두 달 전 기록으로만 채워져 정렬이 무의미해진다(실측). 월로 끊어야 "이 달 안에서 강사순"이 된다. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2
          className="text-foreground text-base font-bold"
          title="기간·강사·과목·상태·읽음·반으로 조회 — 오른쪽 '열람' 버튼으로 학부모 보고서를 엽니다"
        >
          보고서 목록
        </h2>
        <div className="border-line flex items-center gap-0.5 rounded-full border p-0.5">
          <button type="button" onClick={() => setMonthRange(shiftMonth(activeMonth, -1))} aria-label="이전 달" className="text-text-dim hover:bg-bg-soft rounded-full px-1.5 py-0.5">
            <EyIcon name="chevronLeft" size={14} />
          </button>
          <span className="text-foreground min-w-[76px] text-center text-xs font-bold">
            {isMonthRange ? monthLabel(activeMonth) : isAllTime ? "전체 기간" : "직접 지정"}
          </span>
          <button type="button" onClick={() => setMonthRange(shiftMonth(activeMonth, 1))} aria-label="다음 달" className="text-text-dim hover:bg-bg-soft rounded-full px-1.5 py-0.5">
            <EyIcon name="chevronRight" size={14} />
          </button>
        </div>
        {/* 이름 검색 — 목록에서 가장 잦은 진입이 "그 학생 건 찾기"·"그 선생님 건 찾기"라 **팝오버 밖**에 둔다
            (뷰 설정 안에 넣으면 걸린 줄 모르고 "왜 3건뿐이지"가 된다 — 그래서 배지에도 안 센다: 여기 글자가
            그대로 보이는 게 곧 표시다). 서버 필터라 페이지 전체(총 N건) 기준으로 걸린다 — 현재 페이지만
            걸러 "없다"고 말하는 화면이 되지 않게. */}
        <input
          type="search"
          value={studentQ}
          onChange={(e) => onSearchChange(e.target.value, teacherQ)}
          onKeyDown={(e) => {
            if (e.key === "Enter") fireSearch(studentQ, teacherQ);
          }}
          placeholder="학생 이름"
          aria-label="학생 이름 검색"
          className="border-line focus:border-primary w-[104px] rounded-lg border px-2 py-1 text-xs outline-none"
        />
        <input
          type="search"
          value={teacherQ}
          onChange={(e) => onSearchChange(studentQ, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") fireSearch(studentQ, teacherQ);
          }}
          placeholder="담임 이름"
          aria-label="담임 이름 검색"
          className="border-line focus:border-primary w-[104px] rounded-lg border px-2 py-1 text-xs outline-none"
        />
        <ReportViewSettings options={options} filters={filters} todayYmd={todayYmd} onApply={run} />
        {/* 관리자 발송 — 미발송(native)만 대상. 이미 발송된 건은 선택 자체가 안 되고 서버도 거부(중복발송 차단).
            안내 문구는 비활성 체크박스의 title이 이미 같은 말을 하므로 줄을 따로 쓰지 않는다(공간 절약). */}
        {canSend ? (
          <Button
            size="sm"
            disabled={busy || pending || checked.size === 0}
            onClick={doSend}
            title="미발송 보고서만 선택할 수 있습니다 · 발송된 건의 재발송은 위 발송 큐 카드에서"
          >
            선택 발송 {checked.size > 0 ? `(${checked.size})` : ""}
          </Button>
        ) : null}
        <span className="text-text-faint ml-auto text-xs">{pending ? "불러오는 중…" : `총 ${total}건`}</span>
      </div>

      <DragScrollArea className="border-line rounded-md border">
        {/* 반 열이 늘어 최소폭 상향(600→680) — 좁은 창에서 열이 서로 뭉개지지 않게. 넘치면 가로 스크롤.
            멘트 열(0214a)이 켜지면 한 뼘 더(680→720). */}
        <table className={`w-full ${showMent ? "min-w-[720px]" : "min-w-[680px]"} text-left text-xs`}>
          <thead>
            <tr className="border-line text-text-faint group border-b">
              {canSend ? (
                <th className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    disabled={sendable.length === 0}
                    onChange={() => setChecked(allChecked ? new Set() : new Set(sendable.map((r) => r.id)))}
                    aria-label="현재 페이지 미발송 전체 선택"
                  />
                </th>
              ) : null}
              <SortableTh sortKey="date" state={sortState} onSort={onSort}>날짜</SortableTh>
              {/* 학생·과목은 서버 정렬 대상이 아니다 — 학생 이름은 이 표에 없는 값(조인), 과목은 저장값이
                  내부 키라 한글 라벨 순서와 어긋난다(report-filters.ts REPORT_SORT_KEYS 주석).
                  ⚠️ 반은 예외로 정렬된다 — 조인이지만 PostgREST가 to-one 임베드로 부모를 정렬해 주고,
                  반 이름은 저장값 자체가 한글 표시명이라 라벨 불일치가 없다. */}
              <th className="px-3 py-2 font-bold">학생 · 과목</th>
              <SortableTh sortKey="class" state={sortState} onSort={onSort}>반</SortableTh>
              <SortableTh sortKey="teacher" state={sortState} onSort={onSort}>강사</SortableTh>
              {/* 멘트 작성 방식(0214a) — 정렬 없음(값 3종 + 도입 전 "—"라 필터가 더 정확하다, 뷰 설정에서). */}
              {showMent ? <th className="px-3 py-2 font-bold" title="멘트를 누가 썼는가 — 직접 작성/자동작성(뷰 설정에서 필터)">멘트</th> : null}
              <SortableTh sortKey="status" state={sortState} onSort={onSort}>발송 상태</SortableTh>
              <SortableTh sortKey="read" state={sortState} onSort={onSort} align="right">열람</SortableTh>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={(canSend ? 7 : 6) + (showMent ? 1 : 0)} className="text-text-faint px-3 py-6 text-center">
                  조건에 맞는 보고서가 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-line hover:bg-bg-soft border-b last:border-b-0">
                  {canSend ? (
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={checked.has(r.id)}
                        onChange={() => toggle(r.id)}
                        disabled={!isAdminSendable(r)}
                        aria-label={`${r.studentName} 발송 선택`}
                        title={isAdminSendable(r) ? undefined : "미발송 보고서만 발송할 수 있습니다"}
                      />
                    </td>
                  ) : null}
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">
                    {r.reportDate}
                    {/* 실제 수업일이 따로 지정된 건(선발송·연속수업) — 그 날짜가 작성률 분모에서 면제된다. */}
                    {r.coversDate ? (
                      <span
                        className="bg-bg-soft text-text-dim ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-bold"
                        title={coversTitle(r)}
                      >
                        수업 {r.coversDate.slice(5)}
                      </span>
                    ) : null}
                    {/* 발송분은 실제 발송 시각(classnote_sent_at), 미발송분은 작성/등록 시각 폴백 */}
                    {r.sentAt || r.createdAt ? (
                      <span
                        className="text-text-faint ml-1.5"
                        title={r.sentAt ? "학부모 발송 시각" : "작성·등록 시각(발송 전)"}
                      >
                        {hhmmKst(r.sentAt ?? r.createdAt)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-foreground font-bold">{r.studentName}</span>
                    {r.subject ? <span className="text-text-faint ml-1.5">{subjects.labelOf(r.subject)}</span> : null}
                  </td>
                  {/* 반(0134a) — **내부 표시 전용**(학부모 화면엔 안 나온다). 이관분은 반 추정이 구조적으로
                      불가해 대부분 "—"다. 반 정렬 시 이 빈 값들이 뒤로 가고 반 있는 건이 위로 모인다. */}
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">{r.className ?? "—"}</td>
                  <td className="text-text-dim px-3 py-2">{r.teacherName ?? "—"}</td>
                  {showMent ? (
                    <td className="px-3 py-2 whitespace-nowrap">
                      <MentSourceCell value={r.mentSource} />
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <StatusCell status={r.classnoteStatus} source={r.source} readAt={r.readAt} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <CoversDateControl row={r} canEdit={canSend} onSaved={() => run(filters)} />
                      {/* 관리자 강제 회수(2026-08-05 원장 지시) — 위 필터로 **전체 보고서를 검색한 뒤**
                          그 자리에서 회수한다. 게시 완료건에만 뜨고(RecallButton 판정), 경고 + 이중확인은
                          강사 카드와 **같은 컴포넌트**를 써서 한쪽만 약해지지 않는다. */}
                      {canSend ? (
                        <RecallButton
                          reportId={r.id}
                          studentName={r.studentName}
                          classnoteStatus={r.classnoteStatus}
                          shareToken={r.shareToken}
                          readAt={r.readAt}
                          onDone={() => run(filters)}
                        />
                      ) : null}
                      <Button size="sm" variant="outline" onClick={() => openReport(r)}>
                        열람
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DragScrollArea>

      {maxPage > 0 ? (
        <div className="mt-3 flex items-center justify-center gap-2 text-xs">
          <Button size="sm" variant="ghost" disabled={page <= 0 || pending} onClick={() => run({ ...filters, page: page - 1 })}>
            이전
          </Button>
          <span className="text-text-dim">
            {page + 1} / {maxPage + 1}
          </span>
          <Button size="sm" variant="ghost" disabled={page >= maxPage || pending} onClick={() => run({ ...filters, page: page + 1 })}>
            다음
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** 지정 사유 프리셋 — 원장이 정의한 두 경우(0139a 감사 기록). */
const COVERS_REASONS = ["선발송(미리 수업)", "연속수업(몰아서)"] as const;

/** 배지 툴팁 — 면제 근거를 화면에서 바로 읽히게(누가·언제·왜). */
function coversTitle(r: ReportListRow): string {
  const who = r.coversBy ? ` · ${r.coversBy}` : "";
  const when = r.coversAt ? ` ${hhmmKst(r.coversAt)}` : "";
  const why = r.coversNote ? ` · ${r.coversNote}` : "";
  return `실제 수업일 ${r.coversDate} · 그날 작성률 대상에서 제외${why}${who}${when} 지정(내부 표시)`;
}

/**
 * 실제 수업일(covers_date) 지정 — 미리 하거나 앞 수업에 몰아서 한 수업분(0136a).
 *
 * 왜 필요한가(원장 2026-07-22): 시험대비처럼 수업을 미리 하거나(선발송), 7/19분을 7/3에
 * 2타임으로 몰아서 하면(연속수업) 원래 수업일에 보고서가 없어 **강사가 미작성으로 찍힌다**.
 * 날짜를 지정하면 그 (학생, 날짜)가 작성률 대상에서 면제된다 — 집계를 옮기는 게 아니다.
 * ⚠️ 내부 메타데이터 — 학부모에게는 보이지 않는다.
 */
function CoversDateControl({
  row,
  canEdit,
  onSaved,
}: {
  row: ReportListRow;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(row.coversDate ?? "");
  const [note, setNote] = useState(row.coversNote ?? COVERS_REASONS[0]);
  const [saving, setSaving] = useState(false);
  if (!canEdit) return null;

  async function save(next: string | null) {
    setSaving(true);
    const res = await setReportCoversDate(row.id, next, next ? note : null);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? "저장하지 못했습니다");
      return;
    }
    toast.success(next ? `실제 수업일 ${next}로 지정했습니다` : "실제 수업일 지정을 해제했습니다");
    setOpen(false);
    onSaved();
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setValue(row.coversDate ?? "");
          setNote(row.coversNote ?? COVERS_REASONS[0]!);
          setOpen(true);
        }}
        title="미리 했거나 앞 수업에 몰아서 한 수업이면 실제 수업일을 지정하세요(내부 표시)"
      >
        수업일
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="border-line rounded-lg border px-1.5 py-1 text-xs"
        aria-label="실제 수업일"
      />
      {/* 사유 — 나중에 "왜 이 날이 빠졌나"를 알 수 있어야 감사가 의미 있다(원장이 정의한 두 경우). */}
      <select
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="border-line rounded-lg border px-1.5 py-1 text-xs"
        aria-label="지정 사유"
      >
        {COVERS_REASONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <Button size="sm" variant="outline" disabled={saving || !value} onClick={() => save(value)}>
        저장
      </Button>
      {row.coversDate ? (
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => save(null)}>
          해제
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>
        취소
      </Button>
    </span>
  );
}
