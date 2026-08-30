package com.snowplatform.smsforwarder;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/**
 * A lightweight foreground service whose only job is to keep the app alive and
 * exempt from aggressive battery-killing, so the SMS receiver keeps working
 * reliably. It holds no logic itself.
 */
public class ForwardService extends Service {
    private static final String CHANNEL = "snow_sms_fwd";
    private static final int NOTIF_ID = 1;
    /** How often to look for a newer APK while running. */
    private static final long UPDATE_CHECK_MS = 6 * 60 * 60 * 1000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private String updateBanner = null;   // non-null once a newer version exists
    private Runnable updateTick;

    @Override
    public void onCreate() {
        super.onCreate();
        startForeground(NOTIF_ID, buildNotification());
        startUpdateChecks();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIF_ID, buildNotification());
        return START_STICKY;   // restart if the system kills us
    }

    @Override
    public void onDestroy() {
        if (updateTick != null) handler.removeCallbacks(updateTick);
        super.onDestroy();
    }

    /**
     * These phones sit untouched in a drawer forwarding SMS, so nobody would
     * ever see an update prompt inside the app. The ongoing notification this
     * service already shows is the one thing an admin does see, so it doubles
     * as the update banner.
     */
    private void startUpdateChecks() {
        updateTick = new Runnable() {
            @Override public void run() {
                UpdateChecker.checkAsync(ForwardService.this, new UpdateChecker.Callback() {
                    @Override public void onResult(boolean available, int latestCode, final String latestName) {
                        final String banner = available ? latestName : null;
                        handler.post(new Runnable() {
                            @Override public void run() {
                                boolean changed = (banner == null) != (updateBanner == null)
                                        || (banner != null && !banner.equals(updateBanner));
                                updateBanner = banner;
                                if (changed) refreshNotification();
                            }
                        });
                    }
                });
                handler.postDelayed(this, UPDATE_CHECK_MS);
            }
        };
        handler.post(updateTick);
    }

    private void refreshNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, buildNotification());
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL, "Snow SMS Forwarder", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Keeps deposit SMS forwarding running");
            if (nm != null) nm.createNotificationChannel(ch);
        }
        // Tapping the notification opens the app, where the update prompt and
        // the Download button live.
        PendingIntent tap = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        return b.setContentTitle(updateBanner == null
                        ? "Snow SMS active"
                        : "Snow SMS update available (" + updateBanner + ")")
                .setContentText(updateBanner == null
                        ? "Listening for Mobile Money deposit messages"
                        : "Still forwarding. Tap to update.")
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentIntent(tap)
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
