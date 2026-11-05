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
import { Pill } from "@/components/atoms/pill";
import { listReports, retryClassnote, sendClassnoteForUnsent } from "@/features/report-admin/server/actions";
import { classnoteRetryDeadline } from "@/features/onescreen/classnote-guard";
import {
  isAdminSendable,
  type ReportListFilters,
  type ReportListRow,
  defaultReportFilters,
  type ReportSortKey,
} from "@/features/report-admin/report-filters";
import { MENT_SOURCE_LABEL, MENT_SOURCE_SHORT, parseMentSource } from "@/features/onescreen/ment-source";
import { monthLabel, monthOf, monthRange, shiftMonth } from "@/lib/date-kst";
import { EyIcon } from "@/components/icons/aywa-icons";
import { SortableTh } from "@/components/table/sortable-th";
import type { SortState } from "@/lib/table/sort";
import type { ReportFilterOptions } from "@/features/report-admin/server/queries";
import { ReportViewSettings } from "./report-view-settings";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { RatingCell } from "./rating-cell";
import { REPORT_RATING_VISIBLE } from "@/features/report-admin/report-rating";
import { tipProps, type TipCard } from "@/components/hover-tip/tip";
import { useUnsentReasonCards } from "./use-unsent-reasons";

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

/** 발송 상태 표시 — aywa 발송이력(classnote_status) 우선, 없으면 이관(edutrix)/미발송 구분. */
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

function StatusCell({
  status,
  source,
  readAt,
  unsentTip,
}: {
  status: string | null;
  source: string | null;
  readAt: string | null;
  /** '미발송' 칸 카드 — 아직 안 나간 이유(원장 2026-11-04, unsent-reason.ts). 도착 전·실패면 없다. */
  unsentTip?: TipCard;
}) {
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
        <span className="text-text-faint text-xs" title="edutrix에서 이관된 기록(에이와 발송 아님)">이관</span>
        {read}
      </>
    );
  // 마우스를 올리면 아직 안 나간 이유 카드(`data-tip` — 같은 값에 title을 함께 달지 않는다). 카드가 있을 때만 점선 밑줄로 알린다.
  return (
    <span
      className={`text-amber text-xs ${unsentTip ? "cursor-help underline decoration-dotted underline-offset-2" : ""}`}
      {...tipProps(unsentTip)}
    >
      미발송
    </span>
  );
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

/**
 * 목록 줄에서 재발송을 권할 상태(N4, 2026-09-23 감사) — 재발송은 3일 창 발송 큐 카드에만 있어, 그 창을 지난
 * 실패 건은 목록에서 찾아도 다시 보낼 문이 없었다. 게이트는 서버 `retryClassnote`(기한·과목·빈 멘트·결석)가
 * 최종으로 다시 본다(#77) — 여기는 눌러 봐야 헛돌 줄(발송 완료·기한 지남)에 버튼을 세우지 않을 뿐이다.
 * 동명이인·공유 보드 보류는 사람이 원인을 고친 뒤 내보내는 것이라 확인을 한 번 더 받는다(큐 카드와 같은 판단).
 */
const RETRY_STATUSES = new Set(["failed", "name_conflict", "blocked_shared"]);

export function ReportList({
  options,
  initial,
  canSend,
  todayYmd,
  initialStatus,
  classnoteOn = true,
}: {
  options: ReportFilterOptions;
  initial: Result;
  canSend: boolean; // lesson_reports 쓰기 권한(관리자 발송 열 노출 여부) — 서버 액션이 최종 게이트
  todayYmd: string; // KST 오늘 — 서버가 넘긴다(클라에서 new Date()로 구하면 첫 렌더가 서버와 어긋난다)
  /** 주소로 받은 상태 필터(`?status=…`). 서버 첫 페인트와 **같은 값**을 초기 state에 넣는다. */
  initialStatus?: string;
  /** ClassNote 기능(모듈) 켜짐 — 꺼지면 선택 발송·재발송·발송 상태 열이 없다(2026-09-30 "꺼지면 흔적 없이"). */
  classnoteOn?: boolean;
}) {
  const router = useRouter();
  // 발송 열(체크박스·선택 발송·재발송)은 권한 **그리고** ClassNote 기능. 회수(RecallButton)는 발송과 무관 → canSend 그대로.
  const sendOn = canSend && classnoteOn;
  const subjects = useSubjectMaps(); // 과목 표시는 한글 라벨(raw 키 노출 금지)
  const [filters, setFilters] = useState<ReportListFilters>(() => defaultReportFilters(todayYmd, initialStatus));
  const [result, setResult] = useState<Result>(initial);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
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
  // '미발송' 칸 카드 — 이 페이지 미발송 줄만 목록이 그려진 뒤 따로 읽는다(첫 페인트를 막지 않는다). 발송 상태 열이 있을 때만.
  const unsentCards = useUnsentReasonCards(rows, classnoteOn);
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const sendable = rows.filter(isAdminSendable);
  const allChecked = sendable.length > 0 && sendable.every((r) => checked.has(r.id));
  // 멘트 작성 방식 열(0214a) — 마이그레이션 전엔 전 행 "—"뿐이라 열 자체를 숨긴다(뷰 설정 필터와 같은 게이트).
  const showMent = options.mentSourceReady ?? false;
  // 평점 열(참고용, 0450a) — 서버도 쓰기 권한자에게만 평점을 싣는다(listReports). 화면은 같은 판정으로 열만 감춘다.
  // 표시 스위치가 꺼져 있으면 열 자체가 없다(2026-10-26 원장 — 새 기준 검증 전까지).
  const showRating = REPORT_RATING_VISIBLE && canSend;

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
      // 반별 발송인데 보낼 반이 안 정해진 행(원장 2026-09-30 — 담당 반이 없으면 발송 불가) — 원스크린·직접 작성에서 반을 골라 보낸다.
      if (res.noClass) parts.push(`${res.noClass}건 보낼 반 미지정 제외(원스크린·직접 작성에서 반을 골라 발송)`);
      // 보강 진행 여부 확인 전(원장 2026-10-27) — 원스크린에서 보강 표식을 눌러 했음/못 했음을 고른 뒤 보낸다.
      if (res.makeupUnchecked) parts.push(`${res.makeupUnchecked}건 보강 진행 여부 확인 전 제외(원스크린 보강 표식에서 확인 후 발송)`);
      if (res.skipped) parts.push(`${res.skipped}건 제외(이미 발송·과목 미허용·오래된 보고서)`);
      toast.success(parts.join(" · "));
      setChecked(new Set());
      run({ ...filters }); // 목록 상태 갱신
      router.refresh(); // 상단 발송 큐 카드(서버 렌더) 갱신
    } else toast.error(res.error ?? "발송 요청에 실패했습니다");
  }

  async function doRetryRow(r: ReportListRow) {
    const held = r.classnoteStatus === "name_conflict" || r.classnoteStatus === "blocked_shared";
    const msg = held
      ? `${r.studentName} 보고서는 ${r.classnoteStatus === "name_conflict" ? "동명이인" : "공유 보드"} 때문에 보류된 건입니다. 원인을 확인했다면 다시 보냅니다. 계속할까요?`
      : `${r.studentName} 보고서를 ClassNote로 다시 보냅니다. 계속할까요?`;
    if (!window.confirm(msg)) return;
    setRetryingId(r.id);
    const res = await retryClassnote([r.id]);
    setRetryingId(null);
    if (res.ok && res.dryRun) {
      toast.message("dry-run — 승인 전이라 실제 재발송 안 함. 원장 설정(보고서)에서 'ClassNote 실제 발송'을 켜야 전송됩니다");
    } else if (res.ok && (res.requeued ?? 0) > 0) {
      toast.success("재발송 대기에 올렸습니다 — 발송 PC가 순서대로 보냅니다");
      run({ ...filters });
      router.refresh();
    } else if (res.ok) {
      toast.message(
        res.absentSkipped
          ? "그날 결석으로 기록된 학생이라 다시 보내지 않았습니다"
          : res.noClass
            ? "보낼 반이 없어 다시 보내지 않았습니다 — 원스크린·직접 작성에서 반을 골라 보내세요"
            : "다시 보낼 수 없는 보고서입니다(멘트 미작성·과목 미허용·기한 지남)",
      );
    } else toast.error(res.error ?? "재발송에 실패했습니다");
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
        {sendOn ? (
          <Button
            size="sm"
            disabled={busy || pending || checked.size === 0}
            onClick={doSend}
            title="미발송 보고서만 선택할 수 있습니다 · 실패·보류된 건은 각 줄의 '재발송'으로 다시 보냅니다"
          >
            선택 발송 {checked.size > 0 ? `(${checked.size})` : ""}
          </Button>
        ) : null}
        <span className="text-text-faint ml-auto text-xs">{pending ? "불러오는 중…" : `총 ${total}건`}</span>
      </div>

      <DragScrollArea className="border-line rounded-md border">
        {/* 반 열이 늘어 최소폭 상향(600→680) — 좁은 창에서 열이 서로 뭉개지지 않게. 넘치면 가로 스크롤.
            과목 열(원장 2026-10-27 학생과 분리)이 +60, 멘트 열(0214a)·보고서 멘트 점수 열(0450a)이 켜지면 열마다 한 뼘씩 더(+40·+90). */}
        <table
          className={`w-full ${
            showMent && showRating ? "min-w-[870px]" : showMent ? "min-w-[780px]" : showRating ? "min-w-[830px]" : "min-w-[740px]"
          } text-left text-xs`}
        >
          <thead>
            <tr className="border-line text-text-faint group border-b">
              {sendOn ? (
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
              {/* 과목 = 맨 앞 열(원장 2026-10-27 *"학생과 과목을 분리. 과목을 가장 앞으로"*) — 원생 목록·수업과 같은 과목 칩. */}
              <th className="w-14 px-3 py-2 text-center font-bold">과목</th>
              <SortableTh sortKey="date" state={sortState} onSort={onSort}>날짜</SortableTh>
              {/* 학생·과목은 서버 정렬 대상이 아니다 — 학생 이름은 이 표에 없는 값(조인), 과목은 저장값이
                  내부 키라 한글 라벨 순서와 어긋난다(report-filters.ts REPORT_SORT_KEYS 주석).
                  ⚠️ 반은 예외로 정렬된다 — 조인이지만 PostgREST가 to-one 임베드로 부모를 정렬해 주고,
                  반 이름은 저장값 자체가 한글 표시명이라 라벨 불일치가 없다. */}
              <th className="px-3 py-2 font-bold">학생</th>
              <SortableTh sortKey="class" state={sortState} onSort={onSort}>반</SortableTh>
              <SortableTh sortKey="teacher" state={sortState} onSort={onSort}>강사</SortableTh>
              {/* 보고서 멘트 점수(참고용, 0450a · 기준 v6 원장 점수표 — 원장 2026-10-27 '평점'에서 이름 바꿈 · 가운데 정렬) — 근거는
                  숫자에 마우스를 올리면 카드로 뜬다. 정렬(원장 2026-10-26)은 서버가 평점 표를 읽어 줄 세운다(listReports) — 점수 없는 보고서는 방향과 무관하게 뒤. */}
              {showRating ? (
                <SortableTh sortKey="rating" state={sortState} onSort={onSort} align="center" className="whitespace-nowrap">
                  보고서 멘트 점수
                </SortableTh>
              ) : null}
              {/* 멘트 작성 방식(0214a) — 정렬 없음(값 3종 + 도입 전 "—"라 필터가 더 정확하다, 뷰 설정에서). */}
              {showMent ? <th className="px-3 py-2 font-bold" title="멘트를 누가 썼는가 — 직접 작성/자동작성(뷰 설정에서 필터)">멘트</th> : null}
              {classnoteOn ? <SortableTh sortKey="status" state={sortState} onSort={onSort}>발송 상태</SortableTh> : null}
              <SortableTh sortKey="read" state={sortState} onSort={onSort} align="right">열람</SortableTh>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={(sendOn ? 8 : 7) + (showMent ? 1 : 0) + (showRating ? 1 : 0) - (classnoteOn ? 0 : 1)}
                  className="text-text-faint px-3 py-6 text-center"
                >
                  조건에 맞는 보고서가 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-line hover:bg-bg-soft border-b last:border-b-0">
                  {sendOn ? (
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
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    {r.subject ? <Pill color={subjects.colorOf(r.subject)}>{subjects.labelOf(r.subject)}</Pill> : <span className="text-text-faint">—</span>}
                  </td>
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">
                    {r.reportDate}
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
                  <td className="text-foreground px-3 py-2 font-bold whitespace-nowrap">{r.studentName}</td>
                  {/* 반(0134a) — **내부 표시 전용**(학부모 화면엔 안 나온다). 이관분은 반 추정이 구조적으로
                      불가해 대부분 "—"다. 반 정렬 시 이 빈 값들이 뒤로 가고 반 있는 건이 위로 모인다. */}
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">{r.className ?? "—"}</td>
                  <td className="text-text-dim px-3 py-2">{r.teacherName ?? "—"}</td>
                  {showRating ? (
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <RatingCell rating={r.rating} />
                    </td>
                  ) : null}
                  {showMent ? (
                    <td className="px-3 py-2 whitespace-nowrap">
                      <MentSourceCell value={r.mentSource} />
                    </td>
                  ) : null}
                  {classnoteOn ? (
                    <td className="px-3 py-2">
                      <StatusCell status={r.classnoteStatus} source={r.source} readAt={r.readAt} unsentTip={unsentCards[r.id]} />
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {sendOn &&
                      r.classnoteStatus &&
                      RETRY_STATUSES.has(r.classnoteStatus) &&
                      r.source !== "edutrix_import" &&
                      !classnoteRetryDeadline(r.reportDate, todayYmd).expired ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retryingId === r.id}
                          onClick={() => doRetryRow(r)}
                          title="실패·보류된 보고서를 ClassNote로 다시 보냅니다(서버가 기한·과목·결석을 다시 확인)"
                        >
                          재발송
                        </Button>
                      ) : null}
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
