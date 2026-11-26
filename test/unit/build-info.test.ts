import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "pathe";
import { rolldown } from "rolldown";
import type { RollupOutput } from "rollup";
import type { Nitro } from "nitro/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeBuildInfo } from "../../src/build/info.ts";

describe("writeBuildInfo", () => {
  let rootDir: string;
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    rootDir = await realpath(await mkdtemp(join(tmpdir(), "nitro-build-info-")));
    warn = vi.fn();
    await writeFile(join(rootDir, "server.ts"), `export const server = "nitro server";\n`);
    await writeFile(join(rootDir, "server.js"), `export const server = "unrelated entry";\n`);
    await writeFile(join(rootDir, "exposed.ts"), `export const exposed = "exposed";\n`);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(rootDir, { recursive: true, force: true });
  });

  function createNitro() {
    return {
      logger: { warn },
      options: {
        rootDir,
        entry: join(rootDir, "server"),
        output: {
          dir: join(rootDir, ".output"),
          serverDir: join(rootDir, ".output/server"),
          publicDir: join(rootDir, ".output/public"),
        },
        commands: {},
      },
    } as unknown as Nitro;
  }

  async function buildInfoFor(entries: { fileName: string; facadeModuleId: string | null }[]) {
    const output = {
      output: entries.map((entry) => ({ type: "chunk", isEntry: true, ...entry })),
    } as unknown as RollupOutput;

    const info = await writeBuildInfo(createNitro(), output);
    const saved = JSON.parse(await readFile(join(rootDir, ".output/nitro.json"), "utf8"));
    expect(saved.serverEntry).toBe(info.serverEntry);
    return info;
  }

  it("records Nitro's entry when another entry chunk appears first", async () => {
    const info = await buildInfoFor([
      { fileName: "_chunks/app.mjs", facadeModuleId: join(rootDir, "app/app.ts") },
      { fileName: "index.mjs", facadeModuleId: join(rootDir, "server.ts") },
    ]);
    expect(info.serverEntry).toBe("server/index.mjs");
    expect(warn).not.toHaveBeenCalled();
  });

  it("dates the build with SOURCE_DATE_EPOCH", async () => {
    vi.stubEnv("SOURCE_DATE_EPOCH", "1700000000");
    const info = await buildInfoFor([
      { fileName: "index.mjs", facadeModuleId: join(rootDir, "server.ts") },
    ]);
    expect(info.date).toBe("2023-11-14T22:13:20.000Z");
    expect(info.reproducible).toBe(true);

    for (const epoch of ["2023-11-14", "8640000000001"]) {
      vi.stubEnv("SOURCE_DATE_EPOCH", epoch);
      await expect(
        buildInfoFor([{ fileName: "index.mjs", facadeModuleId: join(rootDir, "server.ts") }])
      ).rejects.toThrow("Invalid `SOURCE_DATE_EPOCH`");
    }
  });

  it("uses Nitro's entry even when the output name is customized", async () => {
    const info = await buildInfoFor([
      { fileName: "_chunks/app.mjs", facadeModuleId: join(rootDir, "app/app.ts") },
      { fileName: "worker.mjs", facadeModuleId: join(rootDir, "server.ts") },
    ]);
    expect(info.serverEntry).toBe("server/worker.mjs");
  });

  it("falls back to the first entry with a warning when facade IDs are unavailable", async () => {
    const info = await buildInfoFor([
      { fileName: "worker.mjs", facadeModuleId: null },
      { fileName: "index.mjs", facadeModuleId: null },
    ]);
    expect(info.serverEntry).toBe("server/worker.mjs");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("selects Nitro's entry from real Rolldown output with another entry first", async () => {
    const build = await rolldown({
      input: [join(rootDir, "exposed.ts"), join(rootDir, "server.ts")],
    });
    const output = await build.write({
      dir: join(rootDir, ".output/server"),
      entryFileNames: "[name].mjs",
    });
    await build.close();

    const entries = output.output.filter((item) => item.type === "chunk" && item.isEntry);
    expect(entries.map((item) => item.fileName)).toEqual(["exposed.mjs", "server.mjs"]);

    const info = await writeBuildInfo(createNitro(), output);
    expect(info.serverEntry).toBe("server/server.mjs");
  });

  it("distinguishes entry files with the same path stem", async () => {
    const build = await rolldown({
      input: { a: join(rootDir, "server.js"), b: join(rootDir, "server") },
      resolve: { extensions: [".ts", ".js"] },
    });
    const output = await build.write({
      dir: join(rootDir, ".output/server"),
      entryFileNames: "[name].mjs",
    });
    await build.close();

    const entries = output.output.flatMap((item) =>
      item.type === "chunk" && item.isEntry ? [item] : []
    );
    expect(entries.map((item) => resolve(item.facadeModuleId!))).toEqual([
      join(rootDir, "server.js"),
      join(rootDir, "server.ts"),
    ]);

    const info = await writeBuildInfo(createNitro(), output);
    expect(info.serverEntry).toBe("server/b.mjs");
  });
});
