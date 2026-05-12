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

function printUsage() {
  console.error(`Usage:
  npm run user:list
  npm run user:list -- --json
  npm run user:set-password -- --email runner@example.com --password 'change-me'
  npm run user:set-password -- --id user-uuid --password 'change-me'`);
}

async function listUsers(sql, asJson) {
  const rows = await sql`
    select
      id,
      email,
      name,
      current_plan_id as "currentPlanId",
      created_at as "createdAt",
      updated_at as "updatedAt"
    from users
    order by created_at asc, email asc
  `;

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log("No users found.");
    return;
  }

  console.table(
    rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name ?? "",
      currentPlanId: row.currentPlanId ?? "",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
  );
}

async function setUserPassword(sql) {
  const id = getArg("id")?.trim();
  const email = getArg("email")?.trim().toLowerCase();
  const password = getArg("password");

  if ((!id && !email) || !password) {
    printUsage();
    process.exit(1);
  }

  if (id && email) {
    console.error("Pass either --id or --email, not both.");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const lookup = id
    ? await sql`select id, email from users where id = ${id} limit 1`
    : await sql`select id, email from users where email = ${email} limit 1`;
  const user = lookup[0];

  if (!user) {
    console.error(id ? `User not found for id: ${id}` : `User not found for email: ${email}`);
    process.exit(1);
  }

  await sql.begin(async (tx) => {
    await tx`
      update users
      set password_hash = ${hashPassword(password)}, updated_at = now()
      where id = ${user.id}
    `;

    await tx`
      delete from sessions
      where user_id = ${user.id}
    `;
  });

  console.log(`Updated password for ${user.email} (${user.id}) and revoked active sessions.`);
}

const databaseUrl =
  process.env.DATABASE_URL || "postgresql://enduro:endurodev@localhost:5432/endurolab";
const command = process.argv[2];
const sql = postgres(databaseUrl, { prepare: false });

try {
  if (command === "list") {
    await listUsers(sql, process.argv.includes("--json"));
  } else if (command === "set-password") {
    await setUserPassword(sql);
  } else {
    printUsage();
    process.exit(1);
  }
} finally {
  await sql.end();
}
