import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSecretPath = path.resolve(__dirname, "../../secrets/turn_shared_secret");
const force = process.argv.includes("--force");
const targetPath = path.resolve(process.env.TURN_SHARED_SECRET_FILE || defaultSecretPath);

if (existsSync(targetPath) && !force) {
  console.error(`Secret file already exists at ${targetPath}. Pass --force to overwrite.`);
  process.exit(1);
}

mkdirSync(path.dirname(targetPath), { recursive: true });
const hexSecret = randomBytes(32).toString("hex");
writeFileSync(targetPath, `${hexSecret}\n`, { encoding: "utf8", mode: 0o600 });
try {
  chmodSync(targetPath, 0o600);
} catch {
  // Windows filesystems may ignore POSIX chmod modes cleanly.
}

console.info(`Generated 64-hex TURN shared secret at ${targetPath}`);
