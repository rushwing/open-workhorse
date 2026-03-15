// All runtime config is read from .env via --env-file-if-exists=.env
// Do NOT hardcode tokens or environment-specific values here.
module.exports = {
  apps: [
    {
      name: "open-workhorse",
      cwd: __dirname,
      script: "node",
      args: "--env-file-if-exists=.env --import tsx src/index.ts",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      out_file: "runtime/pm2-out.log",
      error_file: "runtime/pm2-error.log",
      time: true
    }
  ]
};
