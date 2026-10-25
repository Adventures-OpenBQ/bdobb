// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

// resolveParamValue (imported by paramOptions) logs unsupported date tokens
// through the logger, which writes through plugin-fs.

import { __reset } from "../test/memfs";
import { __resetLoggerForTests } from "./logger";
import { optionsRequestParams } from "./paramOptions";

const AUG_23 = new Date(2026, 7, 23);

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
});

describe("optionsRequestParams", () => {
  it("returns an empty object when the param declares no optionsParams", () => {
    expect(optionsRequestParams(undefined, { chamber: "house" }, AUG_23)).toEqual({});
  });

  it("copies a string literal through unchanged", () => {
    expect(optionsRequestParams({ provider: "fmp" }, {}, AUG_23)).toEqual({ provider: "fmp" });
  });

  it("stringifies a number literal", () => {
    expect(optionsRequestParams({ limit: 100 }, {}, AUG_23)).toEqual({ limit: "100" });
  });

  it("stringifies a boolean literal", () => {
    expect(optionsRequestParams({ is_workspace: true }, {}, AUG_23)).toEqual({
      is_workspace: "true",
    });
  });

  it("resolves a $ref entry to the named param's current value", () => {
    expect(optionsRequestParams({ chamber: "$chamber" }, { chamber: "senate" }, AUG_23)).toEqual({
      chamber: "senate",
    });
  });

  it("omits a $ref entry whose referenced param is empty", () => {
    // Probed live on 2026-08-27: `fomc_documents_choices?year=` answers 422
    // int_parsing, so sending the entry empty costs a request and earns
    // nothing. Omission, not an empty value.
    expect(optionsRequestParams({ year: "$year" }, { year: "" }, AUG_23)).toEqual({});
  });

  it("omits a $ref entry whose referenced param is absent entirely", () => {
    expect(optionsRequestParams({ year: "$year" }, {}, AUG_23)).toEqual({});
  });

  it("omits only the unresolved entry, keeping the resolvable ones", () => {
    expect(
      optionsRequestParams(
        { chamber: "$chamber", year: "$year", limit: 10 },
        { chamber: "house" },
        AUG_23,
      ),
    ).toEqual({ chamber: "house", limit: "10" });
  });

  it("runs a resolved $ref through resolveParamValue, so a stored $currentDate becomes today", () => {
    expect(optionsRequestParams({ date: "$start" }, { start: "$currentDate" }, AUG_23)).toEqual({
      date: "2026-08-23",
    });
  });

  it("does not treat a referenced value's own leading $ as a second reference", () => {
    // One level of indirection only: the VALUE is a value, not another ref.
    expect(optionsRequestParams({ q: "$a" }, { a: "$b", b: "x" }, AUG_23)).toEqual({ q: "$b" });
  });

  it("defaults `today` to now, which is how useParamOptions calls it", () => {
    expect(optionsRequestParams({ provider: "fmp" }, {})).toEqual({ provider: "fmp" });
  });
});
