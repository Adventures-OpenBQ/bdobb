// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { act,renderHook,waitFor } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
import {fetchDayLogo} from "../lib/dayLogo";
import {useDayLogos} from "./useDayLogos";
import type {BackendConfig} from "../lib/types";
vi.mock("../lib/dayLogo",()=>({fetchDayLogo:vi.fn()}));
afterEach(()=>vi.unstubAllGlobals());
it("shares duplicate nearby logos, revokes removed blobs, ignores late replies, and never follows metadata URLs",async()=>{
  const create=vi.fn(()=>"blob:logo"),revoke=vi.fn();
  vi.stubGlobal("URL",class extends URL {static createObjectURL=create;static revokeObjectURL=revoke;});
  vi.mocked(fetchDayLogo).mockResolvedValue(new Blob(["logo"]));
  const backend={id:"b",baseUrl:"https://h/backend"} as BackendConfig;
  const {result,rerender,unmount}=renderHook(({symbols})=>useDayLogos(backend,symbols),{initialProps:{symbols:["AAPL","AAPL"]}});
  await waitFor(()=>expect(result.current.AAPL).toBe("blob:logo"));
  expect(fetchDayLogo).toHaveBeenCalledTimes(1);
  let finish!:(b:Blob)=>void;
  vi.mocked(fetchDayLogo).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  rerender({symbols:["MSFT"]});
  expect(revoke).toHaveBeenCalledWith("blob:logo");
  rerender({symbols:[]});
  await act(async()=>finish(new Blob(["late"])));
  expect(result.current).toEqual({});
  expect(create).toHaveBeenCalledTimes(1);
  unmount();
});
