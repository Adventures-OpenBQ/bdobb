# Shared secret and publication gate

Canonical source: `artcashin/adventures-in-openbb-articles/security`. The app and Docker repos vendor the same runner, tests, installer and policy. No sibling checkout or service is needed at scan time. On macOS, install publication extractors with `brew install tesseract poppler sevenzip`; on Ubuntu use the corresponding Tesseract, Poppler and 7zip packages. GitProxy is not used.

Requires Python 3.11+ and **Gitleaks 8.30.1**. Install with `python3 security/install.py` (reviewed SHA256 pins for macOS/Linux/Windows, ARM64/x64). The gate finds `gitleaks` on PATH or in `~/.local/bin`; `GITLEAKS_BIN` selects an explicit binary. Scans never download or silently skip the scanner.

Publication GIF extraction also requires **Pillow 13.0.0**, pinned separately
from application dependencies. In the Python environment used for the gate,
run `python3 -m pip install --require-hashes -r security/requirements.txt`.
Use a virtual environment when the system Python is externally managed. The
requirements permit only checksum-verified wheels; a missing or mismatched
decoder blocks GIF publication. Neither SDK nor Workspace runtime packages
are changed by this scanner dependency.

```sh
python3 security/gate.py staged                      # exact index bytes
python3 security/gate.py tree                        # current tracked files
python3 security/gate.py history --revision HEAD     # committed ancestry, including deleted secrets
python3 security/gate.py history --revision=--all    # audit all locally reachable branches/tags
python3 security/gate.py artifacts dist/article.pdf release/source.zip
python3 security/gate.py publish --artifact release/source.zip -- gh release upload vX release/source.zip
```

Run from the repo root or use `--repo /path` before the subcommand. `--report /path/report.json` writes only rule/path/line/blob metadata; matched values never go into the report or terminal. History scans every unique reachable blob, with the blob ID recorded so even removed binary-named files can be inspected with `git show <blob-id>`. A blocked scan exits 1; scanner/extractor/configuration errors exit 2. Both block publication.

## Policy

Gitleaks' built-in credential rules plus explicit `tskey-` auth (including the legacy format), API, OAuth client and future-variant credentials, Tailscale persisted `privkey:` node/machine keys, and private-key headers. Decoding is enabled to depth 3. Inline `gitleaks:allow` and `scrub-allow` comments and `.gitleaksignore` do not bypass this gate. Files are flattened to text inputs so Gitleaks default path exclusions do not exempt lockfiles/vendor files/binary filenames from tree, history or artifact scans. Binary bytes are also inspected for printable strings; this does not promise detection of encrypted, split or obfuscated secrets.

Privacy rules detect all non-placeholder `*.ts.net` hostnames, CGNAT addresses, RFC1918 addresses, and Tailscale IPv6 addresses. Explicit placeholders such as `host.your-tailnet.ts.net` and documentation addresses such as `192.0.2.1` are safe examples. Privacy details are not credentials and do not themselves require key rotation.

`privacy-exceptions.json` may allow a **specific path + rule + SHA256 of the exact line**, with a reason, for an intentional public networking example. Artifact exceptions use the exact reported path, including archive names and member paths (for example `source.zip!project/security/test_gate.py`). No directories or archive names are stripped; basenames and globs are never matched. The shipped exceptions cover only the scanner's own reserved-range definitions and synthetic regression fixtures. It never suppresses credential rules. A separate `reviewed-fixtures.json` can classify a verified synthetic credential false positive using **path + rule + SHA256 of the entire normalized file** (`content_sha256`) and a reason; changing any part of that file invalidates its exception. This also protects multiline keys from header-only exceptions. These files start empty; no existing credential findings were automatically exempted. There is no blanket baseline of existing findings. Existing ignored `scripts/scrub-private-patterns.txt` files are loaded automatically (including from the main checkout for linked worktrees). The optional `SECRET_GATE_PRIVATE_PATTERNS_FILE` overrides that lookup and is a required-to-exist file when specified, containing one regex per non-comment line. Inject private literals through a secret store, not tracked configuration. Malformed regexes fail closed.

## Artifact and release coverage

`artifacts` reads actual files independent of gitignore and recurses through ZIP (including Office files), tar and compressed archives. It rejects traversal, links, malformed/empty inputs, depth over 8, compressed expansion over 200 times the compressed size (with an 8 MiB floor), oversized files, more than 250,000 scanned files, and total scanned content over 20 GiB. Individual non-archive files are limited to 512 MiB. ZIP members are limited to 512 MiB. This is a budget, not permission to skip files.

PNG/JPEG/GIF/WebP/TIFF/BMP images require `tesseract`. PDFs require `pdfinfo`, `pdfdetach`, `pdftotext`, `pdftoppm` and `tesseract`: metadata, attachments, raw bytes, extracted text and all rendered pages are scanned (maximum 500 pages). OCR is best effort detection; visually review public screenshots and PDFs too. Known movie/audio/disk/Linux package formats without an extractor are blocked. Unrecognized opaque formats are inspected for printable strings, not semantically decoded; review those formats separately. macOS DMGs are mounted read-only; `.app` framework links within the mount and the standard `/Applications` shortcut are accepted, never followed. Windows installers and 7z/RAR packages require `7z` or `7zz` extraction; macOS PKG packages require `pkgutil --expand-full`. Missing extractors block publication.

GIFs are decoded frame by frame with disposal/compositing preserved, then
each distinct rendered pixel image is OCR-scanned. Transparent frames are
rendered against both white and black canvases so neither light nor dark text
is lost. Only exact duplicate rendered pixels share an OCR result; each
logical frame path still receives its own privacy and credential checks.
There is no temporal sampling. Raw GIF metadata remains scanned independently. The
per-file limits are 500 frames, 40 million pixels per frame and 500 million
decoded pixels total. Truncation, decoding errors, budget exhaustion and an
OCR error in any frame block publication; no image exception is introduced.
A bounded structure pass checks the complete block lengths, palette/control
records, final trailer, frame count and containment in the logical canvas
before Pillow opens the immutable byte snapshot. Plain-text graphics and
unknown rendering extensions are blocked because this decoder cannot
composite them. Oversized raw files are rejected before payload reads, which
are also size-bounded to protect against a changing file.
Legacy sentinel background indices are accepted only for a single full-canvas
transparent image, where that index cannot supply pixels. Such images still
receive both canvas renderings and all ordinary checks; animations and partial
images with invalid background indices remain blocked.

The desktop `scripts/release.sh` checks source/history before accessing signing values and scans the final DMG and checksum before any GitHub upload. Its dry run also scans. Signing/notarization remains unchanged.

Vendoring this runner does not create an automated publisher. The V1 and V2 backend release lines have source/history CI only; their release walk uses a separately guarded manual image/asset publisher. If an automated historical-release workflow is added, it must check out the **workflow's security policy separately** before checking out the requested historical tag, taking both the runner and reviewed policies from the workflow revision. `image-gate.sh` builds with `--load`, saves the immutable local image ID, scans configuration and **every layer**, then pushes the same ID. Every build context receives the shared secret Docker exclusions, merged with existing ignore rules and restored after the build. GitHub checkout credentials are not persisted in the release checkouts. Layer links/whiteouts are metadata, never extracted or followed. Removed-in-a-later-layer secrets remain detectable. There is no remote build cache export before scanning. This protects future gated publications; it does not scan images already in GHCR or invalidate existing assets.

There is no article uploader in the article repo. Use `publish --artifact ... -- UPLOAD_COMMAND ...` for every final PDF, bundle or source package. It executes that command only after every declared artifact passes. Declare all uploaded artifacts and keep them unchanged until upload; arbitrary external CLI/UI uploads cannot be intercepted by repository scripts.

## Local hooks and CI

Install local hooks with `bash scripts/install-security-hooks.sh`. This audit activated the new hooks in the three working checkouts; fresh clones still need installation. Docker preserves the previous CodeGraph post hooks through forwarding wrappers. The app already installs `.githooks` through `pnpm install`. Pre-commit scans the index; pre-push consumes Git's ref-update stdin and scans every non-deletion pushed commit (including annotated tags and branches other than HEAD). Existing app lint/typecheck and CodeGraph hooks are preserved. Hooks are convenience checks and can be bypassed with Git options: repository branch protection is the enforcement boundary for CI.

Every CI scrub job scans source plus full HEAD history (`fetch-depth: 0`), verifies the shared digest manifest, and runs behavioral regression tests. The app reuses its already-required `scrub` check. Require the actual repository check name in branch protection: the backend workflow is `Public content` and its job/check is `public-content`; do not assume it is called `scrub`. CI is post-push and cannot prevent initial exposure to a remote; GitHub push protection is an additional control subject to plan/support. Inspect the actual repository configuration rather than inferring protection settings from this shared document.

Existing findings intentionally block the gate until reviewed and removed or narrowly classified. Never add real secrets to tests or allowlists. Rotate exposed live credentials before cleaning history.

## Updating the shared implementation

Edit the canonical files and run the tests, then:

```sh
python3 security/sync.py ../bdobb-v2 ../openbb-docker
python3 security/sync.py --check ../bdobb-v2 ../openbb-docker
python3 -m unittest discover -s security -p test_gate.py
```

Each repo keeps its own `privacy-exceptions.json` and `reviewed-fixtures.json`; sync never overwrites them. Review scanner upgrades and checksum changes together. The manifest detects accidental drift, not a malicious change by someone able to rewrite both the policy and manifest.

Historical tags retain their historical workflow files. Do not trigger a backfill by pushing an old tag with an ungated workflow; dispatch the updated release workflow from the branch carrying this gate. Existing published images/source archives and out-of-band uploads are outside this enforcement boundary.

The pre-push hook scans objects introduced by each pushed ref against commits advertised by the actual destination. It does a full scan for a new remote and fails if it cannot read that remote. CI and release history checks still scan full ancestry, including existing findings.

## Exact scientific vendor WAV reviews

`image-archive` can consume `--reviewed-vendor-media /path/to/reviews.json`
(default `security/reviewed-vendor-media.json`). This is limited to WAV
resources inside container images. Each JSON row must contain exactly:

- `path`: the full archive/member label, including each outer archive;
- `raw_sha256`: SHA256 of the exact binary bytes, without normalization;
- `source_url`: the official HTTPS `files.pythonhosted.org/packages/…whl` URL;
- `source_sha256`: the published SHA256 of that source wheel;
- `reason`: the recorded vendor provenance review.

Before adding a row, independently verify the wheel checksum and byte equality
with its resource, review the upstream fixture's purpose, and retain that
evidence. The scanner validates the review format, exact path and raw hash;
it does not fetch or independently attest the cited wheel. Never auto-approve
a file merely because its name is under a vendor directory.

Accepted resources still undergo all raw/printable credential and private-
pattern checks. No credential or privacy rule is exempted. Unknown/changed
bytes, a changed archive path, other media formats and WAVs in ordinary
publication artifacts remain blocked. Existing normalized fixture hashes
cannot substitute for raw binary provenance. This supports reviewed scientific
format-test fixtures; it does not transcribe or certify arbitrary audio.

Reviewed WAV inputs cannot use either privacy-line exceptions or normalized credential-fixture exceptions. Archive member names and outer scan-target names containing the reserved `!` boundary separator are rejected, so nested and direct member identities cannot collide. This deliberately fails closed for such unusual publication names.
