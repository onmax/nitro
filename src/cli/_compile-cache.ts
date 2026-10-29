import nodeModule from "node:module";

// Reuse V8's compiled code of Nitro and its dependencies across CLI runs. Node.js writes the
// cache on exit, which a dev server never reaches, so also write it once start-up is over.
// `node:module` has no `enableCompileCache` in Bun and Deno.
nodeModule.enableCompileCache?.();
setTimeout(() => nodeModule.flushCompileCache?.(), 10_000).unref();
