// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { Weekday } from "../calendar";
import data from "./vendor/calendar-catalogue.json";

/**
 * One exchange_calendars calendar as openbq-docker's generated catalogue describes it (spec "One catalogue, generated
 * by the provider", 2026-10-24). Vendored with the contract and pinned by the pairing; never fetched at runtime. Times
 * are local `HH:MM:SS`; `bounds` are the first and last dates served; suffixes are upper case, without the dot.
 */
export type CatalogueEntry = {
  calendarId: string;
  mic: string;
  name: string;
  timezone: string;
  open: string;
  close: string;
  break: { start: string; end: string } | null;
  overnight: boolean;
  bounds: { start: string; end: string };
  aliases: string[];
  suffixes: { eodhd: string[]; yahoo: string[] };
  workingDays: Weekday[];
};

/** Every calendar the provider serves, in the catalogue's (the library's) order. */
export const CATALOGUE: readonly CatalogueEntry[] = data.calendars as unknown as CatalogueEntry[];

/** Suffixes deliberately mapped to no calendar, each with why: a symbol carrying one infers nothing. */
export const UNMAPPED_SUFFIXES: Readonly<Record<string, string>> = data.unmappedSuffixes;

const byMic = new Map(CATALOGUE.map((e) => [e.mic, e]));
const byUpper = new Map(CATALOGUE.map((e) => [e.mic.toUpperCase(), e.mic]));

/** A calendar's entry by its exact name (`XPAR`, `us_futures`), or undefined. */
export function calendarEntry(mic: string): CatalogueEntry | undefined {
  return byMic.get(mic);
}

/**
 * The catalogue's own spelling of a calendar name typed in any case, trimmed (ruling P14), or undefined. An alias
 * (`NYSE`, `XNAS`) is not a calendar here: the catalogue lists aliases for reference only (ruling RF3).
 */
export function canonicalCalendar(name: string): string | undefined {
  return byUpper.get(name.trim().toUpperCase());
}

/**
 * How a calendar name is stored and shown, from every source (a dashboard, a widget, a param, an expression's `(…)`):
 * a catalogue calendar in its own spelling, any other name trimmed and upper-cased, so "Unknown calendar US" reads
 * the same wherever `us` was typed.
 */
export function calendarSpelling(name: string): string {
  return canonicalCalendar(name) ?? name.trim().toUpperCase();
}

/** One of the five calendars whose sessions cross local midnight: they resolve only from provider bundles. */
export function isOvernight(mic: string): boolean {
  return byMic.get(mic)?.overnight === true;
}
