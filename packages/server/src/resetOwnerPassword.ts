/**
 * Sets a new temporary password for an owner account (forgotten password, lost first-start password):
 *   pnpm --filter @sourcebook/server reset-owner-password [--workspace <dir>] [--user <username>]
 * Uses SOURCEBOOK_ADMIN_PASSWORD if set, otherwise generates one and prints it. The owner must change it at the
 * next sign-in; their sessions end. Restart the Sourcebook server afterwards (it keeps accounts in memory).
 */
import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { AccountStore, generatePassword } from "./store/AccountStore.js";

const { values } = parseArgs({ options: { workspace: { type: "string" }, user: { type: "string" } }, strict: false });
const config = loadConfig(values.workspace ? ["--workspace", String(values.workspace)] : []);
const accounts = new AccountStore(config.workspace);
const { generatedPassword } = await accounts.load({ owner: { name: "Administrator", username: "admin" }, password: config.adminPassword });
const username = values.user ? String(values.user) : accounts.owner().username;
const target = accounts.getUser(username);
if (!target || target.role !== "owner") {
  console.error(`No owner account "${username}" in ${accounts.dir}.`);
  process.exit(1);
}
const password = generatedPassword ?? config.adminPassword ?? generatePassword();
await accounts.updateUser(username, { password, disabled: false });
console.log(`New temporary password for ${username} (${config.workspace}): ${password}`);
console.log("Sign in and choose a new one. Restart the Sourcebook server if it is running.");
