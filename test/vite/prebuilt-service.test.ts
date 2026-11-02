import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterAll, describe, expect, test } from "vitest";
import { nitro } from "../../src/vite.ts";

const { createBuilder } = (await import(
  process.env.NITRO_VITE_PKG || "vite"
)) as typeof import("vite");

describe("vite: service environment marked as built", () => {
  const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "nitro-prebuilt-service-")));
  const ssrEntry = join(rootDir, "entry-server.ts");

  afterAll(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  async function build(response: string, skipSsr: boolean) {
    writeFileSync(
      ssrEntry,
      `export default { fetch: () => new Response(${JSON.stringify(response)}) };`
    );
    const builder = await createBuilder({
      root: rootDir,
      configFile: false,
      logLevel: "warn",
      environments: {
        client: {},
        // not `index.mjs`, so the entry is only found by its name
        ssr: {
          build: {
            rollupOptions: { input: ssrEntry, output: { entryFileNames: "[name]-[hash].mjs" } },
          },
        },
      },
      plugins: [
        nitro({ preset: "standard", serverDir: "./", output: { dir: join(rootDir, ".output") } }),
        {
          name: "skip-ssr",
          buildApp: {
            order: "pre",
            async handler(builder) {
              builder.environments.ssr.isBuilt = skipSsr;
            },
          },
        },
      ],
    });
    await builder.buildApp();
  }

  test("uses the existing output of a service marked as built", async () => {
    await build("first build", false);
    await build("not built", true);

    const { fetch } = await import(join(rootDir, ".output/server/index.mjs")).then(
      (m) => m.default
    );
    const res = await fetch(new Request("http://localhost/"));
    expect(await res.text()).toBe("first build");
  }, 60_000);
});
