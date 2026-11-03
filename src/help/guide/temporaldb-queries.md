---
type: Note
tags: [bdobb, help, integrations, temporaldb, queries, mcp, rita]
---

# TemporalDB Shared Queries

TemporalDB is the stack service Episode 11 adds: it keeps every provider response it captures and serves saved SQL queries over them, each pinned to what was known at a point in time. BDOBB reaches it as an ordinary backend connection. The connection must identify itself as service `TemporalDB`; the name you give it in **Connections** has no effect. On the openbq-docker stack its address is the Tailscale Service `https://openbq-temporal.<your-tailnet>.ts.net`, with the scope token as an `Authorization: Bearer` header; the web preview reaches it through the gateway's `/temporal` route instead.

## The query widget

A connected TemporalDB serves a `query_data` widget. Its card starts as *No shared query bound*; **Open query library** lists the backend's saved queries (search with *Search saved queries…*). **Select** binds one to the card. The card pins the revision you selected; **Follow latest revision** is an explicit opt in. **Save new query** and **Save new revision** write definitions back to the shared library, and **Save pivot with query** keeps a pivot layout with it. **Open as table widget** puts the result in an ordinary table card, so pivots, linked widgets, charts and exports all work on it. To browse what TemporalDB holds and build a query without writing JSON, use [[temporaldb-explorer|the TemporalDB Explorer]].

The card's context bar sets the temporal context: **Mode**, **Known at**, **Effective at** and the knowledge **Basis**. **Apply and run** starts a new execution. **Pin this execution** fixes the card to one execution, which then reads the retained result without running again. **Execution receipt** shows the query revision, pinned inputs, environment and result hash; **Copy execution ID** copies the identifier.

A failed or unavailable source stays an error; it never becomes an empty table. Logging out, a scope or credential change, or an unauthorized reply from TemporalDB clears the library and every result derived from it, linked cards and charts included.

## What is loaded

The card loads the first page of a result (the service's default is 1000 rows). Local sorting, pivots and exports use only loaded rows, and the provenance says when a result has more pages. Exact decimals and large integers stay as strings rather than becoming JavaScript numbers. Exports carry the receipt: JSON includes provenance, Excel adds a `TemporalDB` sheet, and CSV adds `__temporaldb_*_v1` columns.

## Rita

TemporalDB also runs an MCP server. Add `https://openbq-temporal-mcp.<your-tailnet>.ts.net/mcp` in [[ai-library|the AI Library]] like any other MCP server, with its MCP token, and Rita can list and describe datasets, check cache coverage, validate a query, read and save query revisions, run a saved revision on already-cached inputs (`query_cache`, at most 100 rows a page), read or cancel that execution. It never triggers a new provider fetch. A query Rita saves appears in the same library; a card already bound to an earlier revision keeps that revision until you choose otherwise.

## Saved dashboards

A dashboard stores the binding, its parameters and temporal context, not the result. Exported `apps.json` files carry an `extensions.bdobbV11` overlay naming the original backend, so an import never silently points a saved query at a different one.
