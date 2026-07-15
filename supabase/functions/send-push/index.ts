import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!url || !serviceRole || !vapidPublicKey || !vapidPrivateKey) return response({ error: 'Push is not configured' }, 500)

  const admin = createClient(url, serviceRole)
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return response({ error: 'Not authenticated' }, 401)
  const { data: userResult } = await admin.auth.getUser(token)
  const user = userResult.user
  if (!user) return response({ error: 'Not authenticated' }, 401)

  try {
    const { message_id: messageId } = await request.json()
    if (typeof messageId !== 'string') return response({ error: 'Invalid message' }, 400)
    const { data: message } = await admin.from('messages').select('id, conversation_id, sender_id, body, image_path, audio_path').eq('id', messageId).maybeSingle()
    if (!message || message.sender_id !== user.id) return response({ error: 'Forbidden' }, 403)

    const { data: sender } = await admin.from('profiles').select('display_name, username').eq('id', user.id).maybeSingle()
    const { data: recipients } = await admin.from('conversation_members').select('user_id').eq('conversation_id', message.conversation_id).neq('user_id', user.id)
    const recipientIds = (recipients ?? []).map((recipient) => recipient.user_id)
    if (!recipientIds.length) return response({ delivered: 0 })

    const { data: preferences } = await admin.from('direct_conversation_preferences').select('user_id, muted, blocked_at').eq('conversation_id', message.conversation_id).in('user_id', recipientIds)
    const eligibleIds = recipientIds.filter((recipientId) => {
      const preference = preferences?.find((item) => item.user_id === recipientId)
      return !preference?.muted && !preference?.blocked_at
    })
    if (!eligibleIds.length) return response({ delivered: 0 })

    const { data: subscriptions } = await admin.from('push_subscriptions').select('endpoint, user_id, p256dh, auth').in('user_id', eligibleIds)
    const preview = message.image_path ? 'Фотография' : message.audio_path ? 'Голосовое сообщение' : message.body
    const payload = JSON.stringify({
      title: sender?.display_name || sender?.username || 'Osirium',
      body: preview.slice(0, 160),
      url: '/',
    })
    webpush.setVapidDetails('mailto:push@osirium.lol', vapidPublicKey, vapidPrivateKey)
    let delivered = 0
    await Promise.all((subscriptions ?? []).map(async (subscription) => {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload)
        delivered += 1
      } catch (error) {
        const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 0
        if (statusCode === 404 || statusCode === 410) await admin.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
      }
    }))
    return response({ delivered })
  } catch {
    return response({ error: 'Push failed' }, 500)
  }
})
