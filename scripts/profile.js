#!/usr/bin/env node
// CPU profile of the server under a short, realistic load.
//   npm run profile [-- --requests=2000 --concurrency=20]
// Starts src/server.js with --cpu-prof on a free port, sends a mix of read and
// write requests, prints latency percentiles per route, then stops the server so
// Node writes the profile to .dev/profiles/. Open the .cpuprofile file in Chrome
// DevTools (Performance > Load profile) or https://www.speedscope.app.
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

export const PROFILE_DIR = '.dev/profiles';

/**
 * Requests per round: [label, method, path, user, body].
 * @type {[string, string, string, string | null, unknown][]}
 */
export const REQUEST_MIX = [
  ['GET /api/listings', 'GET', '/api/listings', 'u1', undefined],
  ['GET /api/listings?q', 'GET', '/api/listings?q=camera&status=on_sale', null, undefined],
  ['GET /api/listings/:id', 'GET', '/api/listings/l2', 'u1', undefined],
  ['PUT /api/listings/:id/favorite', 'PUT', '/api/listings/l2/favorite', 'u1', undefined],
  ['GET /api/me/favorites', 'GET', '/api/me/favorites', 'u1', undefined],
  ['DELETE /api/listings/:id/favorite', 'DELETE', '/api/listings/l2/favorite', 'u1', undefined],
  ['POST /api/listings', 'POST', '/api/listings', 'u3', { title: 'Profiled lamp', priceYen: 1200 }],
];

/**
 * @param {number[]} values
 * @param {number} p between 0 and 1
 */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** @param {string} base */
async function waitForHealth(base) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The server did not become healthy within 5 seconds.');
}

/**
 * @param {string} base
 * @param {number} total
 * @param {number} concurrency
 */
async function runLoad(base, total, concurrency) {
  /** @type {Map<string, number[]>} */
  const latencies = new Map();
  let next = 0;
  const worker = async () => {
    while (next < total) {
      const [label, method, path, userId, body] = REQUEST_MIX[next % REQUEST_MIX.length];
      next += 1;
      const started = performance.now();
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(userId ? { 'x-user-id': userId } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      await res.arrayBuffer();
      latencies.set(label, [...(latencies.get(label) ?? []), performance.now() - started]);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return latencies;
}

/**
 * @param {string[]} args
 * @param {string} name
 * @param {number} fallback
 */
function numberOption(args, name, fallback) {
  const raw = args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  return raw === undefined ? fallback : Number(raw);
}

async function main() {
  const args = process.argv.slice(2);
  const total = numberOption(args, 'requests', 2000);
  const concurrency = numberOption(args, 'concurrency', 20);
  mkdirSync(PROFILE_DIR, { recursive: true });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--cpu-prof', `--cpu-prof-dir=${PROFILE_DIR}`, 'src/server.js'], {
    env: { ...process.env, PORT: String(port), LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const exited = new Promise((resolve) => server.once('exit', resolve));
  try {
    await waitForHealth(base);
    const started = performance.now();
    const latencies = await runLoad(base, total, concurrency);
    const seconds = (performance.now() - started) / 1000;
    console.log(`${total} requests, concurrency ${concurrency}: ${(total / seconds).toFixed(0)} req/s\n`);
    console.log('route                              p50 ms   p95 ms   max ms');
    for (const [label, values] of latencies) {
      const cells = [0.5, 0.95, 1].map((p) => percentile(values, p).toFixed(2).padStart(8));
      console.log(`${label.padEnd(33)}${cells.join(' ')}`);
    }
  } finally {
    server.kill('SIGTERM');
    await exited;
  }
  const newest = readdirSync(PROFILE_DIR)
    .filter((f) => f.endsWith('.cpuprofile'))
    .map((f) => join(PROFILE_DIR, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  console.log(`\nCPU profile: ${newest}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
