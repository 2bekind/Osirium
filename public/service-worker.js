self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('push', (event) => {
  const data = event.data?.json?.() || { title: 'Osirium', body: 'Новое сообщение' }
  event.waitUntil(self.registration.showNotification(data.title || 'Osirium', {
    body: data.body || 'Новое сообщение',
    icon: '/osirium-icon.png',
    badge: '/osirium-icon.png',
    tag: data.tag,
    renotify: data.renotify === true,
    data: { url: data.url || '/' },
  }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existingClient = clients.find((client) => new URL(client.url).origin === self.location.origin)
    return existingClient ? existingClient.focus() : self.clients.openWindow(url)
  }))
})
