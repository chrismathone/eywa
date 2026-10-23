-- 0452a 되돌리기 — 원생 기여도를 실험실 배정 표에서 뺀다(= 운영 콘솔 '실험실 메뉴'에서 끄는 것과 같다).
-- 🔴 적용 SQL이 아니다. 되돌릴 때만 원장 승인 뒤 손으로 실행한다. 보통은 운영 콘솔 토글을 쓰면 된다.
delete from public.lab_menu_assignments where menu_key = 'student_contribution';
