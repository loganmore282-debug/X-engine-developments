// pm2 process definition for the Petro backend on the Hostinger VPS.
//
// Chosen over a raw systemd unit because this VPS deploys by SSH + rsync,
// not a package manager: pm2 gives `pm2 reload` (zero-downtime, the process
// re-execs itself and only drops the listening socket for the handoff),
// log rotation via `pm2-logrotate`, and `pm2 startup` to survive a reboot
// without hand-writing a unit file. A systemd unit remains a reasonable
// alternative if the owner prefers it; nothing else in this pipeline
// depends on pm2 specifically.
//
// Run from petro/deploy/ on the VPS: `pm2 start ecosystem.config.js`.
// The working directory is set explicitly so pm2 can be started from any
// cwd (a cron entry, a fresh SSH session) and still find server.js.
module.exports = {
  apps: [
    {
      name: 'petro-server',
      script: '../server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      // The whole point of runTransaction being a fake, non-locking shim
      // (see petro/CLAUDE.md, "Money-safety invariants") is that money
      // credits are guarded by IN-PROCESS locks (withLock()). Cluster mode
      // or more than one instance would put two Node processes each holding
      // their own lock table, and the very race those locks exist to close
      // reopens. Never raise `instances` above 1 without redesigning that
      // locking to be cross-process (e.g. a real Mongo transaction, or a
      // Redis lock) first.
      env: {
        NODE_ENV: 'production',
        // PORT, MONGODB_URI, FIREBASE_SERVICE_ACCOUNT, ADMIN_KEY, and the
        // payment-gateway keys are NOT set here. They live in a .env file
        // pm2 loads separately (see deploy.sh / petro/CLAUDE.md) or in the
        // shell environment pm2 itself was started from -- never committed
        // to this repo.
      },
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 2000,
      out_file: '/root/.pm2/logs/petro-server-out.log',
      error_file: '/root/.pm2/logs/petro-server-error.log',
      time: true,
    },
  ],
};
