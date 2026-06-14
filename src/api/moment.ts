import client from './client'
import type {
  Result,
  Moment,
  MomentCreateRequest,
  MomentLike,
  MomentComment,
  MomentCommentRequest,
} from '@/types'

export function createMoment(data: MomentCreateRequest) {
  // The default 10s axios timeout is too tight when the post carries media:
  // the backend writes the row, broadcasts a WS event, and only then returns
  // the populated Moment — combined latency on a slow link can exceed 10s
  // even though the post succeeded. Give it 30s of headroom; UI also has
  // a WS-based fallback unlock.
  return client.post<unknown, Result<Moment>>('/moment', data, { timeout: 30_000 })
}

/**
 * Soft-delete a moment. Backend marks the row + its likes/comments with
 * deleted_at = NOW() and broadcasts a `moment_delete` WS event so the
 * other side's feed updates instantly. Only the author can delete.
 */
export function deleteMoment(momentId: number) {
  return client.delete<unknown, Result<null>>(`/moment/${momentId}`)
}

export function getAllMoments() {
  return client.get<unknown, Result<Moment[]>>('/moment/all')
}

export function toggleLike(momentId: number) {
  return client.post<unknown, Result<boolean>>(`/moment/like/${momentId}`)
}

export function getLikes(momentId: number) {
  return client.get<unknown, Result<MomentLike[]>>(`/moment/like/${momentId}`)
}

export function createComment(momentId: number, data: MomentCommentRequest) {
  return client.post<unknown, Result<MomentComment>>(
    `/moment/comment/${momentId}`,
    data,
  )
}

export function getComments(momentId: number) {
  return client.get<unknown, Result<MomentComment[]>>(
    `/moment/comment/${momentId}`,
  )
}