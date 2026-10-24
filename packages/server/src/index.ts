import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

// Command-line options, then environment variables (see config.ts).
const config = loadConfig();

const { app, accounts, initialAdminPassword, seededTemplates } = await buildApp(config.workspace, {
  logger: true,
  port: config.port,
  basePath: config.basePath,
  publicUrl: config.publicUrl,
  adminPassword: config.adminPassword,
  trustProxy: config.trustProxy,
  mcpStdio: config.mcpStdio,
  seedTemplates: true,
});
await app.listen({ port: config.port, host: config.host });
// docker stop / Ctrl+C: finish the requests in progress, then exit (as PID 1 in a container nothing else would).
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    app.log.info(`${signal}: shutting down`);
    // Live-update streams (SSE) stay open: do not wait for them more than a few seconds.
    setTimeout(() => process.exit(0), 3000).unref();
    void app.close().finally(() => process.exit(0));
  });
}
app.log.info(`Sourcebook workspace: ${config.workspace}`);
app.log.info(`Sourcebook is at ${config.publicUrl}/`);
if (seededTemplates.length) app.log.info(`Templates added to the workspace: ${seededTemplates.join(", ")}`);
if (initialAdminPassword) {
  // Shown once: only its hash is stored. It must be changed at the first sign-in.
  console.log(
    [
      "",
      "  First start: owner account created",
      `    username: ${accounts.owner().username}`,
      `    password: ${initialAdminPassword}`,
      "  Sign in and choose a new password (SOURCEBOOK_ADMIN_PASSWORD sets it instead of generating one).",
      "",
    ].join("\n"),
  );
}
