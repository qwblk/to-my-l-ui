import client from './client'
import type {
  Result,
  Diary,
  DiaryCreateRequest,
  DiaryDayGroup,
  DiaryDaysResponse,
} from '@/types'

export type DiaryScope = 'all' | 'mine'

export function createDiary(data: DiaryCreateRequest) {
  return client.post<unknown, Result<Diary>>('/diary', data)
}

export function getAllDiaries() {
  return client.get<unknown, Result<Diary[]>>('/diary/all')
}

export function getMyDiaries() {
  return client.get<unknown, Result<Diary[]>>('/diary/mine')
}

/**
 * Cursor-paginated, day-grouped diaries. Preferred API for DiaryView.
 *
 * cursorDate means "load days strictly before this date". Backend returns
 * entries within a day in create_time ASC order, while days themselves are
 * DESC.
 */
export function getDiaryDays(params?: {
  scope?: DiaryScope
  cursorDate?: string | null
  size?: number
}) {
  return client.get<unknown, Result<DiaryDaysResponse>>('/diary/days', { params })
}

/** Load a single day regardless of whether that day is already in the
 * current paginated list. Used by the calendar jump. */
export function getDiaryDay(params: {
  scope?: DiaryScope
  date: string
}) {
  return client.get<unknown, Result<DiaryDayGroup>>('/diary/day', { params })
}

/**
 * Soft-delete a diary. Backend marks the row with deleted_at = NOW() and
 * broadcasts a `diary_delete` WS event. Only the author can delete.
 */
export function deleteDiary(diaryId: number) {
  return client.delete<unknown, Result<null>>(`/diary/${diaryId}`)
}
