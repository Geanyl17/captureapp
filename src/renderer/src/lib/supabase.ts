import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const configured = Boolean(url && key)

// Only create the client if env vars are present — avoids crash on missing .env
let _client: SupabaseClient | null = null
function client(): SupabaseClient {
  if (!configured) throw new Error('Supabase is not configured — copy .env.example to .env and fill in your credentials')
  if (!_client) _client = createClient(url, key)
  return _client
}

export async function signIn(email: string, password: string) {
  const { data, error } = await client().auth.signInWithPassword({ email, password })
  if (error) throw error
  await window.api.storeSet('session', data.session)
  return data.session
}

export async function signOut() {
  await client().auth.signOut()
  await window.api.storeDelete('session')
}

export async function restoreSession() {
  if (!configured) return null
  const stored = (await window.api.storeGet('session')) as {
    access_token: string
    refresh_token: string
  } | null
  if (!stored) return null

  const { data, error } = await client().auth.setSession({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token
  })
  if (error) {
    await window.api.storeDelete('session')
    return null
  }
  if (data.session) await window.api.storeSet('session', data.session)
  return data.session
}

export async function getAccessToken(): Promise<string | null> {
  if (!configured) return null
  let { data } = await client().auth.getSession()
  // If the client has no in-memory session yet (e.g. an upload fires right after
  // launch, before the startup restore finished), restore from disk and retry.
  if (!data.session) {
    await restoreSession()
    data = (await client().auth.getSession()).data
  }
  return data.session?.access_token ?? null
}
