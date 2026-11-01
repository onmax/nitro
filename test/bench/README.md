# `nitro:server-aliases` resolveId cost

Repro for a build-time cost in the Vite builder. It is not meant for the PR.

`nitro:server-aliases` (`src/build/vite/_server-aliases.ts`) has no hook filter, so it runs for every module id of the server environments. Before the fix it called `resolveAlias(id, base.aliases)` from `pathe/utils`. `base.aliases` is a plain object without pathe's normalized marker, so each call re-sorted and expanded the whole map, which costs O(n²) in the number of aliases.

Found in a hello-world Nuxt 5 build (`nuxt-nightly@5.0.0-2611010234-c709ec8`, `nitro@3.0.261029-rc`, 2 cores): `normalizeAliases` took 117 ms self-time, 7% of 1.69 s, over 587 resolveId calls.

## Run

```sh
pnpm install && pnpm stub
node test/bench/server-aliases.ts            # RUNS=7 ALIASES=60 MODULES=600
```

The script writes a fixture to `test/bench/.tmp/server-aliases` (ignored): a chain of `MODULES` server modules imported through a `#lib` alias, and `ALIASES` Nitro aliases. It then runs `RUNS` cold builds (`builder: "vite"`, `preset: "node"`), each in a fresh process. For each build it reports:

- `build`: wall time of `build(nitro)`
- `nitro:server-aliases`: CPU time sampled below the hook, children included
- `normalizeAliases self`: self-time of `normalizeAliases` from all callers

To compare against the code before the fix, check out only the plugin module from the refactor commit:

```sh
git show ff59cde2:src/build/vite/_server-aliases.ts > src/build/vite/_server-aliases.ts
node test/bench/server-aliases.ts
git checkout HEAD -- src/build/vite/_server-aliases.ts
```

## Results

Slimbook (16 cores, shared, Node 24.21.0), median of 7 cold builds, 600 modules:

| aliases | | build | `nitro:server-aliases` | `normalizeAliases` self |
| --: | --- | --: | --: | --: |
| 60 | before | 634 ms | 144.7 ms | 86.0 ms |
| 60 | after | 457 ms | 8.3 ms | 15.2 ms |
| 200 | before | 1900 ms | 802.0 ms | 547.2 ms |
| 200 | after | 1014 ms | 12.5 ms | 377.8 ms |

After the fix, the remaining `normalizeAliases` time comes from `resolveEnvPaths` in `src/build/env.ts`, which calls `resolveAlias` once per alias.
