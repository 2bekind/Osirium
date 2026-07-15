self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('push', (event) => {
  const data = event.data?.json?.() || { title: 'Osirium', body: 'Новое сообщение' }
  event.waitUntil(self.registration.showNotification(data.title || 'Osirium', {
    body: data.body || 'Новое сообщение',
    icon: '/osirium-icon.png',
    badge: '/osirium-icon.png',
    data: { url: data.url || '/' },
  }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || '/'))
})
