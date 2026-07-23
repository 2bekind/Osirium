import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function moscowDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = (name: string) => parts.find((part) => part.type === name)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  const expectedSecret = Deno.env.get('CRON_SECRET')
  if (!expectedSecret || request.headers.get('x-cron-secret') !== expectedSecret) return response({ error: 'Forbidden' }, 403)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!url || !serviceRole || !publicKey || !privateKey) return response({ error: 'Push is not configured' }, 500)

  const admin = createClient(url, serviceRole)
  const today = moscowDate().slice(5)
  const { data: birthdayProfiles, error } = await admin.from('profiles').select('id, display_name, username, birthday').not('birthday', 'is', null)
  if (error) return response({ error: 'Unable to load birthdays' }, 500)
  const celebrants = (birthdayProfiles ?? []).filter((profile) => profile.birthday?.slice(5) === today)
  if (!celebrants.length) return response({ delivered: 0, celebrants: 0 })

  const { data: subscriptions } = await admin.from('push_subscriptions').select('endpoint, user_id, p256dh, auth')
  webpush.setVapidDetails('mailto:push@osirium.lol', publicKey, privateKey)
  let delivered = 0
  await Promise.all((subscriptions ?? []).map(async (subscription) => {
    const names = celebrants.filter((profile) => profile.id !== subscription.user_id).map((profile) => profile.display_name || profile.username || 'пользователь')
    if (!names.length) return
    const payload = JSON.stringify({ title: 'Osirium', body: names.length === 1 ? `Сегодня день рождения у ${names[0]} 🎉` : `Сегодня дни рождения: ${names.join(', ')}`, url: '/', tag: `birthdays-${moscowDate()}` })
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload)
      delivered += 1
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 0
      if (statusCode === 404 || statusCode === 410) await admin.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
    }
  }))
  return response({ delivered, celebrants: celebrants.length })
})
