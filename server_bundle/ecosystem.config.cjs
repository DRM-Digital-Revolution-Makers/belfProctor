// PM2 config: 20 clients, target 50-70 MB (flat, no growth with clients)
module.exports = {
  apps: [
    {
      name: "belfproctor-server",
      script: "dist/index.js",
      node_args: "--max-old-space-size=256 --expose-gc",
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      exp_backoff_restart_delay: 10000,
      max_restarts: 9999,
      env: {
        NODE_ENV: "production",
        NO_DB: "1",
        PORT: "8080",
        STORE_TAIL_BYTES: "4096",
        HEARTBEAT_TAIL_BYTES: "32768",
        RATE_LIMIT_MAX: "600",
        DISABLE_BOOT_BACKFILL: "1",
        BOOT_BACKFILL_DELAY_MS: "50",
        DISABLE_FILE_LOGS: "1",
        DISABLE_CLIENT_LOGS: "1",
        DISABLE_RETENTION: "1",
        DISABLE_TIMESHEET_FILES: "1",
        APPEND_FLUSH_INTERVAL_MS: "500",
        APPEND_MAX_BUFFER_BYTES: "262144",
      },
    },
  ],
};
