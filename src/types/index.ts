// ====== Generic ======
export interface Result<T> {
  code: number
  msg: string
  data: T
}

// ====== Login ======
export interface LoginResponse {
  token: string
  firstLogin: boolean
  greeting: string
  partnerOnline: boolean
}

// ====== User ======
export interface LoginRequest {
  username: string
  password: string
}

export interface User {
  id: number
  name: string
  gender: number
  username: string
  birthday: string
  age: number
  createTime: string
  updateTime: string
  /** Server-tracked "last active" timestamp (yyyy-MM-dd HH:mm:ss).
   *  Null for users who have never hit the heartbeat endpoint. */
  lastSeenAt?: string | null
}

// ====== Diary ======
export interface DiaryCreateRequest {
  title: string
  content: string
  mood?: string
  weather?: string
  isPrivate?: number
}

export interface Diary {
  id: number
  userId: number
  title: string
  content: string
  mood: string | null
  weather: string | null
  isPrivate: number
  createTime: string
  userName: string
}

export interface DiaryDayGroup {
  /** yyyy-MM-dd */
  date: string
  /** 星期一 / 星期二 ... */
  weekday: string
  /** Entries sorted create_time ASC, id ASC by backend. */
  entries: Diary[]
}

export interface DiaryDaysResponse {
  list: DiaryDayGroup[]
  /** Next cursor date, yyyy-MM-dd. Null when no more. */
  nextCursorDate: string | null
  hasMore: boolean
}

// ====== Moment ======
export type MomentMediaType = 'image' | 'video'

export interface MomentMedia {
  type: MomentMediaType
  /** Server-relative URL, always starts with /static/uploads/ */
  url: string
  width?: number
  height?: number
  /** Seconds. Only set for videos; client computes via <video>.loadedmetadata. */
  duration?: number
}

export interface MomentCreateRequest {
  content: string
  mediaList?: MomentMedia[]
}

export interface Moment {
  id: number
  userId: number
  userName: string
  content: string
  /** @deprecated Backend keeps this for legacy rows; new code reads `mediaList`. */
  image: string | null
  mediaList: MomentMedia[]
  createTime: string
  likes: MomentLike[]
  comments: MomentComment[]
  likeCount: number
}

export interface MomentLike {
  id: number
  momentId: number
  userId: number
  userName: string
  createTime: string
}

export interface MomentCommentRequest {
  content: string
}

export interface MomentComment {
  id: number
  momentId: number
  userId: number
  content: string
  userName: string
  createTime: string
}

// ====== Message ======
export interface MessageSendRequest {
  receiverId: number
  content: string
}

export interface Message {
  id: number
  senderId: number
  receiverId: number
  content: string
  isRead: number
  senderName: string
  createTime: string
}

export interface MessagePageResponse {
  list: Message[]
  /** Next cursor, yyyy-MM-dd HH:mm:ss. Null when no more. */
  nextCursor: string | null
  hasMore: boolean
}

// ====== WebSocket ======
export type WsType =
  | 'chat'
  | 'heart'
  | 'history'
  | 'online'
  | 'offline'
  | 'status'
  | 'diary'
  | 'diary_delete'
  | 'moment'
  | 'moment_delete'
  | 'like'
  | 'comment'
  | 'message'
  | 'read'
  | 'system'

export interface WsMessage {
  sender: string
  content: string
  time: string
  type: WsType
  data?: Record<string, unknown>
}

export interface ChatMessage {
  id: number
  senderId: number
  receiverId: number
  senderName: string
  content: string
  createTime: string
  /** Optional chat attachments, same shape as Moment media. */
  mediaList?: MomentMedia[]
}

export interface ChatHistoryResponse {
  list: ChatMessage[]
  nextCursor: string | null
  hasMore: boolean
}

