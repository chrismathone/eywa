"use client";

import { useState } from "react";
import { NavigationSection } from "@/app/(shell)/owner/_components/navigation-section";
import { NavigationProvider, useNavigationSettings } from "@/features/owner/navigation-context";
import { navigationSchema, type NavigationSettings } from "@/features/owner/settings-types";
import { HUB_GROUPS, SUPPORT_GROUPS, hubGroupsFor, hubSearchKeywords, type HubDest } from "@/lib/menu-hub";
import { HubGrid } from "@/components/workspace/menu-hub-grid";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { SYSTEM_ROLES, TEACHER_MENU_KEYS, type SystemRole } from "@/lib/permissions";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { teacherNavigationFor, teacherNavigationSource } from "@/lib/teacher-navigation";
import { TeacherNavigationItems } from "@/components/teacher-navigation-items";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { sheetT, type SheetLang } from "@/features/teacher-view/i18n";
import { routeKeyOf, menuKeyOfRoute } from "@/features/usage/route-key";
import { routeLabel, usageMenuLabel } from "@/features/usage/labels";
import { MenuMentionEditor } from "@/components/editor/menu-mention-editor";
import { MenuMentionText } from "@/components/menu-mention-text";
import { menuMentionToken } from "@/features/owner/menu-mentions";

const EMPTY: NavigationSettings = { menus: [], groups: [], teacherMenus: [], teacherGroups: [] };

/** 운영 계정·DB와 연결하지 않고 실제 편집기/스키마/메뉴 해석기/격자를 사용하는 dev 전용 화면. */
export function NavigationPreview() {
  const [settings, setSettings] = useState(EMPTY);
  const [view, setView] = useState<"admin" | "teacher">("admin");
  const [lang, setLang] = useState<SheetLang>("ko");
  const [selected, setSelected] = useState("class");
  const [role, setRole] = useState<SystemRole>("master");
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<HubDest | null>(null);
  const [message, setMessage] = useState("");
  const groups = hubGroupsFor([...HUB_GROUPS, ...SUPPORT_GROUPS], { systemRole: role, menuLayout: settings.menus, groupLayout: settings.groups, isMaster: role === "master", canTeacherView: true });
  const active = groups.find((g) => g.id === selected) ?? groups[0];
  const destinations = query.trim() ? groups.flatMap((g) => g.items.filter((d) => hubSearchKeywords(d, g.label).includes(query.trim().toLowerCase()))) : active?.items ?? [];
  return <NavigationProvider menus={view === "teacher" ? settings.teacherMenus : settings.menus} groups={(view === "teacher" ? settings.teacherGroups : settings.groups) ?? []} source={view === "teacher" ? teacherNavigationSource(lang) : undefined}>
    <main className="bg-background text-foreground min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="border-line flex flex-wrap items-end justify-between gap-4 border-b pb-4">
          <div><p className="text-primary text-sm font-semibold">개발 미리보기</p><h1 className="mt-1 text-2xl font-bold">우리 학원 메뉴 만들기</h1><p className="text-text-dim mt-2 text-sm">아래에서 편집한 뒤 ‘미리보기에 적용’을 눌러 보세요. 운영 학원에는 저장되지 않습니다.</p></div>
          <span className="text-primary text-sm" role="status">{message}</span>
        </header>
        <NavigationSection initial={EMPTY} teacherOpen={TEACHER_MENU_KEYS} onViewChange={(next) => { setView(next); setOpened(null); }} onPreview={(value) => {
          const parsed = navigationSchema.safeParse(value);
          if (!parsed.success) { setMessage(parsed.error.issues[0]?.message ?? "입력을 확인해 주세요"); return; }
          setSettings(JSON.parse(JSON.stringify(parsed.data))); setMessage("미리보기에 적용했습니다"); setOpened(null);
        }} />
        {view === "teacher" ? <TeacherPreview lang={lang} onLang={setLang} /> : <section className="border-line overflow-hidden rounded-2xl border" aria-label="실제 메뉴 미리보기">
          <div className="border-line bg-bg-soft flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
            <h2 className="font-bold">적용 결과</h2><div className="flex flex-wrap gap-2"><input aria-label="미리보기 메뉴 검색" className="border-line bg-card rounded-lg border px-3 py-2 text-sm" placeholder="이름으로 메뉴 검색" value={query} onChange={(e) => setQuery(e.target.value)} /><select aria-label="미리보기 역할" value={role} onChange={(e) => setRole(e.target.value as SystemRole)} className="border-line bg-card rounded-lg border px-3 py-2 text-sm">{SYSTEM_ROLES.filter((r) => r !== "student").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
          </div>
          <div className="grid min-h-96 md:grid-cols-[216px_minmax(0,1fr)]">
            <nav className="border-line space-y-1 border-b p-3 md:border-r md:border-b-0" aria-label="미리보기 왼쪽 탭">{groups.map((g) => <button type="button" key={g.id} onClick={() => { setSelected(g.id); setQuery(""); setOpened(null); }} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold ${active?.id === g.id ? "bg-primary text-primary-foreground" : "hover:bg-bg-soft"}`}><MenuGlyph name={g.icon} size={20} /><span className="min-w-0 break-words">{g.label}</span></button>)}</nav>
            <div className="min-w-0 space-y-4 p-5"><h3 className="text-xl font-bold">{query.trim() ? "검색 결과" : active?.label}</h3><HubGrid dests={destinations} onGo={(d) => setOpened(d)} />
              {opened ? <SelectedDestination destination={opened} /> : null}
            </div>
          </div>
        </section>}
        <MenuMentionPreview />
      </div>
    </main>
  </NavigationProvider>;
}

function MenuMentionPreview() {
  const initial = `${menuMentionToken("/timetable")} 메뉴가 업데이트되었습니다. 고객센터 요청에도 @로 메뉴를 선택해 주세요.`;
  const [body, setBody] = useState(initial);
  return <section className="border-line space-y-4 rounded-2xl border p-5" aria-label="공지·고객센터 메뉴 참조 미리보기">
    <h2 className="font-bold">공지·고객센터 @메뉴</h2>
    <MenuMentionEditor defaultValue={initial} onChange={setBody} ariaLabel="메뉴 참조 예시 작성" />
    <div className="grid gap-4 md:grid-cols-2">
      <div className="bg-bg-soft space-y-2 rounded-xl p-4"><h3 className="text-primary text-sm font-bold">이 지점에서 읽는 내용</h3><p className="text-sm leading-loose whitespace-pre-wrap"><MenuMentionText text={body} link={false} /></p></div>
      <div className="bg-bg-soft space-y-2 rounded-xl p-4"><h3 className="text-primary text-sm font-bold">/admin 운영자가 읽는 내용</h3><p className="text-sm leading-loose whitespace-pre-wrap"><MenuMentionText text={body} defaultNames link={false} /></p></div>
    </div>
  </section>;
}

function SelectedDestination({ destination: d }: { destination: HubDest }) {
  const [path, search] = d.href.split("?");
  const route = routeKeyOf(path, search);
  return <div className="border-line bg-bg-soft space-y-3 rounded-xl border p-4" role="status">
    <div className="flex items-center gap-3"><MenuGlyph name={d.icon} size={24} /><span className="font-bold">{d.label}</span><span className="text-text-dim text-sm">이 이름과 아이콘으로 화면이 열립니다.</span></div>
    <p className="text-text-dim text-xs">/admin 통계 기준: <strong>{usageMenuLabel(menuKeyOfRoute(route))}</strong> · {routeLabel(route)}<br />표시 이름·폴더를 바꿔도 기본 메뉴로 함께 집계됩니다.</p>
  </div>;
}

function TeacherPreview({ lang, onLang }: { lang: SheetLang; onLang: (lang: SheetLang) => void }) {
  const { menus: layout, groups } = useNavigationSettings();
  const [subject, setSubject] = useState("mixed");
  const [restricted, setRestricted] = useState(false);
  const [opened, setOpened] = useState<HubDest | null>(null);
  const navigation = teacherNavigationFor({
    menus: restricted ? ["teacher_onescreen", "ecs", "mcs", "attendance"] : TEACHER_MENU_KEYS,
    layout, groups, lang, home: subject === "english" ? "/ecs" : "/onescreen",
    showEcs: subject !== "math", showMcs: subject !== "english",
  });
  return <section className="border-line space-y-5 rounded-2xl border p-5" aria-label="강사 메뉴 미리보기">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-bold">강사뷰 적용 결과</h2><p className="text-text-dim mt-1 text-sm">‘내 메뉴’를 열어 폴더를 확인하세요. 아래 목록은 같은 구성을 펼쳐 보여줍니다.</p></div>
      <DropdownMenu modal={false}><DropdownMenuTrigger className="border-line bg-card rounded-lg border px-4 py-2 text-sm font-bold">{sheetT(lang, "menu.trigger")}</DropdownMenuTrigger><DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]"><DropdownMenuLabel>{sheetT(lang, "menu.heading")}</DropdownMenuLabel><DropdownMenuSeparator /><TeacherNavigationItems navigation={navigation} onGo={setOpened} /></DropdownMenuContent></DropdownMenu>
    </div>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <select aria-label="강사 담당 과목" value={subject} onChange={(e) => { setSubject(e.target.value); setOpened(null); }} className="border-line rounded-lg border px-3 py-2"><option value="mixed">영어·수학 담당</option><option value="english">영어 전담</option><option value="math">수학 전담</option></select>
      <select aria-label="강사 화면 언어" value={lang} onChange={(e) => { onLang(e.target.value as SheetLang); setOpened(null); }} className="border-line rounded-lg border px-3 py-2"><option value="ko">한국어</option><option value="en">English</option></select>
      <label className="flex items-center gap-2"><input type="checkbox" checked={restricted} onChange={(e) => { setRestricted(e.target.checked); setOpened(null); }} />수업·출결 권한만 표시</label>
    </div>
    {navigation.home ? <div className="space-y-2"><p className="text-primary text-xs font-semibold">항상 맨 위 · 선생님 홈</p><TeacherDestinations items={[navigation.home]} onGo={setOpened} /></div> : null}
    <div className="grid gap-4 md:grid-cols-2">{navigation.groups.map((g) => <div key={g.id} className="border-line min-w-0 space-y-3 rounded-xl border p-4"><h3 className="flex items-center gap-2 font-bold"><MenuGlyph name={g.icon} size={20} />{g.label}</h3><TeacherDestinations items={g.items} onGo={setOpened} /></div>)}</div>
    {opened ? <SelectedDestination destination={opened} /> : null}
  </section>;
}

function TeacherDestinations({ items, onGo }: { items: HubDest[]; onGo: (d: HubDest) => void }) {
  return <ul className="space-y-1">{items.map((d) => <li key={d.href}><button type="button" onClick={() => onGo(d)} className="border-line hover:bg-bg-soft flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm font-semibold"><MenuGlyph name={d.icon} size={20} /><span className="min-w-0 flex-1 break-words">{d.label}</span><span aria-hidden className="text-text-faint">→</span></button></li>)}</ul>;
}
