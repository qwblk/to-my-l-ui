import client from './client'
import type { ChatHistoryResponse, Result } from '@/types'

/**
 * Persisted chat history.
 *
 * Backend returns DESC (newest first); the store normalizes to ASC for
 * display and prepends older pages when the user scrolls upward.
 */
export function getChatHistory(params?: { cursor?: string | null; size?: number }) {
  return client.get<unknown, Result<ChatHistoryResponse>>('/chat/history', { params })
}
