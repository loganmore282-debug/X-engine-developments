self.addEventListener('install',function(){self.skipWaiting();});
self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim());});
self.addEventListener('fetch',function(){});
self.addEventListener('push',function(e){
  var d={}; try{ d=e.data.json(); }catch(_){}
  var n=d.notification||d||{};
  e.waitUntil(self.registration.showNotification(n.title||'Chronova Admin',{body:n.body||'',icon:'/icon-192.png',data:d.data||{}}));
});
self.addEventListener('notificationclick',function(e){
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
