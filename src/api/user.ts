import client from './client'
import type { Result, User } from '@/types'

export function getMe() {
  return client.get<unknown, Result<User>>('/user/me')
}

export function getUser(id: number) {
  return client.get<unknown, Result<User>>(`/user/${id}`)
}

export function getUserList() {
  return client.get<unknown, Result<User[]>>('/user/list')
}

export function getOnlineStatus() {
  return client.get<unknown, Result<string[]>>('/user/online-status')
}

/** Push "I'm here" to the server. Idempotent — call freely from a heartbeat. */
export function heartbeat() {
  return client.put<unknown, Result<null>>('/user/heartbeat')
}

/** Fetch this user's last_seen_at. Null if they've never heartbeat'd. */
export function getLastSeen() {
  return client.get<unknown, Result<{ lastSeenAt: string | null }>>('/user/last-seen')
}

/**
 * Update the current user's editable profile fields. Only the listed
 * fields are sent; backend should ignore unknown keys. Backend isn't
 * required to ship this yet — UI handles 404/405 gracefully.
 */
export interface UpdateProfileRequest {
  name?: string
  gender?: number
  birthday?: string  // yyyy-MM-dd
  profileText?: string
}

export function updateMyProfile(data: UpdateProfileRequest) {
  return client.put<unknown, Result<User>>('/user/me', data)
}
