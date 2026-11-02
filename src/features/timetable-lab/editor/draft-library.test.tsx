import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFixture } from './model';
import { DraftStore } from './store';
import type { DraftSummary } from '../draft-schema';

const api = vi.hoisted(() => ({ list: vi.fn(), load: vi.fn(), save: vi.fn(), overwrite: vi.fn(), remove: vi.fn() }));
vi.mock('./draft-api', () => ({ listDrafts: api.list, loadDraft: api.load, saveDraft: api.save, overwriteDraft: api.overwrite, deleteDraft: api.remove }));
import { DraftLibrary } from './draft-library';

const items: DraftSummary[] = [
  { id: 'one', name: '10월 연습본', subject: 'english', createdAt: '2026-10-22T06:00:00Z', createdBy: 'author-a', createdByName: '김선생', lessonCount: 2, classCount: 1, studentCount: 3, referenceDate: null },
  { id: 'two', name: '10월 연습본', subject: 'english', createdAt: '2026-10-22T07:00:00Z', createdBy: 'author-b', createdByName: '이선생', lessonCount: 2, classCount: 1, studentCount: 3, referenceDate: null },
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  api.list.mockResolvedValue({ items, nextOffset: null });
  api.load.mockImplementation(async (id: string) => ({ item: items.find(item => item.id === id), draft: makeFixture() }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('저장본 덮어쓰기·삭제', () => {
  const mine: DraftSummary = { ...items[0], manageable: true };
  const draftStore = () => { const store = new DraftStore(); store.commit('수업', makeFixture()); return store; };
  beforeEach(() => { api.list.mockResolvedValue({ items: [mine, items[1]], nextOffset: null }); api.remove.mockResolvedValue(undefined); });

  it('지금 편집 중인 저장본이면 덮어쓰기가 기본 버튼이고, 확인해야 저장한다', async () => {
    const saved = vi.fn(), overwritten = { ...mine, createdAt: '2026-11-02T06:00:00Z' };
    api.overwrite.mockResolvedValue(overwritten);
    render(<DraftLibrary store={draftStore()} close={vi.fn()} loaded={vi.fn()} saved={saved} currentId="one" compare={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '“10월 연습본”에 덮어쓰기' }));
    expect(api.overwrite).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('되돌릴 수 없습니다');
    fireEvent.click(screen.getByRole('button', { name: '덮어쓰기 확인' }));
    await waitFor(() => expect(api.overwrite).toHaveBeenCalledWith('one', '10월 연습본', expect.anything()));
    await waitFor(() => expect(saved).toHaveBeenCalledWith('10월 연습본', expect.anything(), 'one'));
    expect(api.save).not.toHaveBeenCalled();
  });
  it('남의 저장본에는 덮어쓰기·삭제 버튼이 없다', async () => {
    render(<DraftLibrary store={draftStore()} close={vi.fn()} loaded={vi.fn()} saved={vi.fn()} currentId="two" compare={vi.fn()} />);
    await screen.findByRole('button', { name: /불러오기.*이선생/ });
    expect(screen.queryByRole('button', { name: /덮어쓰기.*이선생/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /삭제.*이선생/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /에 덮어쓰기$/ })).toBeNull();
    expect(screen.getByRole('button', { name: /덮어쓰기.*김선생/ })).toBeInTheDocument();
  });
  it('삭제는 확인 뒤 목록에서 빠지고, 취소하면 지우지 않는다', async () => {
    const removed = vi.fn();
    render(<DraftLibrary store={draftStore()} close={vi.fn()} loaded={vi.fn()} saved={vi.fn()} removed={removed} compare={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /삭제.*김선생/ }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /삭제.*김선생/ }));
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));
    await waitFor(() => expect(removed).toHaveBeenCalledWith('one'));
    expect(screen.queryByRole('button', { name: /불러오기.*김선생/ })).toBeNull();
  });
});

describe('지점 공유 연습본 보관함', () => {
  it('다른 사람이 저장한 동일 이름의 연습본도 저장자·저장 시각으로 구분하고 불러온다', async () => {
    const loaded = vi.fn();
    render(<DraftLibrary store={new DraftStore()} close={vi.fn()} loaded={loaded} saved={vi.fn()} compare={vi.fn()} />);
    await screen.findByRole('button', { name: /불러오기.*김선생/ });
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText(/저장자 김선생/, { selector: 'small' })).toBeInTheDocument();
    expect(within(rows[0]).getByText(/2026\. 10\. 22\. 오후 03:00/, { selector: 'time' })).toHaveAttribute('datetime', items[0].createdAt);
    expect(within(rows[1]).getByText(/저장자 이선생/, { selector: 'small' })).toBeInTheDocument();
    fireEvent.click(within(rows[1]).getByRole('button', { name: /불러오기/ }));
    await waitFor(() => expect(loaded).toHaveBeenCalledWith('10월 연습본', expect.objectContaining({ originId: expect.any(String) }), 'two'));
    expect(api.load).toHaveBeenCalledWith('two');
    expect(api.save).not.toHaveBeenCalled();
  });

  it('비교 선택지와 비교 제목에도 저장자를 표시해 같은 이름의 공유본을 구분한다', async () => {
    const compare = vi.fn();
    render(<DraftLibrary store={new DraftStore()} close={vi.fn()} loaded={vi.fn()} saved={vi.fn()} compare={compare} />);
    await screen.findByRole('button', { name: /불러오기.*김선생/ });
    const left = screen.getByLabelText('비교할 왼쪽 연습본');
    const right = screen.getByLabelText('비교할 오른쪽 연습본');
    expect(within(left).getByRole('option', { name: /김선생/ })).toHaveValue('one');
    expect(within(right).getByRole('option', { name: /이선생/ })).toHaveValue('two');
    fireEvent.change(left, { target: { value: 'one' } });
    fireEvent.change(right, { target: { value: 'two' } });
    fireEvent.click(screen.getByRole('button', { name: '나란히 비교하기' }));
    await waitFor(() => expect(compare).toHaveBeenCalledWith(
      expect.objectContaining({ name: expect.stringContaining('저장자 김선생') }),
      expect.objectContaining({ name: expect.stringContaining('저장자 이선생') }),
    ));
  });
});
