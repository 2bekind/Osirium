import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)

  try {
    const { action, username: rawUsername, password } = await request.json()
    const username = String(rawUsername || '').trim().toLowerCase()
    if (!['register', 'login'].includes(action)) return response({ error: 'Неверное действие.' }, 400)
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return response({ error: 'Логин должен содержать от 3 до 24 символов: латиница, цифры или _.' }, 400)
    if (typeof password !== 'string' || password.length < 8) return response({ error: 'Пароль должен состоять минимум из 8 символов.' }, 400)

    const url = Deno.env.get('SUPABASE_URL')!
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const inbox = Deno.env.get('AUTH_EMAIL_INBOX')
    if (!inbox || !inbox.includes('@')) return response({ error: 'Сервер входа ещё не настроен.' }, 500)

    const admin = createClient(url, serviceRole)
    let internalEmail: string

    if (action === 'register') {
      const [localPart, domain] = inbox.split('@')
      internalEmail = `${localPart}+osirium-${username}@${domain}`
      const { data, error } = await admin.auth.admin.createUser({
        email: internalEmail,
        password,
        email_confirm: true,
        user_metadata: { username },
      })
      if (error || !data.user) return response({ error: error?.message === 'User already registered' ? 'Этот логин уже занят.' : 'Не удалось создать аккаунт.' }, 400)
      const { error: profileError } = await admin.from('profiles').upsert({ id: data.user.id, display_name: username, username })
      if (profileError) return response({ error: 'Аккаунт создан, но профиль не удалось подготовить.' }, 500)
    } else {
      const { data: profile } = await admin.from('profiles').select('id, is_banned, ban_reason').eq('username', username).maybeSingle()
      if (!profile) return response({ error: 'Логин или пароль неверны.' }, 400)
      if (profile.is_banned) return response({ error: profile.ban_reason ? `Аккаунт заблокирован: ${profile.ban_reason}` : 'Аккаунт заблокирован администратором.' }, 403)
      const { data: userResult } = await admin.auth.admin.getUserById(profile.id)
      if (!userResult.user?.email) return response({ error: 'Логин или пароль неверны.' }, 400)
      internalEmail = userResult.user.email
    }

    const tokenResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: internalEmail, password }),
    })
    const session = await tokenResponse.json()
    if (!tokenResponse.ok) return response({ error: 'Логин или пароль неверны.' }, 400)
    return response({ session })
  } catch {
    return response({ error: 'Сервер входа временно недоступен.' }, 500)
  }
})
