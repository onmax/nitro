import type { Plugin as VitePlugin } from "vite";
import type { NitroPluginContext } from "./types.ts";
import { resolveAlias } from "pathe/utils";

export function nitroServerAliases(ctx: NitroPluginContext): VitePlugin {
  return {
    name: "nitro:server-aliases",
    enforce: "pre",
    applyToEnvironment: (env) => env.name !== "client" && env.config?.consumer !== "client",

    async resolveId(id, importer, options) {
      if (!ctx.bundlerConfig) {
        return;
      }
      const resolved = resolveAlias(id, ctx.bundlerConfig.base.aliases);
      if (resolved !== id && resolved.startsWith("node:")) {
        return (
          (await this.resolve(resolved, importer, { ...options, skipSelf: true })) || {
            id: resolved,
            external: true,
          }
        );
      }
    },
  };
}
