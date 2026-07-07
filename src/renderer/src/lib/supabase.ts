import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
)

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error

  // Persist session to electron-store so it survives app restarts
  await window.api.storeSet('session', data.session)
  return data.session
}

export async function signOut() {
  await supabase.auth.signOut()
  await window.api.storeDelete('session')
}

export async function restoreSession() {
  const stored = (await window.api.storeGet('session')) as {
    access_token: string
    refresh_token: string
  } | null

  if (!stored) return null

  const { data, error } = await supabase.auth.setSession({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token
  })

  if (error) {
    await window.api.storeDelete('session')
    return null
  }

  // Persist refreshed session
  if (data.session) {
    await window.api.storeSet('session', data.session)
  }

  return data.session
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
