import client from './client'
import type { Result } from '@/types'

/** Server response from POST /upload. The backend doesn't compute video
 *  duration — the frontend probes that locally via <video>.loadedmetadata
 *  before assembling MomentMedia. */
export interface UploadResponse {
  url: string
  type: 'image' | 'video'
  width?: number
  height?: number
}

/** Upload a single file. Caller should serialize uploads (one at a time)
 *  to avoid hammering the backend with concurrent multipart streams from
 *  a phone connection. */
export function uploadFile(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<Result<UploadResponse>> {
  const form = new FormData()
  form.append('file', file)
  return client.post<unknown, Result<UploadResponse>>('/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (!onProgress || !e.total) return
      onProgress(Math.round((e.loaded / e.total) * 100))
    },
    // The default 10s axios timeout is too tight for a 50MB video on a
    // phone hotspot. Bump to 5min for upload only.
    timeout: 5 * 60 * 1000,
  })
}
