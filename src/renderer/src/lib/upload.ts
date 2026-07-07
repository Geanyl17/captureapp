import { getAccessToken } from './supabase'

const BASE = import.meta.env.VITE_UPLOAD_API_URL

export async function uploadImage(blob: Blob, filename: string): Promise<string> {
  const token = await getAccessToken()
  if (!token) throw new Error('Not signed in')

  const form = new FormData()
  form.append('file', blob, filename)

  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `Upload failed (${res.status})`)
  }

  const { url } = await res.json()
  return url as string
}
