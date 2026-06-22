-- 0041a: class_schedules 셀 단위 강사/강의실 표시 라벨 (ijw slotTeachers/slotRooms 이식).
-- 영어 통합뷰 미니그리드는 (요일,교시)마다 강사·LAB·강의실이 다를 수 있는데, 영문 닉네임("Hannah"/"Zoe")·
-- "LAB"·"LAB실"은 users.display_name(한글)·classrooms FK로 풀 수 없어 문자열 라벨로 보존한다.
-- NULL = 반 기본(classes.teacher_id/classroom_id) 상속. RLS는 class_schedules 기존 정책 그대로 적용.
ALTER TABLE class_schedules ADD COLUMN IF NOT EXISTS slot_teacher_label text;
ALTER TABLE class_schedules ADD COLUMN IF NOT EXISTS slot_room_label text;
