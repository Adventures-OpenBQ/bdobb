// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";

const MINUTE = 60_000;

/**
 * Ticks on the minute boundary rather than on an interval.
 *
 * The clock shows HH:MM and has no second hand, so a per-second timer would
 * wake the app sixty times a minute to change nothing on screen fifty-nine of
 * them. Scheduling to the boundary also means the digits flip at the same
 * instant the real minute does, instead of up to an interval late.
 */
export function useMinuteTick(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      const ms = MINUTE - (Date.now() % MINUTE);
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, ms);
    };

    schedule();
    return () => clearTimeout(timer);
  }, []);

  return now;
}
