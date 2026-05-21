// Firebase Messaging service worker — handles background push messages.
// Must live at /firebase-messaging-sw.js (root scope) for FCM to work.
// Config values are hardcoded here because service workers cannot read process.env.
// Replace the __PLACEHOLDER__ values with your actual Firebase project config,
// or use a build-time substitution script (e.g. sed in Makefile/Dockerfile).

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyArd0EsgwC1HqK51ijF1SFM4na4ABGb6Kg',
  authDomain:        'wims-bfp.firebaseapp.com',
  projectId:         'wims-bfp',
  storageBucket:     'wims-bfp.firebasestorage.app',
  messagingSenderId: '465171995576',
  appId:             '1:465171995576:web:9aa2403d8f6b9c4bb50d4d',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'BFP Report Update';
  const body  = payload.notification?.body  || 'Your report status has changed.';
  const reportId = payload.data?.report_id;

  self.registration.showNotification(title, {
    body,
    icon:  '/bfp-logo.png',
    badge: '/bfp-logo.png',
    data:  { reportId },
    actions: [{ action: 'track', title: 'Track Report' }],
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const reportId = event.notification.data?.reportId;
  const url = reportId ? `/report/tracking?id=${reportId}` : '/report/tracking';
  event.waitUntil(clients.openWindow(url));
});
