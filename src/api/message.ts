import client from './client'
import type { Result, Message, MessageSendRequest, MessagePageResponse } from '@/types'

export function sendMessage(data: MessageSendRequest) {
  return client.post<unknown, Result<Message>>('/message', data)
}

export function getReceivedMessages() {
  return client.get<unknown, Result<Message[]>>('/message/received')
}

export function getSentMessages() {
  return client.get<unknown, Result<Message[]>>('/message/sent')
}

export function getReceivedMessagesPage(params?: { cursor?: string | null; cursorId?: number | null; size?: number }) {
  return client.get<unknown, Result<MessagePageResponse>>('/message/received/page', { params })
}

export function getSentMessagesPage(params?: { cursor?: string | null; cursorId?: number | null; size?: number }) {
  return client.get<unknown, Result<MessagePageResponse>>('/message/sent/page', { params })
}

export function markRead(messageId: number) {
  return client.put<unknown, Result<null>>(`/message/read/${messageId}`)
}

export function getUnreadCount() {
  return client.get<unknown, Result<number>>('/message/unread-count')
}
