-- 0452a — 원생 기여도(student_contribution)를 실험실 배정 표에 넣는다
--
-- 지금까지 퇴원보고서·원생 기여도는 앱 코드(`src/lib/laboratory/server.ts` getLaboratoryMenus)가 **늘 실험실로 끼워 넣었다**.
-- 그래서 운영 콘솔 '실험실 메뉴'에서 퇴원보고서를 꺼도(원장 2026-10-23 18:46 · 배정 행 삭제) 메뉴 카드의 실험실 마크와 잠금이 남았다
-- (원장 *"실험실을 껐는데도 여전히 실험실마크가 있는것도 체크"*). 같은 날 끼워 넣기를 지우고 이 표만 원본으로 삼는다.
--   · 퇴원보고서 = 원장이 껐으니 넣지 않는다(일반 메뉴).
--   · 원생 기여도 = 한 번도 토글한 적이 없다 → 지금 동작(실험실)을 지키려고 행을 넣는다. 운영 콘솔에서 언제든 끌 수 있다.
-- 🔴 앱보다 먼저 적용한다 — 끼워 넣기를 지운 앱이 이 행 없이 먼저 나가면 원생 기여도가 실험실을 켜지 않은 지점에도 열린다([[#95]]).
--    옛 앱은 어차피 끼워 넣으니 이 행이 먼저 들어와도 아무것도 바뀌지 않는다.
-- 되돌리기는 이 파일에 적지 않는다 — scripts/_oneoff/revert-0452a-lab-menu-student-contribution.sql

insert into public.lab_menu_assignments (menu_key) values ('student_contribution') on conflict (menu_key) do nothing;
