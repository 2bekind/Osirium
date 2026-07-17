const clientStates = new Map()

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'osirium-client-state' && event.source?.id) {
    clientStates.set(event.source.id, {
      visible: data.visible === true,
      conversationId: typeof data.conversationId === 'string' ? data.conversationId : null,
    })
    return
  }
  if (data.type === 'osirium-clear-notifications' && Array.isArray(data.tags)) {
    event.waitUntil(Promise.all(data.tags.map(async (tag) => {
      const notifications = await self.registration.getNotifications({ tag })
      notifications.forEach((notification) => notification.close())
    })))
  }
})

async function hasOpenConversation(conversationId) {
  if (!conversationId) return false
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const visibleWindows = windows.filter((client) => client.visibilityState === 'visible')
  if (!visibleWindows.length) return false
  if (visibleWindows.some((client) => {
    const state = clientStates.get(client.id)
    return state?.visible && state.conversationId === conversationId
  })) return true
  visibleWindows.forEach((client) => client.postMessage({ type: 'osirium-request-active-conversation' }))
  await new Promise((resolve) => setTimeout(resolve, 90))
  return visibleWindows.some((client) => {
    const state = clientStates.get(client.id)
    return state?.visible && state.conversationId === conversationId
  })
}

self.addEventListener('push', (event) => {
  const data = event.data?.json?.() || { title: 'Osirium', body: 'Новое сообщение' }
  event.waitUntil((async () => {
    if (await hasOpenConversation(data.conversationId)) {
      if (data.tag) {
        const notifications = await self.registration.getNotifications({ tag: data.tag })
        notifications.forEach((notification) => notification.close())
      }
      return
    }
    await self.registration.showNotification(data.title || 'Osirium', {
      body: data.body || 'Новое сообщение',
      icon: '/osirium-icon.png',
      badge: '/osirium-icon.png',
      tag: data.tag,
      renotify: data.renotify === true,
      data: { url: data.url || '/', conversationId: data.conversationId || null },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existingClient = clients.find((client) => new URL(client.url).origin === self.location.origin)
    if (existingClient) {
      existingClient.postMessage({ type: 'osirium-open-conversation', conversationId: event.notification.data?.conversationId || null })
      return existingClient.focus()
    }
    return self.clients.openWindow(url)
  }))
})
