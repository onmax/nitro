import { describe, expect, it, vi } from "vitest";
import { nitroServerAliases } from "../../src/build/vite/_server-aliases.ts";
import type { NitroPluginContext } from "../../src/build/vite/types.ts";

function setup(aliases: Record<string, string>) {
  const ctx = { bundlerConfig: { base: { aliases } } } as unknown as NitroPluginContext;
  const { filter, handler } = nitroServerAliases(ctx).resolveId as {
    filter: { id: { exclude: RegExp[] } };
    handler: (...args: unknown[]) => Promise<unknown>;
  };
  const resolve = vi.fn(async (id: string) => (id === "node:events" ? { id } : null));
  const call = (id: string) => handler.call({ resolve }, id, "/app/server.ts", {});
  const reaches = (id: string) => !filter.id.exclude.some((re) => re.test(id));
  return { ctx, call, resolve, reaches };
}

describe("nitro:server-aliases", () => {
  it("resolves ids aliased to `node:` builtins", async () => {
    const { call, resolve } = setup({
      "events/": "node:events/",
      events: "node:events",
      "~": "/app",
      fs: "~/fs-polyfill",
    });
    expect(await call("events")).toEqual({ id: "node:events" });
    expect(resolve).toHaveBeenCalledWith("node:events", "/app/server.ts", { skipSelf: true });
    expect(await call("events/sub")).toEqual({ id: "node:events/sub", external: true });
    expect(await call("fs")).toBeUndefined();
    expect(await call("eventsource")).toBeUndefined();
  });

  it("only sends ids that can start with an alias to the hook", () => {
    const { reaches } = setup({});
    for (const id of ["events", "events/sub", "~/utils", "#internal/nitro", "@scope/pkg"]) {
      expect(reaches(id), id).toBe(true);
    }
    for (const id of [
      "./a.ts",
      "../b.ts",
      "/app/server.ts",
      "C:/app/a.ts",
      "C:\\app\\a.ts",
      "\0virtual",
      "node:fs",
    ]) {
      expect(reaches(id), id).toBe(false);
    }
  });

  it("normalizes the alias map once per bundler config", async () => {
    let enumerations = 0;
    const aliases = new Proxy({ "~": "/app", events: "node:events" } as Record<string, string>, {
      ownKeys(target) {
        enumerations++;
        return Reflect.ownKeys(target);
      },
    });
    const { ctx, call } = setup(aliases);
    for (let i = 0; i < 20; i++) {
      await call(`module-${i}`);
    }
    expect(await call("events")).toEqual({ id: "node:events" });
    expect(enumerations).toBe(1);

    ctx.bundlerConfig = { base: { aliases: { events: "node:events/" } } } as any;
    expect(await call("events")).toEqual({ id: "node:events/", external: true });
  });
});
