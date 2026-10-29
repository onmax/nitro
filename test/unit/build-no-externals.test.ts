import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { createNitro } from "../../src/builder.ts";
import { baseBuildConfig } from "../../src/build/config.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("noExternal", () => {
  it("matches Nitro's own imports by id", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "nitro-no-externals-"));
    tempDirs.push(rootDir);
    await writeFile(join(rootDir, "nitro.config.ts"), "export default {}\n");
    const nitro = await createNitro({ rootDir, dev: true, logLevel: 0 });
    const { noExternal } = await baseBuildConfig(nitro);
    await nitro.close();
    const matches = (id: string) => noExternal.some((re) => re.test(id));
    expect(matches("nitro")).toBe(true);
    expect(matches("nitro/h3")).toBe(true);
    expect(matches("nitro/runtime-config")).toBe(true);
    expect(matches("nitro-cloudflare-dev")).toBe(false);
    expect(matches("nitropack")).toBe(false);
    expect(matches("h3")).toBe(false);
  });
});
