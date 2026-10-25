// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components";

type Props = {
  /** Where the popover lands: Relative when the stored value is an expression (spec §4). */
  initial: "absolute" | "relative";
  absolute: ReactNode;
  relative: ReactNode;
};

/**
 * The Absolute | Relative shell every period popover shares (spec §4). Its
 * own tab state, reset on every open — the popover's Dialog unmounts on
 * close, so `initial` is re-read from the stored value each time — and
 * nothing else: what each panel commits is the picker's business.
 */
export function PeriodTabs({ initial, absolute, relative }: Props) {
  return (
    <Tabs defaultSelectedKey={initial}>
      <TabList aria-label="Absolute or relative">
        <Tab id="absolute">Absolute</Tab>
        <Tab id="relative">Relative</Tab>
      </TabList>
      <TabPanel id="absolute">{absolute}</TabPanel>
      <TabPanel id="relative">{relative}</TabPanel>
    </Tabs>
  );
}
