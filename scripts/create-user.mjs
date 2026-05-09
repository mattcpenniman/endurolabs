#!/usr/bin/env node

import { randomBytes, scryptSync } from "crypto";
import postgres from "postgres";

const PASSWORD_KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function getArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));

  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const email = getArg("email")?.trim().toLowerCase();
const password = getArg("password");
const name = getArg("name")?.trim() || null;
const databaseUrl =
  process.env.DATABASE_URL || "postgresql://enduro:endurodev@localhost:5432/endurolab";

if (!email || !password) {
  console.error("Usage: npm run user:create -- --email runner@example.com --password 'change-me' [--name 'Runner Name']");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { prepare: false });

try {
  const [existingUser] = await sql`
    select id from users where email = ${email} limit 1
  `;

  if (existingUser) {
    console.error(`User already exists: ${email}`);
    process.exit(1);
  }

  const [user] = await sql`
    insert into users (email, name, password_hash)
    values (${email}, ${name}, ${hashPassword(password)})
    returning id, email, name
  `;

  console.log(`Created user ${user.email} (${user.id})`);
} finally {
  await sql.end();
}
