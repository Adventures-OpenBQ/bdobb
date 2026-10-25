# Clean BDOBB v6 — Part A: Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry the bdobb-v2 v6.2.1 Rita client (plus a5229ea59's tool-round setting) onto clean v5, adapted to clean's model, leaving every gate green — except the table-model tools, which Part B builds.

**Architecture:** Donor files are copied as frozen git blobs (ADD), applied verbatim where clean still equals the donor's v5.7.2 base (CLEAN-APPLY), or merged three ways with clean winning every conflict (MERGE). Adaptations 2–5 and 7, the settings defaults and the service-URL seeding then land test-first. `describe_table`/`arrange_table` are routed to a new `src/lib/agent/tableModel/` module that already refuses backend tables (adaptation 1a) and reports worker tables as not yet wired; Part B replaces that branch.

**Tech Stack:** React 18 + TypeScript, Zustand, Vitest (jsdom), Playwright (Chromium, `scripts/browser.mjs` harness), Tauri 2 / Cargo, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-07-bdobb-clean-v6-client-design.md` (authoritative), with `docs/superpowers/specs/2026-10-07-rita-table-model-tools-design.md` governing adaptation 1. Part B: `docs/superpowers/plans/2026-10-07-bdobb-clean-v6-part-b-rita-table-model.md`. Part C: `docs/superpowers/plans/2026-10-07-bdobb-clean-v6-part-c-docs-verification.md`.

## Global Constraints

- Worktree `~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v6`, branch `codex/clean-v6`, base clean v5 `89889791bad5b44c857f3efe4b528231dd299560`. Verify `pwd` and `git branch --show-current` before every commit (the shell can revert to another checkout).
- Never modify the sibling worktrees `bdobb-clean-v4-integration` or `bdobb-clean-v5-reconciled`; they share this git repository. Never check out or reset their branches.
- No push, no tags, no remote, no repository rename, no edits outside this worktree.
- Donors are read only as frozen objects from `~/Developer/bdobb-v2`: v6.2.1 `3debd899eaea47a303319d4907f41075ff49f2b1`, its base v5.7.2 `c8188ff3a3cc0a479dbe5bd3e87fbd3836fa036c`, round setting `a5229ea595eb7019c85cca7412d1b1e034755961`. Never read a donor working tree; never mine other `bdobb*` repositories for design.
- Version 6.0.0 in `package.json`, `src-tauri/Cargo.toml`, the `bdobb2` entry of `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`. `src/help/guide/VERSION` reads exactly `v6.0.0 clean development candidate; qualification pending`.
- Identity unchanged: package `bdobb`, productName `BDOBB2`, identifier `com.artcashin.bdobb2`, crate `bdobb2`, `openbbDocker` stays `v3.0.1`.
- Conflicts: clean wins; only the v6 hunk is re-applied on top. A diverged test keeps every clean assertion and adds the donor's v6 cases. A deleted or weakened clean assertion is a review warning and must be justified in `docs/releases/v6-assembly.md`.
- Settings defaults: Rita off (`ritaUrl: ""`), context sharing off, no MCP servers, `ritaMaxFunctionRounds` 40, range 1–40.
- Never write tailnet hostnames, real endpoints or secrets into tracked files. Use `<your-tailnet>` in prose and `https://YOUR-TAILNET.ts.net` in tests (the existing `backendsFile.test.ts` convention).
- Every commit message names the donor commit(s) it carries and ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Vitest: always pass both `--maxWorkers=2 --minWorkers=1` and `--testTimeout=60000`. The full unit suite takes about 10 minutes and times out under host load: run `uptime` first, and if the 1-minute load average is above about 4× the core count, wait or run the affected files only, and record the load beside the result.
- Loopback-socket tests need an unsandboxed shell; `listen EPERM` is infrastructure, not a product failure.
- Logs and receipts for this part go under `docs/releases/validation/v6/part-a/`.

## Review Focus

1. **A v5 profile upgraded to v6** (no AI keys in `settings.json`, no `chat.json`, no `skills/`): every new key must default through `withDefaults` without a startup warning, skills seed once, and a later explicit `ritaUrl: ""` or `mcpServers: []` must never be reseeded from `VITE_DEFAULT_*`. Pinned in Task 9.
2. **An apps.json without `mcp_servers`, or with a malformed one,** must import exactly as clean v5 does, and no `mcp_servers` may ever be written on export or into a v4/v5 extension profile. Pinned in Task 2.
3. **Rita reading a grouped/bound card** (param groups, bindings, fiscal year end): `get_widget_data` must send what the card shows, not raw `card.params`. Pinned in Task 4.
4. **Undo of `remove_widget` after the user removed another card,** or of a `local_table` removal: Undo must fail visibly rather than restore a partial card or delete a stored file. Pinned in Task 5.
5. **A turn that exhausts the round limit** mid-workflow: no tool runs after the limit, completed tool history persists into `chat.json`, and the WARNING is visible. Pinned in Task 7.

## Open rulings (defaults applied until the user rules; record outcomes in the ledger)

- **R1 — articles reference manual.** The spec asks for `reference-manual/clean-v6/README.md` in the articles repository, which is outside this worktree. Default: not edited; Part C writes `docs/reference-manual/v6/README.md` for the user to copy.
- **R2 — live backend.** The live `get_widget_data` round trip needs a widgets backend. `OPENBB_BACKEND_URL` has no fallback (the step-1 Mac stack has no confirmed widgets endpoint; the NAS backend needs `OPENBB_NAS_AUTH`). Default: the live gate fails until the user names it.
- **R3 — formula input.** `formula.set` takes the drawer's own input (expression text plus a name→stable-ID binding map, parsed and bound by `bindFormulaDraft`) rather than a raw AST, so the drawer and Rita share one binder and the saved `expression` stays readable. Default: as written in Part B Task 7.
- **R4 — `toPivot`.** The spec lists an exported `toPivot`; its only consumer (`arrangeTable.ts`) is not carried. Default: stays private.
- **R5 — QA profiles.** Part C Task 8 copies the clean v5 QA app-data directory into the v6 QA identifier and temporarily swaps the v5 QA directory for the rollback check (restored afterwards). It never touches `com.artcashin.bdobb2`. Default: proceed.
- **R6 — MCP path.** The MCP path on :16911/:11443 is unconfirmed. Default: Part A Task 8 probes `/mcp`; if that fails, stop and ask.
- **R7 — tab must be open.** The table tools need the card's runtime mounted (its tab open); otherwise they answer `runtime-not-ready` and suggest `navigate`. Default: as written (no background activation).

Scope notes: `CategoryDef` has no member-group field, so "explicit member groups" have nothing to author in `table-model/1` beyond what `TableModelV1` holds; browser coverage is one Rita round trip (Part B Task 16) plus the real-worker integration tests, not one e2e per operation family (the design asks for no exhaustive suite).

---

## File Structure

| Path | Responsibility | Disposition |
|---|---|---|
| `docs/releases/v6-delta-manifest.tsv` | Every delta entry with disposition and reason | new |
| `docs/releases/v6-assembly.md` | Assembly ledger (commits, rulings, warnings) | new |
| `.superpowers/v6-helpers.sh` | Local shell helpers for carry/merge (gitignored) | new, untracked |
| `src/lib/agent/*`, `src/lib/{aiLibraryFile,chatExport,chatExportFile,chatFile,mcpTokensFile,privateHost,rowTemplate,shareSend,shareTargets,skillsFiles}.ts`, `src/stores/{agentDiscoveryStore,agentEditsStore,chatStore,importMcpServers,mcpTokensStore,skillsStore}.ts`, `src/skills/*` (except `arrange-table`), `src/test/fixtures/{mcp,rita}*`, `src/test/integration/{rita-live,rita-authoring-live,real-endpoints}.test.ts` | Donor Rita client | ADD |
| `src/lib/agent/tableProfile*.ts`, `src/lib/agent/arrangeTable*.ts` | Donor table calculator | EXCLUDED (adaptation 1) |
| `src/lib/agent/limits.ts` | Round bounds 1–40, default 40 | new (from a5229ea59, re-bounded) |
| `src/lib/agent/tableModel/target.ts`, `src/lib/agent/tableModel/tools.ts` | Table-tool target classification and backend refusal | new (Part B extends) |
| `src/lib/cardViews.ts` | `availableViews` from clean's WidgetCard modes | ADAPT |
| `src/components/ai/*`, `src/components/rita/*` | AI Library and Rita UI | ADD |
| SAME-BASE files (settingsFile, settingsStore, settingsBundle, dataClient, bootstrap, providerKeys, runAppsImport, RailIcon, LibraryFilters, useHoverPanel, dialogs.css + their tests) | Donor delta applies verbatim | CLEAN-APPLY |
| DIVERGED product files and tests (App, WidgetCard, LeftRail, WidgetLibrary, TableRenderer, tableColumns, types, appsJson, widgetsJson, workspacesFile, useDashboardShortcuts, styles.css, package.json, Cargo.*, tauri.conf.json) | 3-way merge | MERGE |
| `src/lib/pivotConfig.ts`, `src/components/renderers/PivotPanel.tsx`, `src/lib/pivotConfig.test.ts` | Clean already has `legalAggregations` | CLEAN-WINS |
| `scripts/generate-capabilities{,.test}.mjs`, `e2e/{rita,ai-library,agent-options}.spec.ts`, `docs/examples/v6.0.0-rita.apps.json` | Non-src carries | ADD |
| `scripts/browser-fixtures.mjs`, `e2e/fixtures.ts`, `scripts/scrub-check.sh`, `.gitignore` | Non-src hunks | MERGE / CLEAN-APPLY |

---

### Task 1: Version bump, manifest and ledger

**Files:**
- Modify: `package.json` (version), `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (bdobb2 entry only), `src-tauri/tauri.conf.json` (version), `src/help/guide/VERSION`, `src/lib/version.test.ts`
- Create: `docs/releases/v6-delta-manifest.tsv`, `docs/releases/v6-assembly.md`, `.superpowers/v6-helpers.sh` (untracked)

**Interfaces:**
- Produces: `.superpowers/v6-helpers.sh` defining `C`, `D`, `BASE`, `V621`, `ROUNDS`, `carry <path>`, `carry_from <sha> <path>`, `merge3 <path>`, `same_base <path>`; every later task sources it.

- [ ] **Step 1: Write the failing test** — append to `src/lib/version.test.ts` inside the existing `describe`:

```ts
  it("is the clean v6 development version", () => {
    expect(pkg).toBe("6.0.0");
    expect(at("src/help/guide/VERSION").trim()).toBe("v6.0.0 clean development candidate; qualification pending");
    expect(at("src-tauri/Cargo.lock")).toMatch(/name = "bdobb2"\nversion = "6\.0\.0"/);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/lib/version.test.ts --maxWorkers=2 --minWorkers=1 --testTimeout=60000`
Expected: FAIL — `expected '5.0.0' to be '6.0.0'`.

- [ ] **Step 3: Bump the four version fields and VERSION**

Set `"version": "6.0.0"` in `package.json` and `src-tauri/tauri.conf.json`; `version = "6.0.0"` in the `[package]` table of `src-tauri/Cargo.toml` and in the `name = "bdobb2"` block of `src-tauri/Cargo.lock`. Write `src/help/guide/VERSION` as the single line `v6.0.0 clean development candidate; qualification pending`. Do not touch name/productName/identifier/`openbbDocker`.

- [ ] **Step 4: Create the helpers file (gitignored `.superpowers/`)**

```bash
mkdir -p .superpowers && cat > .superpowers/v6-helpers.sh <<'EOF'
C=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v6
D=~/Developer/bdobb-v2
BASE=c8188ff3a3cc0a479dbe5bd3e87fbd3836fa036c
V621=3debd899eaea47a303319d4907f41075ff49f2b1
ROUNDS=a5229ea595eb7019c85cca7412d1b1e034755961
carry_from() { mkdir -p "$C/$(dirname "$2")"; git -C "$D" show "${1}:${2}" > "$C/$2"; }
carry() { carry_from "$V621" "$1"; }
same_base() { git -C "$D" show "${BASE}:${1}" | cmp -s - "$C/$1"; }
# Leaves conflict markers labelled clean / v5.7.2 / v6.2.1; exit status = conflict count.
merge3() { local b t; b=$(mktemp); t=$(mktemp); git -C "$D" show "${BASE}:${1}" > "$b"; git -C "$D" show "${V621}:${1}" > "$t"; git merge-file -L clean -L v5.7.2 -L v6.2.1 "$C/$1" "$b" "$t"; }
EOF
git check-ignore -q .superpowers/v6-helpers.sh && echo ignored
```
Expected: `ignored`.

- [ ] **Step 5: Write the manifest**

Copy the measured delta and add a disposition column with this rule set (one row per entry, tab separated, header `status\tpath\tdisposition\treason`):

```bash
. .superpowers/v6-helpers.sh
SRC=<scratch>
test -s "$SRC" || { echo "regenerate: git -C $D diff --name-status $BASE $V621 compared against clean"; exit 1; }
python3 - "$SRC" > docs/releases/v6-delta-manifest.tsv <<'EOF'
import sys
RITA_HELP = {"troubleshooting-using-bdobb","troubleshooting-infrastructure","openbb-docker-stack","layout-and-navigation","import-and-export","home","tailscale-networking","keyboard-shortcuts","example-dashboards","about-this-guide","app-data-and-settings","tables","widget-cards","the-left-rail","settings-export-and-import","settings-and-logs","installing-and-running","backends-and-connections","getting-started","web-preview","built-in-widgets"}
print("status\tpath\tdisposition\treason")
for line in open(sys.argv[1]):
    st, p = line.split()
    stem = p.rsplit("/",1)[-1].rsplit(".",1)[0]
    if p.endswith(".png"): d, r = "EXCLUDED", "help screenshots are regenerated by pnpm help:shots (Part C)"
    elif "/tableProfile" in p or "/arrangeTable" in p: d, r = "EXCLUDED", "adaptation 1: no second calculator; table-model/1 adapter replaces it (Part B)"
    elif p.startswith("src/lib/cardViews"): d, r = "ADAPT", "adaptation 1 Views: extracted from clean WidgetCard modes (Task 12)"
    elif p == "src/skills/arrange-table/SKILL.md": d, r = "ADAPT", "rewritten for table-model/1 (Part B)"
    elif st == "MISSING-IN-CLEAN": d, r = "EXCLUDED", "clean folded Pivot into tables.md; one cross-reference line instead"
    elif p in ("src/lib/pivotConfig.ts","src/lib/pivotConfig.test.ts","src/components/renderers/PivotPanel.tsx"): d, r = "CLEAN-WINS", "legalAggregations already in clean; PivotPanel already uses it"
    elif p.startswith("src/help/"):
        if p.endswith("VERSION"): d, r = "ADAPT", "clean v6 candidate wording (Task 1)"
        elif st == "A" or stem in RITA_HELP: d, r = "ADAPT", "Rita/AI hunks hand-ported with BDOBB naming (Part C)"
        else: d, r = "CLEAN-WINS", "donor change is branding/version churn only"
    elif st == "A": d, r = "ADD", "donor blob verbatim"
    elif st == "SAME-BASE": d, r = "CLEAN-APPLY", "clean equals v5.7.2; donor delta applies verbatim"
    else: d, r = "MERGE", "3-way merge, clean wins conflicts, v6 hunk re-applied"
    print(f"{st}\t{p}\t{d}\t{r}")
for p, d, r in [("scripts/generate-capabilities.mjs","ADD","share-folders capability generator"),("scripts/generate-capabilities.test.mjs","ADD","its test"),("e2e/rita.spec.ts","ADD","Rita browser spec"),("e2e/ai-library.spec.ts","ADD","AI Library spec (+a5229ea59 rounds case)"),("e2e/agent-options.spec.ts","ADD","agents.json options spec"),("e2e/rita-arrange.spec.ts","ADAPT","rewritten for table-model/1 on a CSV table (Part B)"),("docs/examples/v6.0.0-rita.apps.json","ADD","PR #179 sample (a616a7a87)"),("e2e/fixtures.ts","MERGE","openAILibrary helper"),("scripts/browser-fixtures.mjs","MERGE","agents.json + /v1/query routes"),("scripts/help-shots.mjs","MERGE","ai-library and rita shots (Part C)"),("scripts/scrub-check.sh","CLEAN-APPLY",".env* exclusion only"),(".gitignore","CLEAN-APPLY","generated share-folders capability"),("scripts/apps-sync.mjs","EXCLUDED","owner entry targets openbb-docker"),("src/lib/agent/limits.ts","ADAPT","a5229ea59 mechanics, bounds 1-40 default 40")]:
    print(f"NON-SRC\t{p}\t{d}\t{r}")
EOF
awk -F'\t' 'NR>1{print $3}' docs/releases/v6-delta-manifest.tsv | sort | uniq -c
```
Expected: counts for ADD, ADAPT, CLEAN-APPLY, CLEAN-WINS, EXCLUDED, MERGE summing to 254 (240 + 14).

- [ ] **Step 6: Start the ledger** — create `docs/releases/v6-assembly.md`:

```markdown
# Clean v6 assembly ledger

Base clean v5 89889791bad5b44c857f3efe4b528231dd299560 (codex/clean-v5-reconciled). Branch codex/clean-v6, local only.
Donors: bdobb-v2 v6.2.1 3debd899eaea47a303319d4907f41075ff49f2b1 (base v5.7.2 c8188ff3a3cc0a479dbe5bd3e87fbd3836fa036c); a5229ea595eb7019c85cca7412d1b1e034755961 (tool rounds).
Dispositions: docs/releases/v6-delta-manifest.tsv. Receipts: docs/releases/validation/v6/.

## Steps
| Commit | Step | Donor commits | Notes |
|---|---|---|---|

## Rulings applied
- 2026-10-07: table-model tools cover CSV/XLS and linked tables only; backend tables return `unavailable` / `server-execution-pending`; no backend registration with the client worker; no second calculator; v4/v5 untouched.
- NAS endpoints are tailnet-only without auth (funnel off). Rita gets no client auth.
- Step-1 services PARTIAL/FAIL items are accepted differences pending the services pairing-A results.
- Tool-round setting: default 40, range 1-40.

## Review warnings (removed or weakened assertions)
None yet.
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/version.test.ts --maxWorkers=2 --minWorkers=1 --testTimeout=60000`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
pwd; git branch --show-current   # must be bdobb-clean-v6 / codex/clean-v6
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json src/help/guide/VERSION src/lib/version.test.ts docs/releases/v6-delta-manifest.tsv docs/releases/v6-assembly.md
git commit -m "chore(v6): version 6.0.0, delta manifest and assembly ledger

Donors: bdobb-v2 v6.2.1 3debd899e (base v5.7.2 c8188ff3a), a5229ea59.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Library layer — ADD protocol/files, CLEAN-APPLY settings/data, MERGE types and imports

**Files:**
- Create (ADD, verbatim from v6.2.1): every `A` path under `src/lib/agent/` **except** `localTools*.ts`, `execute*.ts`, `tableProfile*.ts`, `arrangeTable*.ts`; `src/lib/{aiLibraryFile,chatExport,chatExportFile,chatFile,mcpTokensFile,privateHost,rowTemplate,shareSend,shareTargets,skillsFiles}{,.test}.ts` (where a test exists); `src/skills/{build-dashboard,openbb-html-chart,openbb-html-report,openbb-html-table}/SKILL.md`; `src/test/fixtures/mcp-fixtures{,.test}.ts`, `src/test/fixtures/mcp/*.sse`, `src/test/fixtures/rita-*.sse`, `src/test/fixtures/rita/*`
- Modify (CLEAN-APPLY): `src/lib/settingsFile{,.test}.ts`, `src/stores/settingsStore.ts`, `src/lib/settingsBundle.ts`, `src/lib/dataClient.ts`, `src/lib/bootstrap.ts`, `src/lib/providerKeys{,.test}.ts`
- Modify (MERGE): `src/lib/types.ts`, `src/lib/appsJson.ts`, `src/lib/appsJson.test.ts`, `src/lib/appsJson.examples.test.ts`, `src/lib/widgetsJson.ts`, `src/lib/widgetsJson.test.ts`, `src/lib/tableColumns.ts`, `src/lib/workspacesFile.ts`, `src/lib/settingsBundle.test.ts`, `src/lib/bootstrap.test.ts`, `src/lib/params.test.ts`, `src/lib/tableColumns.test.ts` (CLEAN-APPLY)

**Interfaces:**
- Consumes: `.superpowers/v6-helpers.sh` (Task 1).
- Produces: `Settings` fields `ritaUrl: string`, `ritaHoverDelayMs: number`, `contextSharing: boolean`, `agentOptions`, `agentPromptSuggestions: boolean`, `mcpServers: McpServerConfig[]`, `mcpDisabledTools: Record<string,string[]>`, `shareTargets: ShareTarget[]` (in `src/lib/types.ts`); `WidgetDef.mcpUrl?: string`; `AppsImportReady.mcpServers: ImportedMcpServer[]`; `TableColumn.sendToAgent?: SendToAgent` and `sendToAgentOf(spec)` in `src/lib/tableColumns.ts`; `isAgentOffLimits`, `keyMaintBackendIds` in `src/lib/providerKeys.ts`; `toMcpServerConfig`, `RITA_HOVER_DELAY_MIN/MAX` in `src/lib/settingsFile.ts`; `joinUrl`, `safeNetworkErrorMessage` in `src/lib/dataClient.ts`.

- [ ] **Step 1: Prove the donor owning tests fail on clean (RED)**

```bash
. .superpowers/v6-helpers.sh
for f in src/lib/agent/mcp.test.ts src/lib/aiLibraryFile.test.ts src/lib/settingsFile.test.ts; do carry "$f"; done
pnpm exec vitest run src/lib/agent/mcp.test.ts src/lib/aiLibraryFile.test.ts src/lib/settingsFile.test.ts --maxWorkers=2 --minWorkers=1 --testTimeout=60000 2>&1 | tail -5
```
Expected: FAIL — `Failed to resolve import "./mcp"` / `"./aiLibraryFile"` and settings assertions on `ritaUrl`.

- [ ] **Step 2: ADD the library blobs**

```bash
. .superpowers/v6-helpers.sh
awk -F'\t' '$3=="ADD"{print $2}' docs/releases/v6-delta-manifest.tsv \
 | grep -E '^src/(lib/|skills/|test/fixtures/)' \
 | grep -vE '^src/lib/agent/(localTools|execute)' \
 | while read p; do carry "$p"; done
git status --short | grep -c '^??'
```

- [ ] **Step 3: CLEAN-APPLY the same-base files (guarded)**

```bash
. .superpowers/v6-helpers.sh
for p in src/lib/settingsFile.ts src/lib/settingsFile.test.ts src/stores/settingsStore.ts src/lib/settingsBundle.ts src/lib/dataClient.ts src/lib/bootstrap.ts src/lib/providerKeys.ts src/lib/providerKeys.test.ts src/lib/tableColumns.test.ts; do
  same_base "$p" || { echo "NOT SAME-BASE: $p — stop and record in ledger"; break; }; carry "$p"; done
```
Expected: no `NOT SAME-BASE` line.

- [ ] **Step 4: MERGE the diverged library files**

```bash
. .superpowers/v6-helpers.sh
for p in src/lib/types.ts src/lib/appsJson.ts src/lib/appsJson.test.ts src/lib/appsJson.examples.test.ts src/lib/widgetsJson.ts src/lib/widgetsJson.test.ts src/lib/tableColumns.ts src/lib/workspacesFile.ts src/lib/settingsBundle.test.ts src/lib/bootstrap.test.ts src/lib/params.test.ts; do merge3 "$p"; echo "$? $p"; done
```
Expected conflict counts (measured dry run): `types.ts 1`, `appsJson.ts 2`, `appsJson.examples.test.ts 1`, `widgetsJson.ts 2`, `params.test.ts 1`, all others `0`.

Resolve each conflict by keeping the `clean` side and re-adding only these v6 hunks:
- `types.ts`: the two type imports (`McpServerConfig`, `ShareTarget`), `WidgetDef.mcpUrl?: string` with its comment, and the eight `Settings` fields listed under Interfaces (with their comments). `ritaMaxFunctionRounds` is added in Task 7, not here.
- `appsJson.ts`: the `parseMcpServers`/`ImportedMcpServer` import, `App.mcp_servers?: unknown`, `AppsImportReady.mcpServers`, and in `planAppsImport` read `mcpServers` from the **raw parsed array** beside clean's existing v3/v4/v5 envelope decoding (keep clean's decoder call untouched; compute `mcpServers` from the same `JSON.parse` result). Never add `mcp_servers` to `appsExtensionsV4` / v5 profiles and never write it on export.
- `widgetsJson.ts`: the `safeUrl` import and the `storage.mcpUrl` block plus `mcpUrl,` in the returned def. **Do not** export `toPivot` (its only consumer, `arrangeTable.ts`, is EXCLUDED); record that in the ledger.
- `appsJson.examples.test.ts` / `params.test.ts`: keep clean's expectations, add the donor's new example/default-settings lines.

- [ ] **Step 5: Add the Review-Focus test for apps.json MCP isolation** — append to `src/lib/appsJson.test.ts`:

```ts
describe("v6 mcp_servers stay out of clean profiles", () => {
  const plan = (apps: unknown) => { const text = JSON.stringify(apps); return planAppsImport(text, text.length, [], []); };
  it("imports an app without mcp_servers exactly as before and reports none", () => {
    const result = plan([{ name: "Plain", tabs: {} }]);
    expect(result.ok && result.mcpServers).toEqual([]);
  });
  it("drops a malformed mcp_servers value without refusing the import", () => {
    const result = plan([{ name: "Odd", tabs: {}, mcp_servers: "nope" }]);
    expect(result.ok).toBe(true);
    expect(result.ok && result.mcpServers).toEqual([]);
  });
  it("never writes mcp_servers on export, plain or compatible", () => {
    const result = plan([{ name: "With", tabs: {}, mcp_servers: [{ name: "m", url: "https://YOUR-TAILNET.ts.net/mcp" }] }]);
    expect(result.ok && result.mcpServers.length).toBe(1);
    for (const d of result.ok ? result.dashboards : []) {
      expect(JSON.stringify(exportApp(d))).not.toContain("mcp_servers");
      expect(JSON.stringify(exportCompatibleApp(d))).not.toContain("mcp_servers");
    }
  });
});
```
`planAppsImport(text, bytes, registry, existing)`, `exportApp(dashboard)` and `exportCompatibleApp(dashboard)` are clean v5's real exports in `src/lib/appsJson.ts`; if a minimal app literal above does not satisfy clean's strict v3 decoder, copy the smallest valid app from an existing case in `appsJson.test.ts` and add `mcp_servers` to it — keep the three assertions.

- [ ] **Step 6: Run the library tests and typecheck**

```bash
pnpm typecheck 2>&1 | tail -20
pnpm exec vitest run src/lib/agent src/lib/aiLibraryFile.test.ts src/lib/chatFile.test.ts src/lib/chatExport.test.ts src/lib/chatExportFile.test.ts src/lib/mcpTokensFile.test.ts src/lib/privateHost.test.ts src/lib/rowTemplate.test.ts src/lib/shareTargets.test.ts src/lib/skillsFiles.test.ts src/lib/settingsFile.test.ts src/lib/settingsBundle.test.ts src/lib/providerKeys.test.ts src/lib/bootstrap.test.ts src/lib/params.test.ts src/lib/appsJson.test.ts src/lib/appsJson.examples.test.ts src/lib/widgetsJson.test.ts src/lib/tableColumns.test.ts src/test/fixtures --maxWorkers=2 --minWorkers=1 --testTimeout=60000 2>&1 | tail -8
```
Expected: typecheck clean; all listed files PASS, and the SSE keepalive fix is present and green: `pnpm exec vitest run src/lib/agent/sse.test.ts src/lib/agent/query.test.ts -t "keepalive comments hold the idle timeout open while Rita thinks" --maxWorkers=2 --minWorkers=1 --testTimeout=60000` reports 1 passed (not 0). If typecheck names an ADD file that imports a store or `localTools`/`execute`, move that file's carry to Task 3 and note it in the ledger.

- [ ] **Step 7: Commit**

```bash
git add -A src/lib src/skills src/test src/stores/settingsStore.ts
git commit -m "feat(v6): carry Rita library layer from v6.2.1

ADD agent protocol (query, sse, events, request, agents-json, mcp, mcpAuth,
importedMcp, dashboardMcp, skills, workspaceOptions), chat/skills/token files,
share targets, fixtures and live tests. CLEAN-APPLY settings/data/providerKeys.
MERGE types, appsJson (mcp_servers from the raw array only), widgetsJson
(storage.mcpUrl; toPivot stays private), tableColumns (sendToAgent).
Includes #322 4bc3ba7c8 2a35dad39, ddaa0a201, 071753d70, a29c4b169 keepalive.
Donor: bdobb-v2 3debd899e (base c8188ff3a).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Stores, local tools and the table-tool gate

**Files:**
- Create (ADD): `src/lib/agent/localTools{,.test}.ts`, `src/lib/agent/execute{,.test}.ts`, `src/stores/{agentDiscoveryStore,agentEditsStore,chatStore,skillsStore}{,.test}.ts`, `src/stores/{importMcpServers,mcpTokensStore}.ts`
- Create: `src/lib/agent/tableModel/target.ts`, `src/lib/agent/tableModel/tools.ts`, `src/lib/agent/tableModel/target.test.ts`
- Modify: `src/lib/agent/localTools.ts` (drop calculator imports, route the two table tools), `src/lib/agent/localTools.test.ts` (remove donor calculator cases, record them), `src/stores/chatStore.ts` (drop `fetchRows`)

**Interfaces:**
- Consumes: Task 2 library layer; clean `isWorkerTableProducer(card)` from `src/lib/tableExecution/eligibility.ts`; `LOCAL_TABLE_ID`, `LINKED_TABLE_ID` from `src/lib/builtins.ts`.
- Produces:
  ```ts
  // src/lib/agent/tableModel/target.ts
  export type TableTarget =
    | { kind: 'worker'; dashboardId: string; card: DashboardCard; def: WidgetDef }
    | { kind: 'refusal'; status: 'unknown' | 'not-a-table' | 'server-execution-pending' | 'view-not-tabular'; message: string; alternatives: string[] };
  export function resolveTableTarget(cardId: string): TableTarget;
  // src/lib/agent/tableModel/tools.ts
  export async function describeTable(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  export async function arrangeTable(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  ```
  `LocalToolDeps` no longer has `fetchRows`; `executeLocalTool(name, args)` takes no table deps.

- [ ] **Step 1: Write the failing gate test** — `src/lib/agent/tableModel/target.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import { useDashboardStore } from "../../../stores/dashboardStore";
import { useWidgetRegistryStore } from "../../../stores/widgetRegistryStore";
import { resolveTableTarget } from "./target";
import { arrangeTable, describeTable } from "./tools";
import type { DashboardCard } from "../../types";

const card = (over: Partial<DashboardCard>): DashboardCard =>
  ({ id: "c", widgetId: "local_table", backendId: "builtin", params: { file: "a.csv" }, layout: { x: 0, y: 0, w: 4, h: 4 }, ...over }) as DashboardCard;
function board(cards: DashboardCard[]) {
  useDashboardStore.setState({ dashboards: [{ id: "d", name: "D", tabs: [{ id: "t", name: "T", cards }] }], activeId: "d", activeTabId: "t", viewer: false, pendingCardRemoval: null });
}
beforeEach(() => {
  useWidgetRegistryStore.getState().seedBuiltins();
  useWidgetRegistryStore.setState(s => ({ widgets: [...s.widgets, { id: "prices", backendId: "be", name: "Prices", description: "", type: "table", category: "x", subCategory: "", endpoint: "/p", source: [], params: [], gridData: { w: 4, h: 4 } }] }));
});

describe("table tool targets (adaptation 1a)", () => {
  it("classifies a CSV/XLS table as a worker table", () => {
    board([card({})]);
    expect(resolveTableTarget("c").kind).toBe("worker");
  });
  it("classifies a linked table as a worker table", () => {
    board([card({ id: "s" }), card({ id: "c", widgetId: "linked_table", params: {}, linkedSource: { kind: "widget", sourceWidgetId: "s" } })]);
    expect(resolveTableTarget("c").kind).toBe("worker");
  });
  it("refuses a backend table with server-execution-pending and an actionable alternative", async () => {
    board([card({ widgetId: "prices", backendId: "be", params: {} })]);
    expect(resolveTableTarget("c")).toMatchObject({ kind: "refusal", status: "server-execution-pending" });
    const described = await describeTable({ card_id: "c" });
    expect(described).toMatchObject({ status: "unavailable", reason: "server-execution-pending" });
    expect(JSON.stringify(described)).toContain("describe_widget");
    const arranged = await arrangeTable({ card_id: "c", expected_revision: "x", arrangement: { contract: "table-model/1", operations: [] } });
    expect(arranged).toMatchObject({ status: "refused", code: "server-execution-pending" });
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0]).toMatchObject({ widgetId: "prices" });
  });
  it("answers an unknown card exactly like get_widget_data", () => {
    board([]);
    expect(resolveTableTarget("nope")).toMatchObject({ kind: "refusal", status: "unknown", message: "unknown card nope" });
  });
  it("refuses a worker table shown as a chart with view-not-tabular", () => {
    board([card({ view: "chart" })]);
    expect(resolveTableTarget("c")).toMatchObject({ kind: "refusal", status: "view-not-tabular" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/agent/tableModel/target.test.ts --maxWorkers=2 --minWorkers=1 --testTimeout=60000`
Expected: FAIL — `Failed to resolve import "./target"`.

- [ ] **Step 3: ADD stores, localTools and execute**

```bash
. .superpowers/v6-helpers.sh
for p in src/lib/agent/localTools.ts src/lib/agent/localTools.test.ts src/lib/agent/execute.ts src/lib/agent/execute.test.ts src/stores/agentDiscoveryStore.ts src/stores/agentDiscoveryStore.test.ts src/stores/agentEditsStore.ts src/stores/agentEditsStore.test.ts src/stores/chatStore.ts src/stores/chatStore.test.ts src/stores/importMcpServers.ts src/stores/mcpTokensStore.ts src/stores/skillsStore.ts src/stores/skillsStore.test.ts; do carry "$p"; done
```

- [ ] **Step 4: Implement the gate**

`src/lib/agent/tableModel/target.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { isAgentOffLimits, keyMaintBackendIds } from "../../providerKeys";
import { isWorkerTableProducer } from "../../tableExecution/eligibility";
import { LINKED_TABLE_ID, LOCAL_TABLE_ID } from "../../builtins";
import { useDashboardStore } from "../../../stores/dashboardStore";
import { useWidgetRegistryStore } from "../../../stores/widgetRegistryStore";
import type { DashboardCard, WidgetDef } from "../../types";

export type TableTarget =
  | { kind: "worker"; dashboardId: string; card: DashboardCard; def: WidgetDef }
  | { kind: "refusal"; status: "unknown" | "not-a-table" | "server-execution-pending" | "view-not-tabular"; message: string; alternatives: string[] };

const refusal = (status: Extract<TableTarget, { kind: "refusal" }>["status"], message: string, alternatives: string[] = []): TableTarget =>
  ({ kind: "refusal", status, message, alternatives });

/** Active dashboard only, read fresh: Undo calls back into this long after the tool call. */
export function resolveTableTarget(cardId: string): TableTarget {
  const dashboard = useDashboardStore.getState().activeDashboard();
  const card = dashboard?.tabs.flatMap(t => t.cards).find(c => c.id === cardId);
  const registry = useWidgetRegistryStore.getState();
  const def = card && registry.find(card.backendId, card.widgetId);
  // Same wording as get_widget_data: key-maint and foreign cards read as unknown.
  if (!dashboard || !card || !def || isAgentOffLimits(def, keyMaintBackendIds(registry.widgets))) return refusal("unknown", `unknown card ${cardId}`);
  const workerType = def.id === LOCAL_TABLE_ID || def.id === LINKED_TABLE_ID || !!card.linkedSource;
  if (workerType && !card.linkedChart) {
    return isWorkerTableProducer(card)
      ? { kind: "worker", dashboardId: dashboard.id, card, def }
      : refusal("view-not-tabular", `card ${cardId} is showing its ${card.view} view; the table model is edited in Table or Statement view`, ["Ask the user to switch the card to Table or Statement view"]);
  }
  if (def.type === "table")
    return refusal("server-execution-pending", `card ${cardId} is a backend table. Backend tables are reserved for server-side execution, which this version does not include, so their table model cannot be inspected or arranged here.`,
      ["describe_widget to read its parameters", "get_widget_data to read its rows", "Load the data as a CSV/XLS table, which the table-model tools support"]);
  return refusal("not-a-table", `card ${cardId} is a ${def.type} widget, not a table`);
}
```

`src/lib/agent/tableModel/tools.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { resolveTableTarget } from "./target";

const cardIdOf = (args: Record<string, unknown>) => (typeof args.card_id === "string" ? args.card_id : "");

export async function describeTable(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const target = resolveTableTarget(cardIdOf(args));
  if (target.kind === "refusal") return { status: "unavailable", reason: target.status, message: target.message, alternatives: target.alternatives };
  // Part B replaces this branch with the table-model/1 summary.
  return { status: "unavailable", reason: "adapter-pending", message: "The table-model adapter is not wired in this build.", alternatives: [] };
}

export async function arrangeTable(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const target = resolveTableTarget(cardIdOf(args));
  if (target.kind === "refusal") return { status: "refused", code: target.status, message: target.message, alternatives: target.alternatives };
  return { status: "refused", code: "adapter-pending", message: "The table-model adapter is not wired in this build.", alternatives: [] };
}
```

In `src/lib/agent/localTools.ts`: delete the imports of `./tableProfile`, `./arrangeTable`, `../cardViews` and the helpers only they used (`tableTarget`, `FieldKind` imports); replace the bodies of the `describe_table` and `arrange_table` branches with `return describeTable(args);` / `return arrangeTable(args);` (import from `./tableModel/tools`); change `LocalToolDeps` to `export type LocalToolDeps = Record<string, never>;` and keep the `deps?` parameter for call-site stability. In `src/stores/chatStore.ts` delete the `localDeps`/`fetchRows` block and pass `undefined` in its place. In `localTools.test.ts` delete only the cases that exercise the donor calculator (`describe_table` profiling and `arrange_table` pivot validation) and list each deleted test name in the ledger's Review-warnings section with reason "donor calculator not carried (adaptation 1)".

- [ ] **Step 5: Run the gate and carried store tests**

```bash
pnpm typecheck 2>&1 | tail -10
pnpm exec vitest run src/lib/agent src/stores/agentDiscoveryStore.test.ts src/stores/agentEditsStore.test.ts src/stores/chatStore.test.ts src/stores/skillsStore.test.ts --maxWorkers=2 --minWorkers=1 --testTimeout=60000 2>&1 | tail -8
```
Expected: typecheck clean; all PASS, including the 5 gate cases.

- [ ] **Step 6: Commit**

```bash
git add -A src/lib/agent src/stores docs/releases/v6-assembly.md
git commit -m "feat(v6): carry Rita stores and local tools; gate table tools to worker tables

ADD chatStore, agentEditsStore, discovery/skills/token stores, localTools (17
tools), execute (get_widget_data round trip, top-level tool message, #326
c5b032a72 4ece1b7f1). Adaptation 1a: backend tables answer
server-execution-pending; donor tableProfile/arrangeTable not carried.
Donor: bdobb-v2 3debd899e.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Adaptation 2 — Rita reads what the card shows

**Files:**
- Modify: `src/lib/agent/execute.ts` (`makeWidgetDataFetcher`), `src/stores/chatStore.ts` (pass groups/fiscal deps)
- Test: `src/lib/agent/execute.test.ts`

**Interfaces:**
- Consumes: clean `effectiveParams(card, groups, widget, groupsDisabled, fiscalYearEnd)` in `src/lib/paramGroups.ts`.
- Produces: `FetcherDeps` gains `groups: (dashboardCardId: string) => { groups: ParamGroup[] | undefined; groupsDisabled: boolean }` and `fiscalYearEnd: (card: DashboardCard, widget: WidgetDef) => Record<string, number> | undefined`; fetch passes `fiscalYearEnd` to `fetchData` exactly as `useWidgetData` does.

- [ ] **Step 1: Find the effective-input call in clean**

Run: `grep -n "effectiveParams\|fetchWidgetData(" src/hooks/useWidgetData.ts src/components/WidgetCard.tsx | head` and note how WidgetCard derives `groups`, `groupsDisabled` and `fiscalYearEnd` (the `useFiscalYearEnd` hook) and what argument position `fetchWidgetData` takes `fiscalYearEnd` in. Use those exact sources below.

- [ ] **Step 2: Write the failing test** — append to `src/lib/agent/execute.test.ts`:

```ts
describe("get_widget_data sends the card's effective inputs (adaptation 2)", () => {
  it("uses the group's value, not the card's stale own param", async () => {
    const widget = { id: "q", backendId: "be", name: "Quote", description: "", type: "table", endpoint: "/q", category: "", subCategory: "", source: [], gridData: { w: 1, h: 1 }, params: [{ paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" }] } as unknown as WidgetDef;
    const card = { id: "c1", backendId: "be", widgetId: "q", params: { symbol: "AAPL" }, bindings: [{ paramName: "symbol", groupId: "g1" }], layout: { x: 0, y: 0, w: 1, h: 1 } } as unknown as DashboardCard;
    const seen: Record<string, string>[] = [];
    const fetch = makeWidgetDataFetcher(
      { cards: [card], backends: [{ id: "be", name: "B", baseUrl: "http://127.0.0.1:1" } as BackendConfig], findWidget: () => widget, keyMaintBackends: new Set(),
        groups: () => ({ groups: [{ id: "g1", name: "G", paramName: "symbol", groupType: "symbol", value: "MSFT" }], groupsDisabled: false }), fiscalYearEnd: () => undefined },
      async (_b, _w, params) => { seen.push(params); return []; },
    );
    await fetch({ widget_uuid: "c1", origin: "be" }, new AbortController().signal);
    expect(seen[0].symbol).toBe("MSFT");
  });
});
```
`ParamBinding = { groupId, paramName }` and `ParamGroup = { id, name, paramName, groupType, value }` are clean's shapes in `src/lib/types.ts`.

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/agent/execute.test.ts -t "effective inputs" --maxWorkers=2 --minWorkers=1 --testTimeout=60000`
Expected: FAIL — `expected 'AAPL' to be 'MSFT'` (or a type error on the new deps).

- [ ] **Step 4: Implement** — in `makeWidgetDataFetcher` replace `const params: Record<string, string> = { ...card.params };` with:

```ts
    const { groups, groupsDisabled } = deps.groups(card.id);
    const fiscalYearEnd = deps.fiscalYearEnd(card, widget);
    // What useWidgetData sends: bindings and groups applied, reserved pivot names dropped.
    const params: Record<string, string> = effectiveParams(card, groups, widget, groupsDisabled, fiscalYearEnd);
```
and pass `fiscalYearEnd` into `fetchData` in the position clean's `fetchWidgetData` takes it. In `chatStore.ts`, supply `groups` from the turn's dashboard (`groups`, `groupsDisabled` fields on `Dashboard`) and `fiscalYearEnd` from the same helper WidgetCard uses (found in Step 1; if it is a hook, call its underlying pure function).

- [ ] **Step 5: Run to verify it passes** — same command, plus the whole file. Expected: PASS.

- [ ] **Step 6: Commit** — `git commit -am` with message `feat(v6): get_widget_data reads the card's effective inputs (adaptation 2)` naming donor `3debd899e` (execute.ts) and ending with the Co-Authored-By line.

---

### Task 5: Adaptation 3 — `remove_widget` Undo restores the whole card

**Files:**
- Modify: `src/lib/agent/localTools.ts` (`remove_widget` branch)
- Test: `src/lib/agent/localTools.test.ts`

**Interfaces:**
- Consumes: clean `useDashboardStore` `removeCard(cardId)`, `pendingCardRemoval`, `undoCardRemoval()`; `LOCAL_TABLE_ID`.
- Produces: `remove_widget` refuses `local_table` with code `LOCAL_FILE_CARD`; its Undo entry throws `Error` when the removal is no longer the pending one.

- [ ] **Step 1: Write the failing tests** — append to `src/lib/agent/localTools.test.ts`:

```ts
describe("remove_widget undo (adaptation 3)", () => {
  const full = { id: "c1", backendId: "builtin", widgetId: "note", title: "Kept", params: { text: "x" }, layout: { x: 1, y: 2, w: 3, h: 4 },
    bindings: [{ paramName: "text", groupId: "g" }], table: { sorting: [{ id: "a", desc: true }] }, view: "raw", fiscalYearEnd: { text: 6 } } as unknown as DashboardCard;
  beforeEach(() => {
    useWidgetRegistryStore.getState().seedBuiltins();
    useDashboardStore.setState({ dashboards: [{ id: "d", name: "D", tabs: [{ id: "t", name: "T", cards: [{ ...full, id: "a0" }, full, { ...full, id: "z9" }] }] }], activeId: "d", activeTabId: "t", viewer: false, pendingCardRemoval: null });
  });
  it("re-inserts the identical card at its original tab and index", async () => {
    await executeLocalTool("remove_widget", { card_id: "c1" });
    await useAgentEditsStore.getState().undoLast();
    const cards = useDashboardStore.getState().dashboards[0].tabs[0].cards;
    expect(cards.map(c => c.id)).toEqual(["a0", "c1", "z9"]);
    expect(cards[1]).toEqual(full);
  });
  it("fails visibly once another removal superseded it", async () => {
    await executeLocalTool("remove_widget", { card_id: "c1" });
    await useDashboardStore.getState().removeCard("z9");
    await expect(useAgentEditsStore.getState().undoLast()).rejects.toThrow(/can no longer be undone/);
    expect(useAgentEditsStore.getState().entries).toHaveLength(1);
  });
  it("refuses to remove a CSV/XLS table card", async () => {
    useDashboardStore.setState(s => ({ dashboards: [{ ...s.dashboards[0], tabs: [{ id: "t", name: "T", cards: [{ ...full, widgetId: "local_table", params: { file: "f.csv" } }] }] }] }));
    expect(await executeLocalTool("remove_widget", { card_id: "c1" })).toMatchObject({ error: { code: "LOCAL_FILE_CARD" } });
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards).toHaveLength(1);
  });
});
```
(The donor test file already imports `useDashboardStore`, `useWidgetRegistryStore`, `useAgentEditsStore`; add `DashboardCard` from `../types` if missing.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec vitest run src/lib/agent/localTools.test.ts -t "adaptation 3" --maxWorkers=2 --minWorkers=1 --testTimeout=60000`
Expected: FAIL — the donor undo re-adds a new id and drops `bindings`/`fiscalYearEnd`; the local_table case removes the card.

- [ ] **Step 3: Implement** — replace the donor `remove_widget` branch body after `const { card, def } = found;` with:

```ts
    if (card.widgetId === LOCAL_TABLE_ID)
      return fail("LOCAL_FILE_CARD", `card ${cardId} is a CSV/XLS table; removing it deletes its stored file, so Rita may not remove it`);
    await dashboards.removeCard(cardId);
    // Clean keeps the exact card, tab and index; Undo is valid only while that entry is current.
    const entry = useDashboardStore.getState().pendingCardRemoval;
    if (entry?.card.id !== cardId) return fail("REMOVE_FAILED", `card ${cardId} could not be removed`);
    useAgentEditsStore.getState().push({
      summary: `Rita removed ${card.title ?? def.name}`,
      undo: async () => {
        if (useDashboardStore.getState().pendingCardRemoval !== entry)
          throw new Error(`Removing "${card.title ?? def.name}" can no longer be undone: another removal replaced it.`);
        await useDashboardStore.getState().undoCardRemoval();
      },
    });
    return { removed: true, card_id: cardId };
```
Import `LOCAL_TABLE_ID` from `../builtins`.

- [ ] **Step 4: Run to verify they pass** — same command, then the whole file. Expected: PASS.

- [ ] **Step 5: Commit** — message `feat(v6): remove_widget undo restores the whole clean card (adaptation 3)`, donor `3debd899e`, Co-Authored-By line.

---

### Task 6: Adaptation 4 — `add_note` / `set_markdown_content` persist byte for byte

**Files:**
- Test: `src/lib/agent/localTools.test.ts`
- Modify (only if RED): `src/lib/agent/localTools.ts`

**Interfaces:**
- Consumes: clean built-ins `note` (type `note`) and `markdown` (type `markdown_editor`), both with hidden param `text`; `src/lib/dashboardsFile.ts` persistence through `jsonStore` (memfs in tests).

- [ ] **Step 1: Write the pinning tests**

```ts
describe("markdown tools persist the tool input exactly (adaptation 4, #326)", () => {
  const tricky = "## Café\r\n\n- a  \n\t`x` — 💡\n\n";
  beforeEach(() => {
    useWidgetRegistryStore.getState().seedBuiltins();
    useDashboardStore.setState({ dashboards: [{ id: "d", name: "D", tabs: [{ id: "t", name: "T", cards: [] }] }], activeId: "d", activeTabId: "t", viewer: false, pendingCardRemoval: null });
  });
  it("add_note creates a clean markdown card whose saved text equals the input", async () => {
    const out = await executeLocalTool("add_note", { text: tricky });
    const saved = JSON.parse(__read("dashboards/d.json") ?? "{}");
    const card = saved.tabs[0].cards.find((c: DashboardCard) => c.id === out.card_id);
    expect(card.widgetId).toBe("markdown");
    expect(card.params.text).toBe(tricky);
  });
  it("set_markdown_content writes the note text unchanged", async () => {
    const out = await executeLocalTool("add_note", { text: "x" });
    await executeLocalTool("set_markdown_content", { card_id: out.card_id, text: tricky });
    const card = useDashboardStore.getState().dashboards[0].tabs[0].cards[0];
    expect(card.params.text).toBe(tricky);
  });
});
```
Import `__read` from `../../test/memfs` (the reader `src/stores/dashboardStore.test.ts` uses for persisted dashboards). The first assertion must read the persisted bytes, not the store.

- [ ] **Step 2: Run** — `pnpm exec vitest run src/lib/agent/localTools.test.ts -t "adaptation 4" --maxWorkers=2 --minWorkers=1 --testTimeout=60000`. Expected: PASS if clean already preserves bytes; if it FAILS, fix the narrowest cause (e.g. a trim in `set_widget_params` text validation) in `localTools.ts` only, rerun to PASS, and record the cause in the ledger.

- [ ] **Step 3: Commit** — message `test(v6): pin byte-exact markdown tool persistence (adaptation 4, #326)`, Co-Authored-By line.

---

### Task 7: Adaptation 5 — tool-round setting (default 40, range 1–40)

**Files:**
- Create: `src/lib/agent/limits.ts`, `src/lib/agent/limits.test.ts`
- Modify: `src/lib/agent/query.ts`, `src/lib/agent/query.test.ts`, `src/lib/types.ts`, `src/lib/settingsFile.ts`, `src/lib/settingsFile.test.ts`, `src/stores/settingsStore.ts`, `src/lib/settingsBundle.ts`, `src/lib/aiLibraryFile.ts`, `src/lib/aiLibraryFile.test.ts`, `src/stores/chatStore.ts`, `src/stores/chatStore.test.ts`

**Interfaces:**
- Produces: `DEFAULT_FUNCTION_ROUNDS = 40`, `MIN_FUNCTION_ROUNDS = 1`, `MAX_FUNCTION_ROUNDS = 40`, `normalizeFunctionRounds(value: unknown): number` in `src/lib/agent/limits.ts`; `Settings.ritaMaxFunctionRounds: number`; `RunAgentQueryOptions.maxFunctionRounds?: number`. `query.ts` no longer exports `MAX_FUNCTION_ROUNDS`.

- [ ] **Step 1: Write the failing tests**

`src/lib/agent/limits.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { DEFAULT_FUNCTION_ROUNDS, MAX_FUNCTION_ROUNDS, MIN_FUNCTION_ROUNDS, normalizeFunctionRounds } from "./limits";

it("keeps v6.2.1's proven 40-round default and only tightens", () => {
  expect([DEFAULT_FUNCTION_ROUNDS, MIN_FUNCTION_ROUNDS, MAX_FUNCTION_ROUNDS]).toEqual([40, 1, 40]);
  expect(normalizeFunctionRounds(undefined)).toBe(40);
  expect(normalizeFunctionRounds("12")).toBe(40);
  expect(normalizeFunctionRounds(0)).toBe(1);
  expect(normalizeFunctionRounds(99)).toBe(40);
  expect(normalizeFunctionRounds(7.6)).toBe(8);
});
```

In `src/lib/agent/query.test.ts` replace the donor case "gives up after MAX_FUNCTION_ROUNDS function rounds" (record the replacement in the ledger as a deliberate contract change from adaptation 5) with:

```ts
  it("stops at the configured round limit: final response allowed, no further tool, WARNING (adaptation 5)", async () => {
    const { calls, fetchImpl } = fetchOf([() => sse(fixture("function-call"))]);
    let executed = 0;
    const executeFunction = async (): Promise<AgentMessage> => { executed++; return { role: "tool", function: "x", input_arguments: {}, data: [] }; };
    const events: AgentEvent[] = [];
    const gen = runAgentQuery({ ...base, executeFunction, fetchImpl, maxFunctionRounds: 2 });
    let result = await gen.next();
    while (!result.done) { events.push(result.value); result = await gen.next(); }
    expect(executed).toBe(2);
    expect(calls).toHaveLength(3);
    expect(result.value.filter(m => m.role === "tool")).toHaveLength(2);
    expect(events).toContainEqual(expect.objectContaining({ type: "status", status: expect.objectContaining({ eventType: "WARNING" }) }));
    expect(events.some(e => e.type === "chunk" && /may be incomplete/.test(e.delta))).toBe(true);
  });
  it("defaults to 40 rounds when no limit is passed", async () => {
    const { calls, fetchImpl } = fetchOf([() => sse(fixture("function-call"))]);
    const executeFunction = async (): Promise<AgentMessage> => ({ role: "tool", function: "x", input_arguments: {}, data: [] });
    await collect(runAgentQuery({ ...base, executeFunction, fetchImpl }));
    expect(calls).toHaveLength(41);
  });
```
(Import `AgentEvent` from `./types` if the file lacks it; `collect`, `fetchOf`, `sse`, `fixture`, `base` are the file's existing helpers.)

Append to `src/lib/aiLibraryFile.test.ts` (a5229ea59's cases, re-bounded to 1–40):

```ts
describe("AI Library tool-round limit", () => {
  it("round-trips the limit and keeps the current choice when importing an older file", () => {
    const current = { ...DEFAULT_SETTINGS, ritaMaxFunctionRounds: 20 };
    expect(parseAiLibrary(exportAiLibrary(current), DEFAULT_SETTINGS)).toMatchObject({ ok: true, patch: { ritaMaxFunctionRounds: 20 } });
    expect(parseAiLibrary('{"ritaUrl":""}', current)).toMatchObject({ ok: true, patch: { ritaMaxFunctionRounds: 20 } });
    expect(parseAiLibrary('{"ritaMaxFunctionRounds":40}', current)).toMatchObject({ ok: true, patch: { ritaMaxFunctionRounds: 40 } });
  });
  it.each([0, 41, 2.5, "12", null])("refuses invalid imported limit %s", (value) => {
    expect(parseAiLibrary(JSON.stringify({ ritaMaxFunctionRounds: value }), DEFAULT_SETTINGS).ok).toBe(false);
  });
});
```
Also update the donor's "round-trips the five fields" case to six fields ending in `"ritaMaxFunctionRounds"`, as a5229ea59 does.

Append to `src/lib/settingsFile.test.ts`: `expect(withDefaults({}).ritaMaxFunctionRounds).toBe(40); expect(withDefaults({ ritaMaxFunctionRounds: 0 } as never).ritaMaxFunctionRounds).toBe(1);`

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec vitest run src/lib/agent/limits.test.ts src/lib/agent/query.test.ts src/lib/aiLibraryFile.test.ts src/lib/settingsFile.test.ts --maxWorkers=2 --minWorkers=1 --testTimeout=60000`
Expected: FAIL — missing `./limits`, `maxFunctionRounds` ignored, `ritaMaxFunctionRounds` undefined.

- [ ] **Step 3: Implement**

`src/lib/agent/limits.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

/** a5229ea59's mechanics with clean v6 bounds: the default keeps v6.2.1's #326 behaviour; the setting only tightens. */
export const DEFAULT_FUNCTION_ROUNDS = 40;
export const MIN_FUNCTION_ROUNDS = 1;
export const MAX_FUNCTION_ROUNDS = 40;

/** Shared by settings load/save and the executor; never permit an unbounded run. */
export function normalizeFunctionRounds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_FUNCTION_ROUNDS;
  return Math.min(MAX_FUNCTION_ROUNDS, Math.max(MIN_FUNCTION_ROUNDS, Math.round(value)));
}
```

Apply a5229ea59's hunks (read them with `git -C "$D" show "$ROUNDS" -- <file>`) to: `query.ts` (remove the exported `MAX_FUNCTION_ROUNDS = 40` and its ponytail comment; add `maxFunctionRounds?: number` option; loop bound `normalizeFunctionRounds(opts.maxFunctionRounds)`; on `round === maxFunctionRounds` yield the WARNING status and chunk and `return history`; after the loop `return history`), `types.ts` (`ritaMaxFunctionRounds: number` with its comment), `settingsFile.ts` (default + `normalizeFunctionRounds(loaded.ritaMaxFunctionRounds)` in `withDefaults`), `settingsStore.ts` (normalize on save), `settingsBundle.ts` (add `"ritaMaxFunctionRounds"` to the AI-keys union), `aiLibraryFile.ts` (field in the file type, export, and the range-checked import that only patches when present), `chatStore.ts` (`maxFunctionRounds: settings.ritaMaxFunctionRounds`, read from the turn-start `settings` snapshot). Any other file importing `MAX_FUNCTION_ROUNDS` from `./query` imports it from `./limits` instead.

Append to `src/stores/chatStore.test.ts` (a5229ea59's case verbatim; `replies`, `bodies` and the settings draft API are the file's existing helpers): it pins that a turn uses the **committed** limit (a staged, uncommitted draft value is ignored) and that partial tool history persists at the cap.

```ts
it("uses the committed Rita round limit and persists partial tool history at the cap", async () => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", ritaMaxFunctionRounds: 2 }, draft: null });
  useSettingsStore.getState().beginDraft();
  useSettingsStore.getState().stageDraft({ ritaMaxFunctionRounds: 8 });
  replies('event: copilotFunctionCall\ndata: {"function":"get_skill_content","input_arguments":{"slug":"missing"}}\n\n');
  await useChatStore.getState().send("test the tool limit");
  expect(bodies).toHaveLength(3);
  expect(useChatStore.getState().error).toBeNull();
  expect(useChatStore.getState().messages.filter((m) => m.role === "tool")).toHaveLength(2);
  expect(useChatStore.getState().trail).toContainEqual({ eventType: "WARNING", message: expect.stringContaining("2-round tool limit") });
  await useChatStore.getState().load();
  expect(useChatStore.getState().messages.filter((m) => m.role === "tool")).toHaveLength(2);
  useSettingsStore.getState().discardDraft();
});
```
If clean's `settingsStore` names the draft API differently (it is CLEAN-APPLY of the donor's, so it should match), use clean's names; keep every assertion.

- [ ] **Step 4: Run to verify they pass** — same command plus `src/stores/chatStore.test.ts src/lib/settingsBundle.test.ts src/stores/settingsStore.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — message `feat(v6): configurable Rita tool rounds, default 40, range 1-40 (adaptation 5)` naming `a5229ea59` (mechanics) and `3debd899e`, Co-Authored-By line.

---

### Task 8: Adaptation 7 — MCP 2.0.1 fixtures and protocol pins

**Files:**
- Create: `src/test/fixtures/mcp/v2.0.1-initialize.sse`, `src/test/fixtures/mcp/v2.0.1-tools-list.sse`
- Modify: `src/test/fixtures/mcp-fixtures.ts`, `src/lib/agent/mcp.test.ts`, `src/lib/agent/execute.test.ts`

**Interfaces:**
- Consumes: `callMcpTool`, `listMcpTools` (or the donor's actual list function) in `src/lib/agent/mcp.ts`; `executeFunction` in `execute.ts`.

- [ ] **Step 1: Capture and sanitize the 2.0.1 fixtures** from the step-1 Mac stack (MCP on `127.0.0.1:16911`; confirm the path with an `initialize` POST — if neither `/mcp` nor `/mcp/` answers, stop and ask):

```bash
MCP=${OPENBB_MCP_URL_LOCAL:-http://127.0.0.1:16911/mcp}
curl -sS -X POST "$MCP" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"bdobb","version":"6.0.0"}}}' -D /tmp/mcp-h.txt -o src/test/fixtures/mcp/v2.0.1-initialize.sse
```
Then `notifications/initialized` and `tools/list` with the returned `mcp-session-id` header into `v2.0.1-tools-list.sse`. Sanitize: replace any host, session id or path that names the machine with `example`; run `pnpm scrub` and confirm the new files pass.

- [ ] **Step 2: Write the failing tests** — in `src/lib/agent/mcp.test.ts`:

```ts
describe("MCP 2.0.1 (adaptation 7)", () => {
  it("lists the ten 2.0.1 tools including the search_tools/call_tool proxies", async () => {
    const tools = await listToolsFrom(MCP_201);       // helper in mcp-fixtures.ts replaying the two captures
    expect(tools.map(t => t.name)).toEqual(expect.arrayContaining(["search_tools", "call_tool"]));
    expect(tools).toHaveLength(10);
  });
  it("never names the 1.4.1 activation tools in client code", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [join(dir, e.name)] : []);
    const offenders = walk("src").filter(f => /activate_(category|tools)/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
```
In `src/test/fixtures/mcp-fixtures.ts` add `export const MCP_201 = { initialize: ..., toolsList: ... }` via `?raw` imports of the two new files, and `listToolsFrom(fixture)` that drives the real `mcp.ts` list function with a `fetchImpl` replaying them (follow the file's existing pattern for `initialize.sse`/`tools-list.sse`). In `execute.test.ts` add a case asserting a tool result's `extra_state` (e.g. `{ turn_usage: { input: 1 } }`) is echoed unchanged into the next request — find the donor's existing `extra_state` handling in `request.ts` and assert on `buildQueryRequest`'s output.

- [ ] **Step 3: Run** — `pnpm exec vitest run src/lib/agent/mcp.test.ts src/lib/agent/execute.test.ts src/test/fixtures --maxWorkers=2 --minWorkers=1 --testTimeout=60000`. Expected: the 2.0.1 list test FAILS only if the helper or parser does not accept the capture; fix the helper (not product code) unless the product parser genuinely rejects 2.0.1 output, in which case fix the parser and note it in the ledger. Re-run to PASS.

- [ ] **Step 4: Commit** — message `test(v6): MCP 2.0.1 initialize/tools-list fixtures and protocol pins (adaptation 7)`, Co-Authored-By line.

---

### Task 9: Settings defaults and service seeding

**Files:**
- Modify: `src/lib/settingsFile.ts`, `src/lib/settingsFile.test.ts`, `src/vite-env.d.ts`
- Create: `.env.example` lines only if the file exists (check `git ls-files .env.example`); otherwise document the two variables in the ledger

**Interfaces:**
- Produces: `withDefaults` seeds `ritaUrl` from `import.meta.env.VITE_DEFAULT_RITA_URL` and `mcpServers`/`mcpDisabledTools` from `VITE_DEFAULT_MCP_URL` **only when the key is absent from the loaded object**; seeded server `{ id: "openbq-mcp", name: "OpenBQ MCP", url, enabled: true }` with `mcpDisabledTools[normalizeMcpUrl(url)] = ["install_skill"]`.

- [ ] **Step 1: Write the failing tests** — append to `src/lib/settingsFile.test.ts`:

```ts
describe("v6 service seeding (VITE_DEFAULT_RITA_URL / VITE_DEFAULT_MCP_URL)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("defaults a v5 profile to Rita off, sharing off, no MCP, 40 rounds", () => {
    const s = withDefaults({ theme: "dark" });
    expect([s.ritaUrl, s.contextSharing, s.mcpServers, s.ritaMaxFunctionRounds]).toEqual(["", false, [], 40]);
  });
  it("seeds absent keys from the build variables", () => {
    vi.stubEnv("VITE_DEFAULT_RITA_URL", "https://YOUR-TAILNET.ts.net:10443");
    vi.stubEnv("VITE_DEFAULT_MCP_URL", "https://YOUR-TAILNET.ts.net:11443/mcp");
    const s = withDefaults({});
    expect(s.ritaUrl).toBe("https://YOUR-TAILNET.ts.net:10443");
    expect(s.mcpServers).toEqual([expect.objectContaining({ name: "OpenBQ MCP", url: "https://YOUR-TAILNET.ts.net:11443/mcp", enabled: true })]);
    expect(Object.values(s.mcpDisabledTools)).toEqual([["install_skill"]]);
  });
  it("never reseeds a user's explicit empty choice", () => {
    vi.stubEnv("VITE_DEFAULT_RITA_URL", "https://YOUR-TAILNET.ts.net:10443");
    vi.stubEnv("VITE_DEFAULT_MCP_URL", "https://YOUR-TAILNET.ts.net:11443/mcp");
    const s = withDefaults({ ritaUrl: "", mcpServers: [] });
    expect(s.ritaUrl).toBe("");
    expect(s.mcpServers).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm exec vitest run src/lib/settingsFile.test.ts -t "service seeding" --maxWorkers=2 --minWorkers=1 --testTimeout=60000`. Expected: the seeding case FAILS.

- [ ] **Step 3: Implement** — in `withDefaults` (after the donor's `ritaUrl`/`mcpServers`/`mcpDisabledTools` lines):

```ts
    ...seededServices(loaded),
```
with, above `withDefaults`:

```ts
/** Build-time defaults apply only to a key the file lacks, so a user's later "" or [] is never reseeded. */
function seededServices(loaded: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  const rita = import.meta.env.VITE_DEFAULT_RITA_URL;
  if (!("ritaUrl" in loaded) && typeof rita === "string" && safeUrl(rita) !== null) out.ritaUrl = rita;
  const mcp = import.meta.env.VITE_DEFAULT_MCP_URL;
  if (!("mcpServers" in loaded) && typeof mcp === "string" && safeUrl(mcp) !== null) {
    out.mcpServers = [{ id: "openbq-mcp", name: "OpenBQ MCP", url: mcp, enabled: true }];
    out.mcpDisabledTools = { ...coerceDisabledTools(loaded.mcpDisabledTools), [normalizeMcpUrl(mcp)]: ["install_skill"] };
  }
  return out;
}
```
Import `normalizeMcpUrl` from `./agent/mcp` (if that import would create a cycle reported by lint, copy no logic — instead move nothing and import from where `normalizeMcpUrl` actually lives). Add `readonly VITE_DEFAULT_RITA_URL?: string; readonly VITE_DEFAULT_MCP_URL?: string;` to `src/vite-env.d.ts`.

- [ ] **Step 4: Run** — same command plus whole file. Expected: PASS.

- [ ] **Step 5: Commit** — message `feat(v6): seed Rita/MCP defaults from optional build variables`, Co-Authored-By line.

---

### Task 10: UI layer — AI Library, Rita pane, rail and library

**Files:**
- Create (ADD): `src/components/ai/*`, `src/components/rita/*`
- Modify (CLEAN-APPLY): `src/components/RailIcon.tsx`, `src/components/LibraryFilters{,.test}.tsx`, `src/hooks/useHoverPanel{,.test}.ts`, `src/components/runAppsImport.ts`, `src/styles/dialogs.css`
- Modify (MERGE): `src/components/LeftRail.tsx`, `src/components/LeftRail.test.tsx`, `src/components/RailIcon.test.tsx`, `src/components/WidgetLibrary{,.test}.tsx`, `src/hooks/useDashboardShortcuts{,.test}.ts(x)`, `src/styles.css`

**Interfaces:**
- Consumes: Tasks 2–9.
- Produces: `LeftRail` prop `onOpenAI: () => void`; `<AILibrary onClose/>`, `<RitaPane/>`, `<AgentEditBar/>` components.

- [ ] **Step 1: RED** — `carry src/components/rita/RitaPane.test.tsx src/components/ai/AILibrary.test.tsx` then run them. Expected: FAIL (modules missing).

- [ ] **Step 2: ADD and CLEAN-APPLY**

```bash
. .superpowers/v6-helpers.sh
awk -F'\t' '$3=="ADD"{print $2}' docs/releases/v6-delta-manifest.tsv | grep -E '^src/components/(ai|rita)/' | while read p; do carry "$p"; done
for p in src/components/RailIcon.tsx src/components/LibraryFilters.tsx src/components/LibraryFilters.test.tsx src/hooks/useHoverPanel.ts src/hooks/useHoverPanel.test.ts src/components/runAppsImport.ts src/styles/dialogs.css; do same_base "$p" || { echo "NOT SAME-BASE $p"; break; }; carry "$p"; done
```

- [ ] **Step 3: MERGE**

```bash
. .superpowers/v6-helpers.sh
for p in src/components/LeftRail.tsx src/components/RailIcon.test.tsx src/components/WidgetLibrary.tsx src/components/WidgetLibrary.test.tsx src/hooks/useDashboardShortcuts.ts src/hooks/useDashboardShortcuts.test.tsx src/styles.css; do merge3 "$p"; echo "$? $p"; done
```
Expected conflicts: `RailIcon.test.tsx 1`, all others 0. **Do not** merge3 `LeftRail.test.tsx` (85 conflicts measured): keep clean's file and append the donor's new v6 cases — list them with `git -C "$D" diff "$BASE" "$V621" -- src/components/LeftRail.test.tsx | grep '^+\s*it(' ` and port each `it(...)` block whose title mentions AI Library, Rita or the hover delay, adapting only selectors that differ in clean.

- [ ] **Step 4: Run** — `pnpm typecheck && pnpm exec vitest run src/components/ai src/components/rita src/components/LeftRail.test.tsx src/components/RailIcon.test.tsx src/components/LibraryFilters.test.tsx src/components/WidgetLibrary.test.tsx src/hooks/useHoverPanel.test.ts src/hooks/useDashboardShortcuts.test.tsx --maxWorkers=2 --minWorkers=1 --testTimeout=60000`. Expected: PASS.

- [ ] **Step 5: Commit** — message `feat(v6): carry AI Library and Rita pane UI; rail/library/shortcut hunks` naming `3debd899e` and `77e4d32e0` (Skill editor), `bd95e91e2`, Co-Authored-By line.

---

### Task 11: App shell merge

**Files:**
- Modify (MERGE): `src/App.tsx`, `src/App.test.tsx`, `src/components/App.errorBoundaries.test.tsx`, `src/components/DropZone.test.tsx`, `src/browser-shim/shims.test.ts`

**Interfaces:**
- Consumes: Task 10 components; `saveImportedMcpServers`, `parseMcpServers`, `privateNetworkWarning`, `useAgentDiscovery`, `useChatStore`.
- Produces: `openApp(app, backendId)` saves the app's MCP servers with `{ kind: "backend", backendId }` provenance after the dashboard exists.

- [ ] **Step 1: RED** — `carry_from "$V621" src/App.test.tsx` into a temp path and grep its new Rita cases: `git -C "$D" diff "$BASE" "$V621" -- src/App.test.tsx | grep '^+\s*it('`. Note them.

- [ ] **Step 2: MERGE** — `for p in src/App.tsx src/App.test.tsx src/components/App.errorBoundaries.test.tsx src/components/DropZone.test.tsx src/browser-shim/shims.test.ts; do merge3 "$p"; echo "$? $p"; done`. Expected conflicts: `App.tsx 2`, `App.test.tsx 1`, `shims.test.ts 2`. Resolve with clean winning and re-apply exactly the v6 hunks: imports (`AILibrary`, `AgentEditBar`, `RitaPane`, `parseMcpServers`, `privateNetworkWarning`, `logInfo`, `useAgentDiscovery`, `useChatStore`, `saveImportedMcpServers`), `aiOpen` state, `ritaUrl`/`useAgentDiscovery(viewerId === null ? ritaUrl : "")`/`ritaPinned`, closing AI Library when the widget library opens and vice versa, `openApp(app, backendId)` with its own try/catch MCP save (keep clean's conflict-dialog `openApp` flow intact around it), the `rita-on`/`rita-pinned` shell classes, `onOpenAI`, `<AgentEditBar />`, the `RitaPane` and `AILibrary` error-boundary blocks, and `onOpen={(app, backendId) => void openApp(app, backendId)}`.

- [ ] **Step 3: Run** — `pnpm typecheck && pnpm exec vitest run src/App.test.tsx src/App.apps.test.tsx src/components/App.errorBoundaries.test.tsx src/components/DropZone.test.tsx src/browser-shim/shims.test.ts --maxWorkers=2 --minWorkers=1 --testTimeout=60000`. Expected: PASS, including clean's Apps conflict tests.

- [ ] **Step 4: Commit** — message `feat(v6): mount Rita pane, AI Library and app MCP import in App` naming `3debd899e`, Co-Authored-By line.

---

### Task 12: WidgetCard merge and `cardViews` from clean's modes

**Files:**
- Create: `src/lib/cardViews.ts`, `src/lib/cardViews.test.ts`
- Modify (MERGE): `src/components/WidgetCard.tsx`, `src/components/WidgetCard.test.tsx`

**Interfaces:**
- Produces: `export function availableViews(widget: WidgetDef | undefined, data: unknown, card: Pick<DashboardCard, 'linkedSource'>): ViewMode[]` where `ViewMode = { value: CardView | undefined; label: string }` — the exact list clean's `WidgetCard` `modes` memo builds today (table/default, chart, statement, calendar, raw, transposed); `TYPE_LABELS` moves with it. Part B's `describe_table` reports these.

- [ ] **Step 1: Write the failing test** — `src/lib/cardViews.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { availableViews } from "./cardViews";
import type { WidgetDef } from "./types";
const def = (type: string) => ({ id: type, backendId: "b", name: type, type, params: [], endpoint: "/x", source: [] }) as unknown as WidgetDef;

it("offers clean's views for a CSV/XLS table: default, Statement, Raw-less, Transposed; never the donor's pivot", () => {
  const views = availableViews(def("local_table"), null, {}).map(v => v.value ?? "table");
  expect(views).toContain("table");
  expect(views).toContain("statement");
  expect(views).toContain("transposed");
  expect(views).not.toContain("pivot");
});
it("offers Chart and Calendar only when the data supports them", () => {
  const rows = [{ date: "2026-01-02", close: 1 }, { date: "2026-01-03", close: 2 }];
  const views = availableViews(def("table"), rows, {}).map(v => v.value);
  expect(views).toEqual(expect.arrayContaining(["chart", "calendar", "raw", "transposed"]));
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm exec vitest run src/lib/cardViews.test.ts --maxWorkers=2 --minWorkers=1 --testTimeout=60000`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement by extraction** — move clean's `TYPE_LABELS` and the body of the `modes` `useMemo` in `src/components/WidgetCard.tsx` (lines ~518–560 on clean v5: chart via `rowsOf`/`detectChartAxis`, statement via `detectStatement`, calendar via `detectDateColumn`, raw via `fetchesData`, transposed via `tableRows`) verbatim into `availableViews(widget, data, card)` in `src/lib/cardViews.ts`, with the imports those helpers need. In WidgetCard: `const modes: ViewMode[] = useMemo(() => availableViews(widget, data, card), [widget, data, card.linkedSource]);`. Do not carry the donor's `cardViews.ts` (it imports the absent `lib/pivot`).

- [ ] **Step 4: MERGE WidgetCard** — `merge3 src/components/WidgetCard.tsx; merge3 src/components/WidgetCard.test.tsx`. Expected conflicts 3 and 1. Keep clean; re-apply only: imports `isAgentOffLimits`, `keyMaintBackendIds`, `useChatStore`; `contextSharing`, `ritaUrl`, `sharedWithRita`, `toggleShared`, `offLimits`, `canShare`; the `onSendToAgent` prop on the table renderer (absent for viewer or `ritaUrl === ""`); the "Shared with Rita" chip; the "Share with Rita"/"Stop sharing with Rita" menu item. Drop the donor's own `modes` rewrite (Step 3 replaced it). In the test file keep every clean assertion and add the donor's share-chip and send-to-agent cases.

- [ ] **Step 5: Run** — `pnpm typecheck && pnpm exec vitest run src/lib/cardViews.test.ts src/components/WidgetCard.test.tsx --maxWorkers=2 --minWorkers=1 --testTimeout=60000`. Expected: PASS.

- [ ] **Step 6: Commit** — message `feat(v6): per-card Rita sharing; availableViews extracted from clean modes` naming `3debd899e`, Co-Authored-By line.

---

### Task 13: TableRenderer `sendToAgent` cell action

**Files:**
- Modify (MERGE): `src/components/renderers/TableRenderer.tsx`, `src/components/renderers/TableRenderer.test.tsx`
- Record CLEAN-WINS: `src/lib/pivotConfig.ts`, `src/lib/pivotConfig.test.ts`, `src/components/renderers/PivotPanel.tsx` (no edit)

**Interfaces:**
- Consumes: `TableColumn.sendToAgent` (Task 2), `fillRowTemplate` from `src/lib/rowTemplate.ts`.
- Produces: `TableViewProps.onSendToAgent?: (text: string, agentId?: string) => void`; active on leaf rows only.

- [ ] **Step 1: MERGE** — `merge3 src/components/renderers/TableRenderer.tsx; merge3 src/components/renderers/TableRenderer.test.tsx` (expected 3 and 1). Re-apply: `fillRowTemplate` import, the `onSendToAgent` prop and its destructure, and the `activate` computation (send-to-agent first, then clean's cell click, both only when `!rowMeta || rowMeta.kind === "leaf"`), replacing the inline `onCellClick(...)` call with `activate()`. In tests keep clean's and add the donor's 67-line send-to-agent block.

- [ ] **Step 2: Add the group-row guard test** (if the donor block lacks it):

```ts
it("renders a sendToAgent cell on a pivot group row as plain text", async () => {
  const send = vi.fn();
  renderPivotedWithSendToAgent({ onSendToAgent: send });   // use the donor block's render helper with grouping enabled
  expect(screen.queryByRole("button", { name: /Send .* to Rita/ })).toBeNull();
});
```
Adapt the helper name and accessible name to what the donor block actually uses.

- [ ] **Step 3: Run** — `pnpm exec vitest run src/components/renderers/TableRenderer.test.tsx src/components/renderers/PivotPanel.test.tsx src/lib/pivotConfig.test.ts --maxWorkers=2 --minWorkers=1 --testTimeout=60000`. Expected: PASS.

- [ ] **Step 4: Commit** — message `feat(v6): sendToAgent cell action on leaf rows` naming `3debd899e`; ledger row records the three CLEAN-WINS files. Co-Authored-By line.

---

### Task 14: AI Library ▸ Agents round control

**Files:**
- Modify: `src/components/ai/AgentsTab.tsx`, `src/components/ai/AgentsTab.test.tsx`

**Interfaces:**
- Consumes: `DEFAULT_FUNCTION_ROUNDS`, `MIN_FUNCTION_ROUNDS`, `MAX_FUNCTION_ROUNDS` (Task 7); the AI Library's staged-draft `stage(...)`/Done/Cancel mechanism already in AgentsTab.

- [ ] **Step 1: Write the failing test** (port a5229ea59's AgentsTab cases with the new bounds):

```ts
it("offers 1-40 rounds with 40 marked default, persists on Done and discards on Cancel", async () => {
  renderAiLibraryOnAgents();                                    // the file's existing render helper
  const select = screen.getByLabelText("Maximum tool rounds") as HTMLSelectElement;
  expect([...select.options].map(o => o.value)).toEqual(Array.from({ length: 40 }, (_, i) => String(i + 1)));
  expect(select.selectedOptions[0].textContent).toBe("40 (default)");
  fireEvent.change(select, { target: { value: "12" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(useSettingsStore.getState().settings.ritaMaxFunctionRounds).toBe(40);
  renderAiLibraryOnAgents();
  fireEvent.change(screen.getByLabelText("Maximum tool rounds"), { target: { value: "12" } });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(useSettingsStore.getState().settings.ritaMaxFunctionRounds).toBe(12));
});
```
Use the helper and button names the file actually uses (`git -C "$D" show "$ROUNDS" -- src/components/ai/AgentsTab.test.tsx` shows the original).

- [ ] **Step 2: Run to verify it fails.** Expected: FAIL — label not found.

- [ ] **Step 3: Implement** — apply a5229ea59's AgentsTab hunk (the `select` row with hint text) verbatim; its loop already uses `MIN..MAX` and `DEFAULT`, which now resolve to 1, 40, 40.

- [ ] **Step 4: Run to verify it passes.** Then commit — message `feat(v6): AI Library tool-round control (a5229ea59, bounds 1-40)`, Co-Authored-By line.

---

### Task 15: Native share-folders capability and build hooks

**Files:**
- Create (ADD): `scripts/generate-capabilities.mjs`, `scripts/generate-capabilities.test.mjs`
- Modify: `src-tauri/tauri.conf.json` (before-commands), `package.json` (`capabilities` script; MERGE), `.gitignore`, `scripts/scrub-check.sh` (CLEAN-APPLY)

- [ ] **Step 1: RED** — `carry scripts/generate-capabilities.test.mjs && pnpm exec vitest run scripts/generate-capabilities.test.mjs --maxWorkers=2 --minWorkers=1 --testTimeout=60000`. Expected: FAIL (generator missing).

- [ ] **Step 2: Carry and apply**

```bash
. .superpowers/v6-helpers.sh
carry scripts/generate-capabilities.mjs
for p in .gitignore scripts/scrub-check.sh; do same_base "$p" || { echo "NOT SAME-BASE $p"; break; }; carry "$p"; done
merge3 package.json; echo $?; merge3 src-tauri/tauri.conf.json; echo $?
```
Resolve `package.json` keeping clean's name/version/scripts and adding only `"capabilities": "node scripts/generate-capabilities.mjs"`; resolve `tauri.conf.json` keeping version 6.0.0 and clean identity, with `beforeDevCommand: "node scripts/generate-capabilities.mjs && vite"` and `beforeBuildCommand: "node scripts/generate-capabilities.mjs && vite build"`. Leave `Cargo.toml`/`Cargo.lock` at Task 1's state (the donor delta there is only the version).

- [ ] **Step 3: Run**

```bash
pnpm exec vitest run scripts/generate-capabilities.test.mjs --maxWorkers=2 --minWorkers=1 --testTimeout=60000
pnpm capabilities && git status --short src-tauri/capabilities   # generated file must be ignored
pnpm scrub
cargo check --manifest-path src-tauri/Cargo.toml --locked --offline -j 2
```
Expected: PASS; no untracked capability file listed; scrub passes; cargo check finishes.

- [ ] **Step 4: Commit** — message `feat(v6): generated share-folders capability and .env scrub exclusion` naming `3debd899e`, Co-Authored-By line.

---

### Task 16: Browser harness, e2e specs and the Rita sample

**Files:**
- Create (ADD): `e2e/rita.spec.ts`, `e2e/ai-library.spec.ts`, `e2e/agent-options.spec.ts`, `docs/examples/v6.0.0-rita.apps.json`
- Modify (MERGE): `scripts/browser-fixtures.mjs`, `e2e/fixtures.ts`, `e2e/ai-library.spec.ts` (+ a5229ea59 case), `src/lib/appsJson.examples.test.ts`

- [ ] **Step 1: Carry**

```bash
. .superpowers/v6-helpers.sh
for p in e2e/rita.spec.ts e2e/ai-library.spec.ts e2e/agent-options.spec.ts docs/examples/v6.0.0-rita.apps.json; do carry "$p"; done
merge3 scripts/browser-fixtures.mjs; echo $?; merge3 e2e/fixtures.ts; echo $?
```
In `browser-fixtures.mjs` keep only the `RITA_AGENTS_JSON`, `/agents.json` and `/v1/query` hunks now; the `/rita-arrange/*` routes are rewritten in Part B. Apply a5229ea59's `e2e/ai-library.spec.ts` hunk with option counts 40 and default 40.

- [ ] **Step 2: Add the sample to the examples test** — in `src/lib/appsJson.examples.test.ts` add `"v6.0.0-rita.apps.json"` to the decoded-examples list (follow the file's existing per-file pattern) and assert it uses only `clock`, `markdown`, `note`.

- [ ] **Step 3: Run**

```bash
pnpm exec vitest run src/lib/appsJson.examples.test.ts --maxWorkers=2 --minWorkers=1 --testTimeout=60000
pnpm exec playwright test e2e/rita.spec.ts e2e/ai-library.spec.ts e2e/agent-options.spec.ts e2e/markdown.spec.ts
```
Expected: PASS.

- [ ] **Step 4: Commit** — message `test(v6): Rita, AI Library and agent-options browser specs; v6.0.0 Rita sample (PR #179 a616a7a87)`, Co-Authored-By line.

---

### Task 17: Proxied MCP tool names — enforcement, display and AI Library control (user-approved scope, 2026-10-07)

The OpenBQ MCP (openbb-mcp-server 2.0.1) advertises only 10 discovery tools; real provider tools run through two proxies whose live schemas are `call_tool` `{name: string (required), arguments?: object|null}` and `run_pipeline` `{steps: [{tool: string, arguments?: object, id?: string|null, inputs?: object}], outputs?: string[]|null}`. Per-tool disable (`Settings.mcpDisabledTools`, keyed by normalized server URL then tool name) and the approval/activity display currently see only the advertised name `call_tool`. This task makes both see the *effective* name(s).

**Files:**
- Create: `src/lib/agent/proxiedTools.ts`, `src/lib/agent/proxiedTools.test.ts`, `e2e/proxied-tools.spec.ts`
- Modify: `src/lib/agent/execute.ts` (`runAgentTool` enforcement, `executeFunction` activity labelling), `src/lib/agent/execute.test.ts`, `src/stores/chatStore.ts` (pass `disabledTools`, record seen names), `src/stores/chatStore.test.ts`, `src/lib/types.ts`, `src/lib/settingsFile.ts`, `src/lib/settingsFile.test.ts`, `src/stores/settingsStore.ts`, `src/lib/settingsBundle.ts`, `src/lib/settingsBundle.test.ts`, `src/components/ai/McpServersTab.tsx`, `src/components/ai/McpServersTab.test.tsx`, every `src/components/rita/*` component that renders a tool name (approval prompt, activity trail, tool chips) and its test, `src/lib/agent/mcp.test.ts` (schema pins), `scripts/browser-fixtures.mjs` (MCP stub route)
- Part C Task 1/2 carries the Help text for this task (the MCP/permissions pages do not exist in clean before Part C); see the pin added there.

**Interfaces:**
- Consumes: Task 3 `execute.ts` (`refusalOf`, `deps.onToolError` counting from #323), Task 8 fixture `src/test/fixtures/mcp/v2.0.1-tools-list.sse` (`MCP_201`), Task 10 `McpServersTab` staged-draft `stage(...)`/Done/Cancel, Task 9 settings defaults, `coerceDisabledTools`.
- Produces: in `proxiedTools.ts`: `PROXY_TOOLS = ["call_tool", "run_pipeline"]`; `effectiveToolNames(tool: string, args: unknown): { ok: true; names: string[]; via?: string } | { ok: false; message: string }` — `call_tool` → `[args.name]`, `run_pipeline` → every `steps[].tool`, anything else → `[tool]`; malformed proxy input (missing or non-string `name`/`tool`, `steps` not an array or empty, `arguments` neither object nor null/undefined) → `ok: false`; `displayToolName(server: string, tool: string, args: unknown): string` — `"<server> · <name> (via call_tool)"`, pipeline `"<server> · pipeline: a → b → c (via run_pipeline)"`, plain `"<server> · <tool>"`; `disabledEffective(url: string, tool: string, args: unknown, disabled: Record<string,string[]> | undefined): { disabled: string[] } | { malformed: string } | null`. `Settings.mcpSeenProxiedTools: Record<string, string[]>` (default `{}`, same coercion as `coerceDisabledTools`, normalized URL keys, de-duplicated, sorted, capped at 500 names per server). `runAgentTool` gains a final optional parameter `opts?: { disabledTools?: Record<string, string[]>; onEffective?: (url: string, names: string[]) => void }`.

- [ ] **Step 1: Write the failing unit tests** — create `src/lib/agent/proxiedTools.test.ts` with cases: (a) `call_tool` with `{name:"equity_price_historical", arguments:{symbol:"AAPL"}}` → names `["equity_price_historical"]`, `via: "call_tool"`; (b) `run_pipeline` with three steps → three names in order; (c) any other tool → its own name; (d) malformed: `call_tool` with no `name`, numeric `name`, `arguments:"x"`; `run_pipeline` with `steps` missing, `steps:{}`, `steps:[]`, a step with no `tool`, a step with non-string `tool` → each `ok:false` with a message naming what is wrong; (e) `displayToolName` strings exactly as in Interfaces, including a three-step pipeline; (f) `disabledEffective` returns the disabled subset when ANY effective name is disabled for that URL only (a name disabled on server A does not block server B), returns `{ disabled: ["call_tool"] }` when the proxy itself is disabled, and `null` when none. In `execute.test.ts` add: `runAgentTool` with a disabled proxied name does not invoke the `call` spy and returns `{ error: { code: "TOOL_DISABLED", message } }` whose message names the disabled tool; `run_pipeline` with one disabled step among three is refused as a whole and `call` is never invoked; a malformed proxy call returns `{ error: { code: "INVALID_PROXY_CALL", message } }` and `call` is never invoked; `executeFunction` for that case returns the typed error item first inside `data: [{ items }]` and calls `onToolError` exactly once with the code (the #323 counting); disabling `call_tool` itself refuses every call_tool call. In `mcp.test.ts` add schema pins from `MCP_201`: `call_tool.inputSchema.required` equals `["name"]`, `run_pipeline` step schema has `tool` required, and the sanitized fixture contains no host name. In `settingsFile.test.ts`/`settingsBundle.test.ts`: `mcpSeenProxiedTools` defaults to `{}`, survives a load/save round trip, is exported and re-imported by the bundle, an import without the key keeps the current value, a malformed value is refused with the same wording style as `mcpDisabledTools`. In `McpServersTab.test.tsx`: the server row lists the effective names seen for that URL (de-duplicated), a typed name can be added, unchecking a listed name stages it in `mcpDisabledTools[url]` using the existing shape, Done persists and Cancel discards, and a name that is both advertised and seen is not shown twice. In the Rita component tests: the approval prompt, activity step and tool chip render `displayToolName` output for a `call_tool` call and the pipeline step list for `run_pipeline`.

- [ ] **Step 2: Run to verify RED**

```bash
pnpm exec vitest run src/lib/agent/proxiedTools.test.ts src/lib/agent/execute.test.ts src/lib/agent/mcp.test.ts src/lib/settingsFile.test.ts src/lib/settingsBundle.test.ts src/components/ai/McpServersTab.test.tsx src/stores/chatStore.test.ts --maxWorkers=2 --minWorkers=1 --testTimeout=60000 2>&1 | tail -30
```
Expected: FAIL — `proxiedTools` unresolved and the new settings/UI/display assertions failing.

- [ ] **Step 3: Implement** — `proxiedTools.ts` as specified. In `runAgentTool`, before any `call(...)` and before resolving a widget-derived URL's session, compute `disabledEffective(normalizeMcpUrl(url), tool, args, opts.disabledTools)`; on a hit return `{ error: { code: "TOOL_DISABLED", message: "<name> is turned off for <server> in AI Library > MCP Servers; it was not sent." } }`, on `malformed` return the `INVALID_PROXY_CALL` error; nothing is forwarded in either case. After a successful call invoke `opts.onEffective?.(url, names)`. `chatStore` passes `settings.mcpDisabledTools` and an `onEffective` that merges new names into `mcpSeenProxiedTools` through the settings store's persisted setter only when a name is new (no write per call). Refusals reach Rita through the existing `refusalOf`/`onToolError` path unchanged (do not add a second counter). `executeFunction` and the Rita components label with `displayToolName`. `McpServersTab` adds, beneath the advertised tool list, a "Tools called through proxies" list (seen names, each a checkbox) and a text field with an Add button for a typed name, writing the existing `mcpDisabledTools[url]` shape through `stage(...)`. Add `mcpSeenProxiedTools` to `Settings`, defaults, load coercion and the bundle key list beside `mcpDisabledTools`.

- [ ] **Step 4: Add the browser round trip** — in `scripts/browser-fixtures.mjs` add an MCP stub route serving the `MCP_201` initialize/tools-list captures and a `call_tool` result; create `e2e/proxied-tools.spec.ts`: in AI Library > MCP Servers disable the proxied tool `equity_price_historical` (typed name, Done), then drive Rita's mocked query to call `call_tool` for it; assert the stub received no `tools/call`, the chat shows the refusal naming the tool with the label `equity_price_historical (via call_tool)`, and the error count reads 1.

- [ ] **Step 5: Run to verify GREEN**

```bash
pnpm typecheck 2>&1 | tail -5
pnpm exec vitest run src/lib/agent/proxiedTools.test.ts src/lib/agent/execute.test.ts src/lib/agent/mcp.test.ts src/lib/settingsFile.test.ts src/lib/settingsBundle.test.ts src/components/ai src/components/rita src/stores/chatStore.test.ts --maxWorkers=2 --minWorkers=1 --testTimeout=60000 2>&1 | tail -15
pnpm exec playwright test e2e/proxied-tools.spec.ts e2e/rita.spec.ts e2e/ai-library.spec.ts
pnpm scrub
```
Expected: all PASS; scrub clean (the fixture carries no real host).

- [ ] **Step 6: Commit** — message `feat(v6): per-tool disable and display see proxied MCP tool names (call_tool, run_pipeline)` naming that this is user-approved scope beyond the donor, with the Co-Authored-By line.

---

### Task 18: Part A gate

**Files:**
- Create: `docs/releases/validation/v6/part-a/{typecheck,lint,unit,build,e2e-v6,web,cargo,scrub}.log`
- Modify: `docs/releases/v6-assembly.md` (step rows, results)

- [ ] **Step 1: Run every gate, logging separately**

```bash
V=docs/releases/validation/v6/part-a; mkdir -p $V; uptime | tee $V/load.txt
pnpm typecheck > $V/typecheck.log 2>&1; echo "typecheck $?"
pnpm lint > $V/lint.log 2>&1; echo "lint $?"
pnpm exec vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=60000 > $V/unit.log 2>&1; echo "unit $?"
pnpm build > $V/build.log 2>&1; echo "build $?"
pnpm exec playwright test > $V/e2e.log 2>&1; echo "e2e $?"
pnpm test:web > $V/web.log 2>&1; echo "web $?"
cargo check --manifest-path src-tauri/Cargo.toml --locked --offline -j 2 > $V/cargo.log 2>&1; echo "cargo $?"
pnpm scrub > $V/scrub.log 2>&1; echo "scrub $?"
```
Expected: every exit 0. Reference-backend tests skip without Docker (record the count). If the unit run times out under load, rerun only the failing files with the same flags and record the composite result honestly in the ledger (do not call it one all-green run).

- [ ] **Step 2: Fix forward** — any red test: use superpowers:systematic-debugging, fix the cause in the owning task's files, never delete or weaken an assertion without a ledger warning.

- [ ] **Step 3: Commit**

```bash
git add docs/releases/validation/v6/part-a docs/releases/v6-assembly.md
git commit -m "chore(v6): Part A assembly gate receipts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
