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
  seedTemplates: true,
});
await app.listen({ port: config.port, host: config.host });
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
