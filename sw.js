// TeamsterX Service Worker for Push Notifications
const CACHE_NAME = 'teamsterx-v1';

// Install event - cache essential resources
self.addEventListener('install', (event) => {
    console.log('[SW] Installing service worker...');
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating service worker...');
    event.waitUntil(clients.claim());
});

// Push notification event handler
self.addEventListener('push', (event) => {
    console.log('[SW] Push notification received');
    
    let data = {
        title: 'TeamsterX',
        body: 'You have a new notification',
        icon: '/img/favicon-circle.png',
        badge: '/img/favicon-circle.png',
        tag: 'teamsterx-notification',
        data: {}
    };

    // Parse push data if available
    if (event.data) {
        try {
            const payload = event.data.json();
            data = {
                title: payload.title || data.title,
                body: payload.body || data.body,
                icon: payload.icon || data.icon,
                badge: payload.badge || data.badge,
                tag: payload.tag || data.tag,
                data: payload.data || {}
            };
        } catch (e) {
            // If not JSON, use text
            data.body = event.data.text() || data.body;
        }
    }

    const options = {
        body: data.body,
        icon: data.icon,
        badge: data.badge,
        tag: data.tag,
        data: data.data,
        vibrate: [100, 50, 100],
        actions: [
            {
                action: 'open',
                title: 'Open TeamsterX'
            },
            {
                action: 'close',
                title: 'Dismiss'
            }
        ],
        requireInteraction: false
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification clicked:', event.action);
    event.notification.close();

    if (event.action === 'close') {
        return;
    }

    // Open or focus the app
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // Check if app is already open
                for (const client of clientList) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        // Navigate to specific route if provided in notification data
                        if (event.notification.data && event.notification.data.url) {
                            client.navigate(event.notification.data.url);
                        }
                        return client.focus();
                    }
                }
                // Open new window if not already open
                const url = event.notification.data?.url || '/';
                return clients.openWindow(url);
            })
    );
});

// Notification close handler
self.addEventListener('notificationclose', (event) => {
    console.log('[SW] Notification closed');
});

// Background sync (for offline support)
self.addEventListener('sync', (event) => {
    console.log('[SW] Background sync:', event.tag);
    if (event.tag === 'sync-notifications') {
        event.waitUntil(syncNotifications());
    }
});

async function syncNotifications() {
    // Placeholder for syncing notifications when back online
    console.log('[SW] Syncing notifications...');
}

// Handle messages from the main thread
self.addEventListener('message', (event) => {
    console.log('[SW] Message received:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
