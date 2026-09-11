"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { kstMinutesOfDay, kstToday, kstTimeOf, weekdayIndexOf } from "@/lib/date-kst";
import { roomGroupKey, roomGroupOf } from "@/features/timetable/lib/room-groups";
import { lessonStatus, minuteLabel, roomAt, type Classroom, type ClassroomLesson, type ClassroomSnapshot } from "@/features/dashboard/classroom-preview/model";
import { useClassrooms, useClassroomView } from "./use-classrooms";
import { ClassroomMap } from "./classroom-map";
import { sortClassroomsByFloor } from "@/features/dashboard/classroom-preview/scene-layout";
import { classroomSeatingAt, type RoomSeating } from "@/features/dashboard/classroom-preview/seating";
import styles from "./classrooms.module.css";

const STATUS = { ongoing: "수업 중", upcoming: "예정", done: "종료", unknown: "확인 필요", idle: "수업 없음" };

function Lesson({ lesson, minute, subjects, onNavigate }: {
  lesson: ClassroomLesson; minute: number | null; subjects: Record<string, string>; onNavigate?: () => void;
}) {
  const status = lessonStatus(lesson, minute);
  return <li className={styles.lesson} data-status={status}>
    <div className={styles.lessonTime}>{lesson.startTime.slice(0, 5)}<span>{lesson.endTime.slice(0, 5)}</span></div>
    <div className={styles.lessonBody}>
      <WindowLink href={`/classes/${lesson.classId}`} title={lesson.className} onNavigate={onNavigate}>{lesson.className}<span aria-hidden> ↗</span></WindowLink>
      <p>{subjects[lesson.subject] ?? lesson.subject} · {lesson.teacherName ?? "담당 미입력"}</p>
      <p>수강 {lesson.studentCount}명 <span className={styles.lessonStatus}>{STATUS[status]}</span></p>
      {lesson.attendance && <p>출석 확인 {lesson.attendance.length}명</p>}
    </div>
  </li>;
}

function RoomDetails({ room, minute, snapshot, seating, onNavigate }: {
  room: Classroom; minute: number | null; snapshot: ClassroomSnapshot; seating?: RoomSeating; onNavigate?: () => void;
}) {
  const { active, ordered } = roomAt(room, minute);
  return <div className={styles.detailBody}>
    <div className={styles.detailSummary}>
      <span className={styles.badge} data-status={active.length ? "ongoing" : minute === null ? "unknown" : "idle"}>
        {minute === null ? "시간표 확인 필요" : active.length ? `${active.length}개 반 수업 중` : "현재 수업 없음"}
      </span>
      {room.capacity !== null && <span>정원 {room.capacity}명</span>}
      {active.length > 0 && seating && <span>{seating.rosterAvailable ? `책상 ${seating.seats.length}개${seating.attendanceAvailable ? ` · 출석 확인 ${seating.seats.filter(Boolean).length}명` : ""}` : "수강 명단 확인 중"}</span>}
    </div>
    {active.length > 0 && <>
      <h3>지금 진행 중</h3>
      <ul className={styles.lessons}>{active.map((lesson) => <Lesson key={lesson.id} lesson={lesson} minute={minute} subjects={snapshot.subjects} onNavigate={onNavigate} />)}</ul>
    </>}
    <h3>오늘 시간표 <span>{ordered.length}개 시간대</span></h3>
    {ordered.length ? <ul className={styles.lessons}>{ordered.map((lesson) => <Lesson key={lesson.id} lesson={lesson} minute={minute} subjects={snapshot.subjects} onNavigate={onNavigate} />)}</ul>
      : <p className={styles.empty}>오늘 등록된 수업이 없습니다.</p>}
    <p className={styles.footnote}>수강 인원은 오늘 수강 대상 기준입니다.</p>
  </div>;
}

export function ClassroomPreview({ initial }: { initial: ClassroomSnapshot }) {
  const query = useClassrooms(initial);
  const data = query.data;
  const [view, changeView] = useClassroomView();
  const [clock, setClock] = useState(initial.at);
  const [preview, setPreview] = useState<number | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unassignedOpen, setUnassignedOpen] = useState(false);
  const [webglFailed, setWebglFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showPeople, setShowPeople] = useState(true);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const sameDay = kstToday(new Date(clock)) === data.date;
  const minute = sameDay ? preview ?? kstMinutesOfDay(new Date(clock)) : null;
  const seating = classroomSeatingAt(data.rooms, minute, data.attendanceAvailable && preview === null);
  const orderedRooms = sortClassroomsByFloor(data.rooms);
  const groups = [...new Map(orderedRooms.map((room) => {
    const group = roomGroupOf(room.name);
    return [roomGroupKey(group), group] as const;
  })).entries()];
  const activeFilter = groups.some(([key]) => key === filter) ? filter : "all";
  const needle = search.trim().toLocaleLowerCase();
  const visible = orderedRooms.filter((room) =>
    (activeFilter === "all" || roomGroupKey(roomGroupOf(room.name)) === activeFilter) &&
    (!needle || [room.name, ...room.lessons.flatMap((s) => [s.className, s.teacherName ?? ""])].some((s) => s.toLocaleLowerCase().includes(needle))),
  );
  const selected = visible.find((room) => room.id === selectedId)
    ?? visible.find((room) => roomAt(room, minute).active.length > 0) ?? visible[0];
  const ongoing = data.rooms.filter((room) => roomAt(room, minute).active.length > 0).length;
  const upcoming = data.rooms.filter((room) => {
    const state = roomAt(room, minute);
    return !state.active.length && !!state.next;
  }).length;
  const choose = (room: Classroom) => {
    setSelectedId(room.id);
    if ((root.current?.clientWidth ?? window.innerWidth) < 900) setMobileOpen(true);
  };
  const dateLabel = `${data.date.slice(2).replaceAll("-", ".")} (${"일월화수목금토"[weekdayIndexOf(data.date)]})`;

  const noticeHeight = 44 * (Number(preview !== null) + Number(webglFailed) + Number(query.isError || !sameDay));
  return <section ref={root} className={styles.root} data-expanded={expanded} style={{ "--notice-height": `${noticeHeight}px` } as CSSProperties} aria-label="강의실 현황">
    <header className={styles.header}>
      <div><div className={styles.titleLine}><h1>강의실 현황</h1></div><p>{dateLabel}{data.scoped ? " · 담당 수업 기준" : ""}</p></div>
      <div className={styles.headerActions}>
        <button className={styles.expandButton} aria-pressed={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "전체화면 닫기" : "전체화면"}</button>
        <WindowLink href="/dashboard" className={styles.back}>대시보드</WindowLink>
        <div className={styles.viewSwitch} role="group" aria-label="교실 보기 방식">
          <button aria-pressed={view === "2d"} onClick={() => changeView("2d")}>2D 배치</button>
          <button aria-pressed={view === "3d"} onClick={() => { setWebglFailed(false); changeView("3d"); }}>3D 배치</button>
        </div>
      </div>
    </header>

    <div className={styles.overview}>
      <div className={styles.clock}><span>{preview === null ? "현재 시각" : "시간 미리보기"}</span><strong>{minute === null ? "—" : minuteLabel(minute)}</strong></div>
      <dl className={styles.counts}>
        <div><dt>수업 중</dt><dd>{minute === null ? "—" : ongoing}<small>실</small></dd></div>
        <div><dt>수업 없음</dt><dd>{minute === null ? "—" : data.rooms.length - ongoing}<small>실</small></dd></div>
        <div><dt>다음 수업 대기</dt><dd>{minute === null ? "—" : upcoming}<small>실</small></dd></div>
      </dl>
      <div className={styles.timeControls}>
        <label>시간 미리보기<input type="time" aria-label="오늘 시간 미리보기" disabled={!sameDay} value={minute === null ? "" : minuteLabel(minute)} onChange={(e) => {
          if (!e.target.value) { setPreview(null); return; }
          const [h, m] = e.target.value.split(":").map(Number); setPreview(h * 60 + m);
        }} /></label>
        {preview !== null && <button className={styles.textButton} onClick={() => { setPreview(null); setClock(Date.now()); }}>현재로</button>}
      </div>
    </div>
    {preview !== null && <p className={styles.notice} role="status">오늘 {minuteLabel(preview)} 시간표를 미리 보고 있습니다.</p>}
    {(query.isError || !sameDay) && <p className={styles.warning} role="alert">{!sameDay ? "날짜가 바뀌었습니다. 오늘 시간표를 새로고침해 주세요." : "최신 데이터를 불러오지 못했습니다. 마지막으로 확인한 시간표를 표시합니다."}</p>}

    {webglFailed && <p className={styles.notice} role="status">이 환경에서 3D를 표시하지 못해 2D 배치로 전환했습니다.</p>}
    <div className={styles.toolbar}>
      <div className={styles.filters} role="group" aria-label="건물 및 층 선택">
        <button aria-pressed={activeFilter === "all"} onClick={() => { setSelectedId(null); setFilter("all"); }}>전체 {data.rooms.length}</button>
        {groups.map(([key, group]) => <button key={key} aria-pressed={activeFilter === key} onClick={() => { setSelectedId(null); setFilter(key); }}>{group.label}</button>)}
      </div>
      <input className={styles.search} type="search" aria-label="교실, 반, 강사 검색" placeholder="교실·반·강사 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
    </div>

    <div className={styles.workspace}>
      <div className={styles.board}>
        <div className={styles.boardHeading}><h2>{activeFilter === "all" ? "전체 교실" : groups.find(([key]) => key === activeFilter)?.[1].label}<span>{visible.length}실</span></h2><div className={styles.boardOptions}>
          {data.attendanceAvailable && <label><input type="checkbox" checked={showPeople && preview === null} disabled={preview !== null} onChange={(event) => setShowPeople(event.target.checked)} />학생 표시</label>}
          <span>층·교실을 누르면 크게 보입니다</span>
        </div></div>
        <ClassroomMap rooms={visible} allRooms={orderedRooms} focusedFloor={activeFilter === "all" ? null : activeFilter} minute={minute} seating={seating} showPeople={showPeople} selectedId={selectedId && selected?.id === selectedId ? selectedId : null} view={view}
          onChoose={choose} onFloor={(key) => { setSelectedId(null); setFilter(key); }} onFallback={() => { setWebglFailed(true); changeView("2d"); }} />
      </div>
      {selectedId && <aside className={styles.details} aria-label="선택 교실 시간표">
        <header className={styles.detailHeader}><button aria-label="교실 상세 닫기" className={styles.detailClose} onClick={() => setSelectedId(null)}>×</button><h2>{selected?.name ?? "교실 선택"}</h2><p>{dateLabel}</p></header>
        {selected && <RoomDetails room={selected} minute={minute} snapshot={data} seating={seating[selected.id]} />}
      </aside>}
    </div>

    <footer className={styles.footer}>
      <span>책상은 현재 수업 인원 · 학생은 출석 기록 기준 {data.unassigned.length > 0 && <button className={styles.textButton} onClick={() => setUnassignedOpen(true)}>교실 미배정 {data.unassigned.length}개 시간대</button>}</span>
      <span>{kstTimeOf(new Date(data.at))} 확인 · 30초마다 갱신 <button className={styles.refresh} disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? "갱신 중" : "새로고침"}</button></span>
    </footer>

    <Dialog open={mobileOpen && !!selected} onOpenChange={setMobileOpen}>
      <DialogContent className={styles.dialog}>
        <DialogTitle>{selected?.name}</DialogTitle><DialogDescription>{dateLabel} 시간표</DialogDescription>
        {selected && <RoomDetails room={selected} minute={minute} snapshot={data} seating={seating[selected.id]} onNavigate={() => setMobileOpen(false)} />}
      </DialogContent>
    </Dialog>
    <Dialog open={unassignedOpen} onOpenChange={setUnassignedOpen}>
      <DialogContent className={styles.dialog}><DialogTitle>교실 미배정 수업</DialogTitle><DialogDescription>{dateLabel} · 반을 선택해 상세 정보를 확인할 수 있습니다.</DialogDescription>
        <ul className={styles.lessons}>{data.unassigned.map((lesson) => <Lesson key={lesson.id} lesson={lesson} minute={minute} subjects={data.subjects} onNavigate={() => setUnassignedOpen(false)} />)}</ul>
      </DialogContent>
    </Dialog>
  </section>;
}
