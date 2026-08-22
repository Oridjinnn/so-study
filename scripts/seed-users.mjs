// Create / update the trusted users. There is NO signup route by design, so this
// script is the only way a user comes into existence.
//
//   node scripts/seed-users.mjs <name> <passphrase> [displayName]
//   SEED_USERS="habel:passphrase satu,dini:passphrase dua" node scripts/seed-users.mjs
//
// Re-running with the same name UPDATES that user's passphrase (a rotation), it
// does not create a duplicate — `User.name` is unique.
//
// Plain .mjs, not TypeScript: it must run with bare `node` on a laptop and in a
// one-off Vercel shell without adding tsx/ts-node to the dependency list.
//
// The passphrase is never printed and never logged. It is hashed with PBKDF2
// (600k iterations, SHA-256) by src/lib/auth.ts — this script reimplements the
// hash with node:crypto instead of importing the TypeScript module, because
// `node` cannot import .ts and duplicating ~15 lines is cheaper than adding a
// build step for a script that runs twice a year. THE FORMAT MUST MATCH
// src/lib/auth.ts (`pbkdf2$sha256$<iterations>$<saltB64u>$<hashB64u>`); there is
// a test asserting exactly that (src/lib/auth.test.ts).

import { PrismaClient } from "@prisma/client";
import { pbkdf2Sync, randomBytes } from "node:crypto";

const PBKDF2_ITERATIONS = 600_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const MIN_PASSPHRASE_LENGTH = 12;

const b64u = (buf) => buf.toString("base64url");

function hashPassphrase(passphrase) {
  const salt = randomBytes(SALT_BYTES);
  const hash = pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_BYTES, "sha256");
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${b64u(salt)}$${b64u(hash)}`;
}

/** `name:passphrase` pairs from SEED_USERS, or a single triple from argv. */
function parseRequested() {
  const [name, passphrase, displayName] = process.argv.slice(2);
  if (name && passphrase) return [{ name, passphrase, displayName: displayName ?? null }];

  const raw = process.env.SEED_USERS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(":");
      if (idx < 0) throw new Error(`SEED_USERS entry "${entry}" is not name:passphrase`);
      return {
        name: entry.slice(0, idx).trim(),
        passphrase: entry.slice(idx + 1),
        displayName: null,
      };
    });
}

const prisma = new PrismaClient();

try {
  const requested = parseRequested();
  if (requested.length === 0) {
    console.error(
      "usage: node scripts/seed-users.mjs <name> <passphrase> [displayName]\n" +
        '   or: SEED_USERS="name:passphrase,name2:passphrase2" node scripts/seed-users.mjs',
    );
    process.exitCode = 1;
  } else {
    for (const { name, passphrase, displayName } of requested) {
      if (!name) throw new Error("user name must not be empty");
      // A short passphrase is the entire attack surface: /api/auth/login is public
      // by necessity. Refuse rather than warn.
      if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        throw new Error(
          `passphrase for "${name}" is too short (${passphrase.length} chars, minimum ${MIN_PASSPHRASE_LENGTH})`,
        );
      }
      const passphraseHash = hashPassphrase(passphrase);
      const user = await prisma.user.upsert({
        where: { name },
        create: { name, displayName, passphraseHash },
        // Only the passphrase rotates on re-run; a displayName of null must not
        // wipe one that was set earlier.
        update: { passphraseHash, ...(displayName ? { displayName } : {}) },
        select: { id: true, name: true },
      });
      console.log(`ok  ${user.name}  (${user.id})`);
    }
    const total = await prisma.user.count();
    console.log(`users in database: ${total}`);
  }
} finally {
  await prisma.$disconnect();
}
