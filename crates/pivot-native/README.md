# pivot-native

Native session execution using the existing `pivot-core` request/response types.
No JavaScript process is used by the library. `NativeOrder` implements
`ValueOrder`; `NativeSession` owns the collators and core session and accepts
`CoreRequest` through `dispatch`. Use `pivot-wire` for the existing worker codec.

## Build requirements

- Rust 1.98.1, a native C compiler (`CC` override), archiver (`AR` override), and
  `pkg-config`.
- **ICU4C exactly 78.3**, development headers, `icu-i18n` and `icu-uc` pkg-config
  entries and shared libraries. Build metadata, C headers, and runtime version
  are checked; unsupported versions fail instead of claiming locale parity.
- Set `PKG_CONFIG_PATH` (and optionally `PKG_CONFIG_LIBDIR`) for a custom ICU
  prefix, including the pinned ICU install in the Linux service image. On macOS,
  standard Homebrew ICU prefixes are tried when `PKG_CONFIG_PATH` is unset.
  Runtime dynamic-library search paths must also resolve that same installation.
- Homebrew's ICU78.3 on the development host targets macOS 26. Build with
  `MACOSX_DEPLOYMENT_TARGET=26.0` for that installation; another ICU build can have
  its own deployment target. Linux builds are unaffected.

```
CARGO_NET_OFFLINE=true cargo +1.98.1 test --locked --manifest-path crates/pivot-native/Cargo.toml
```

The lockfile uses existing pinned dependencies; ICU is a system dependency,
not a Cargo crate. Cross compilation requires a matching target compiler,
archiver, pkg-config configuration and ICU libraries.

## Compatibility

The baseline is Node 26.10.0 / V8 14.6.202.34-node.35 / ICU78.3 / CLDR48.
Pivot text collation uses primary strength, numeric ordering, and no case level;
category recipe collation uses locale defaults independently. Missing, null and
empty string sort last in both directions. Numeric subtraction keeps NaN
unordered and stops multi-key comparison before later keys.

Mixed numeric/text comparisons can be nontransitive. Native permutations use a
port of the pinned V8 TimSort, including its run scheduling, gallop probes and
inconsistent-comparator exhaustion cases. Rust's total-order sort is not used
for these permutations. Updating the baseline V8 or ICU requires rerunning and
reviewing parity; this is not an engine-independent JavaScript sort guarantee.
See `THIRD_PARTY_NOTICES` for the port's licenses.

Locale must be explicit, a fully parsed BCP47 tag, and have an ICU-supported
collation language. Unknown languages do not fall back to the machine locale.
The supplied session locale is retained as its explicit identity for core
request/definition validation. Service callers must validate and consistently
use that identity; collation negotiation does not rewrite saved definitions.

Tests reuse the entire 41-fixture frozen core oracle with `NativeSession` and
native ordering. Identities, structures, diagnostics, Statement/fiscal cases,
selection/operation traces, delivery blocks, totals, facets, chart and transfer
outputs keep the reviewed assertions and numeric tolerances. Ordering tests
also compare complete mixed/nonfinite permutations with the pinned Node oracle
across insertion and merge boundaries. Node is a test dependency only.

The FFI shim owns one ICU collator per Rust RAII owner. All input buffers and
lengths are checked and borrowed only for synchronous ICU calls. Collator ownership may move to an execution worker (`Send`), but collators are
not shared concurrently (`Sync` is not implemented), and are closed exactly once.

Unicode locale extensions follow Intl.Collator negotiation: supported `co`,
`kf`, and `kn` values are retained, unsupported values use locale defaults, and
other ICU collation keywords are ignored. Pivot's explicit base/numeric options
still override the relevant locale options; recipes use default Intl options.
The live Node oracle checks Node, V8, and ICU versions once before comparisons.

The C locale safety regression exercises the actual shim under AddressSanitizer,
including the old 157-byte boundary and much longer valid tags. With the pinned
ICU pkg-config directory configured, run from this crate directory:

```
cc -g -O1 -Wall -Wextra -Werror -fsanitize=address -fno-omit-frame-pointer \
  tests/icu_locale_asan.c src/icu_shim.c \
  $(pkg-config --cflags --libs icu-i18n icu-uc) -o /tmp/pivot-native-icu-asan
/tmp/pivot-native-icu-asan
```
