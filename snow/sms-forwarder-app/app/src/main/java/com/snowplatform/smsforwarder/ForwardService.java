package com.snowplatform.smsforwarder;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/**
 * A lightweight foreground service whose only job is to keep the app alive and
 * exempt from aggressive battery-killing, so the SMS receiver keeps working
 * reliably. It holds no logic itself.
 */
public class ForwardService extends Service {
    private static final String CHANNEL = "snow_sms_fwd";
    private static final int NOTIF_ID = 1;

    @Override
    public void onCreate() {
        super.onCreate();
        startForeground(NOTIF_ID, buildNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIF_ID, buildNotification());
        return START_STICKY;   // restart if the system kills us
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL, "Snow SMS Forwarder", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Keeps deposit SMS forwarding running");
            if (nm != null) nm.createNotificationChannel(ch);
        }
        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        return b.setContentTitle("Snow SMS active")
                .setContentText("Listening for Mobile Money deposit messages")
                .setSmallIcon(R.drawable.ic_launcher)
                .setOngoing(true)
                .build();
    }

    public static void start(Context ctx) {
        Intent i = new Intent(ctx, ForwardService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, ForwardService.class));
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
