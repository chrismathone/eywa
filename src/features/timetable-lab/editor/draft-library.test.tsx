import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFixture } from './model';
import { DraftStore } from './store';
import type { DraftSummary } from '../draft-schema';

const api = vi.hoisted(() => ({ list: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock('./draft-api', () => ({ listDrafts: api.list, loadDraft: api.load, saveDraft: api.save }));
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
    await waitFor(() => expect(loaded).toHaveBeenCalledWith('10월 연습본', expect.objectContaining({ originId: expect.any(String) })));
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
