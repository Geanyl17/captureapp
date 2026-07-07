import { getAccessToken } from './supabase'

const BASE = import.meta.env.VITE_UPLOAD_API_URL as string

export async function uploadImage(blob: Blob, filename: string): Promise<string> {
  const token = await getAccessToken()
  if (!token) throw new Error('Not signed in')

  const arrayBuffer = await blob.arrayBuffer()
  const buffer = new Uint8Array(arrayBuffer)

  const mimeType = blob.type || 'image/png'
  return window.api.uploadFile({ buffer, filename, mimeType, token, baseUrl: BASE })
}
