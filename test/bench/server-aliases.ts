// Repro for the `nitro:server-aliases` resolveId cost: builds a Nitro-only fixture with the
// Vite builder, a Nuxt-like alias map and many server modules. Each build runs in a fresh
// process (cold, like `nitro build`), and the median of RUNS reports the build wall time, the
// CPU time spent below the `nitro:server-aliases` resolveId hook (inclusive) and the self-time
// of pathe's `normalizeAliases` (all callers).
//
//   pnpm stub && node test/bench/server-aliases.ts
//
// Env: RUNS (default 7), ALIASES (default 60), MODULES (default 600).
import { execFileSync } from "node:child_process";
import { Session } from "node:inspector/promises";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "pathe";

const RUNS = Number(process.env.RUNS || 7);
const ALIASES = Number(process.env.ALIASES || 60);
const MODULES = Number(process.env.MODULES || 600);

const rootDir = fileURLToPath(new URL(".tmp/server-aliases", import.meta.url));

interface Result {
  wallMs: number;
  hookMs: number;
  normalizeMs: number;
}

if (process.argv[2] === "--child") {
  console.log(JSON.stringify(await buildOnce()));
} else {
  await writeFixture();
  const results: Result[] = [];
  for (let run = 1; run <= RUNS; run++) {
    const output = execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--child"], {
      encoding: "utf8",
    });
    const result: Result = JSON.parse(output.trim().split("\n").pop()!);
    results.push(result);
    console.log(`run ${run}: ${format(result)}`);
  }
  const med = (key: keyof Result) => median(results.map((r) => r[key]));
  console.log(
    `median of ${RUNS} (${ALIASES} aliases, ${MODULES} modules): ${format({
      wallMs: med("wallMs"),
      hookMs: med("hookMs"),
      normalizeMs: med("normalizeMs"),
    })}`
  );
}

async function writeFixture() {
  await rm(rootDir, { recursive: true, force: true });
  await mkdir(join(rootDir, "lib"), { recursive: true });
  for (let i = 0; i < MODULES; i++) {
    const last = i + 1 === MODULES;
    await writeFile(
      join(rootDir, "lib", `m${i}.ts`),
      (last ? "" : `import { m${i + 1} } from "#lib/m${i + 1}.ts";\n`) +
        `export const m${i} = () => ${last ? "0" : `m${i + 1}() + 1`};\n`
    );
  }
  await writeFile(
    join(rootDir, "server.ts"),
    `import { m0 } from "#lib/m0.ts";\nexport default { fetch: () => new Response(String(m0())) };\n`
  );
}

async function buildOnce(): Promise<Result> {
  const { build, createNitro, prepare } = await import("../../src/builder.ts");
  // Shaped like a Nuxt app: root aliases, `#` aliases chained through them, and a builtin
  const alias: Record<string, string> = {
    "~": rootDir,
    "@": rootDir,
    "~~": rootDir,
    "@@": rootDir,
    "#lib": "~/lib",
    events: "node:events",
  };
  for (let i = Object.keys(alias).length; i < ALIASES; i++) {
    alias[`#alias-${i}`] = `~/aliases/${i}`;
  }
  const nitro = await createNitro({
    rootDir,
    preset: "node",
    builder: "vite",
    alias,
    logLevel: 0,
    output: { dir: join(rootDir, ".output") },
  });
  await prepare(nitro);

  const session = new Session();
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.setSamplingInterval", { interval: 100 });
  await session.post("Profiler.start");
  const start = performance.now();
  await build(nitro);
  const wallMs = performance.now() - start;
  const { profile } = await session.post("Profiler.stop");
  session.disconnect();
  await nitro.close();
  return { wallMs, ...profileTimes(profile) };
}

interface Profile {
  nodes: { id: number; callFrame: { functionName: string; url: string }; children?: number[] }[];
  samples?: number[];
  timeDeltas?: number[];
}

function profileTimes(profile: Profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes) {
    for (const child of node.children || []) {
      parents.set(child, node.id);
    }
  }
  const inHook = (id: number | undefined): boolean =>
    id !== undefined &&
    (nodes.get(id)!.callFrame.url.endsWith("/_server-aliases.ts") || inHook(parents.get(id)));
  let hookUs = 0;
  let normalizeUs = 0;
  for (const [i, id] of (profile.samples || []).entries()) {
    const delta = profile.timeDeltas![i]!;
    if (inHook(id)) {
      hookUs += delta;
    }
    if (nodes.get(id)!.callFrame.functionName === "normalizeAliases") {
      normalizeUs += delta;
    }
  }
  return { hookMs: hookUs / 1000, normalizeMs: normalizeUs / 1000 };
}

function format(r: Result): string {
  return `build ${r.wallMs.toFixed(0)} ms, nitro:server-aliases ${r.hookMs.toFixed(1)} ms, normalizeAliases self ${r.normalizeMs.toFixed(1)} ms`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
