#!/usr/bin/env node
/**
 * Run a .sql file against the database in DATABASE_ADMIN_URL (falling back to
 * DATABASE_URL), using psql.
 *
 * Why this exists: guards.sql and guards.verify.sql are plain SQL — they
 * contain DO blocks, CREATE FUNCTION bodies with $$ quoting and psql
 * meta-commands, none of which survive being split on ";" and pushed through a
 * driver. psql is the only thing that reads them correctly. This wrapper just
 * locates psql and feeds it the credentials from .env, so the documented
 * commands work on Windows and Unix without the caller knowing an install path.
 *
 * Usage:
 *   node scripts/run-sql.js apps/api/prisma/guards.sql
 *   node scripts/run-sql.js --url "$DATABASE_URL" apps/api/prisma/guards.verify.sql
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- Load .env (repo root) without adding a dependency ---------------------
const ROOT = path.resolve(__dirname, '..');
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip surrounding quotes; only strip a trailing # comment when the value
    // was NOT quoted, so a password containing '#' survives.
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length > 1) ||
      (val.startsWith("'") && val.endsWith("'") && val.length > 1)
    ) {
      val = val.slice(1, -1);
    } else {
      const hash = val.indexOf(' #');
      if (hash !== -1) val = val.slice(0, hash).trim();
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

// --- Args -------------------------------------------------------------------
const argv = process.argv.slice(2);
let url = null;
let asApp = false;
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--url') url = argv[++i];
  // Guard verification is only meaningful as the least-privilege runtime role:
  // the owner bypasses the column grants the guards rely on, so running the
  // checks as the owner would report false passes.
  else if (argv[i] === '--as-app') asApp = true;
  else files.push(argv[i]);
}
if (files.length !== 1) {
  console.error('usage: node scripts/run-sql.js [--url <conn>] [--as-app] <file.sql>');
  process.exit(2);
}
const sqlFile = path.resolve(ROOT, files[0]);
if (!fs.existsSync(sqlFile)) {
  console.error('No such SQL file: ' + sqlFile);
  process.exit(2);
}

// DDL and grants must run as the owner, so prefer the admin URL — except for
// --as-app, where the whole point is to exercise the runtime role's limits.
url = url || (asApp ? process.env.DATABASE_URL : process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL);
if (!url) {
  console.error('Set DATABASE_ADMIN_URL or DATABASE_URL (repo-root .env), or pass --url.');
  process.exit(2);
}

// --- Locate psql ------------------------------------------------------------
function findPsql() {
  if (process.env.PSQL) return process.env.PSQL;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['psql'], {
    encoding: 'utf8',
  });
  if (probe.status === 0) {
    const first = probe.stdout.split(/\r?\n/).find((l) => l.trim());
    if (first) return first.trim();
  }
  if (process.platform === 'win32') {
    // Standard EDB installer layout; newest major version first.
    for (const base of ['C:/Program Files/PostgreSQL', 'C:/Program Files (x86)/PostgreSQL']) {
      if (!fs.existsSync(base)) continue;
      const versions = fs
        .readdirSync(base)
        .filter((d) => /^\d+$/.test(d))
        .sort((a, b) => Number(b) - Number(a));
      for (const v of versions) {
        const exe = path.join(base, v, 'bin', 'psql.exe');
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

const psql = findPsql();
if (!psql) {
  console.error(
    'psql not found. Add it to PATH or set PSQL to its full path, e.g.\n' +
      '  PSQL="C:/Program Files/PostgreSQL/18/bin/psql.exe" npm run db:guards',
  );
  process.exit(2);
}

// --- Normalize the connection string for libpq ------------------------------
// Prisma URLs carry `?schema=public`, which libpq rejects as an unknown query
// parameter. Translate it to the equivalent `options=-csearch_path=...` that
// psql understands, and drop other Prisma-only parameters, so ONE url in .env
// serves both tools.
function toLibpqUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { url: raw, schema: null }; // key=value DSN form; pass through
  }
  const PRISMA_ONLY = new Set([
    'schema',
    'connection_limit',
    'pool_timeout',
    'socket_timeout',
    'pgbouncer',
    'statement_cache_size',
  ]);
  const schema = u.searchParams.get('schema');
  for (const k of [...u.searchParams.keys()]) {
    if (PRISMA_ONLY.has(k)) u.searchParams.delete(k);
  }
  return { url: u.toString(), schema };
}

const { url: pgUrl, schema } = toLibpqUrl(url);

// --- Run --------------------------------------------------------------------
// The connection string is passed as a single argument rather than assembled
// into a shell command, so a password with shell metacharacters is safe.
console.log('psql : ' + psql);
console.log('file : ' + path.relative(ROOT, sqlFile));
console.log('db   : ' + pgUrl.replace(/\/\/([^:]+):[^@]*@/, '//$1:***@'));

const args = ['-v', 'ON_ERROR_STOP=1'];
if (schema) args.push('-c', 'SET search_path TO ' + schema);
args.push('-d', pgUrl, '-f', sqlFile);

const res = spawnSync(psql, args, { stdio: 'inherit' });
process.exit(res.status === null ? 1 : res.status);
