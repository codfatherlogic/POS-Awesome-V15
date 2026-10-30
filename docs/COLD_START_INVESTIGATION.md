# POS cold-start investigation

## Conclusion

The affected profile's catalog request was blocked by browser-local startup work,
not by the catalog endpoint. The persistence worker was created as soon as the
offline module was imported and opened `posawesome_offline` concurrently with the
main Dexie connection. On an old database, the worker owned historical v7-v9
upgrade callbacks, including a full `items.toCollection().modify(...)` scan. At
the same time, POS profile and item initialization awaited full memory hydration,
including the largest cache values. A worker batch timed out after exactly 10,000
ms, replayed on the main thread, and added more contention. The online catalog
request therefore had no opportunity to start.

A clean Incognito database is created directly at the current schema, has no
large legacy values to hydrate, and normally has extensions disabled. It avoids
all three profile-specific inputs. The ABDM downloader is confirmed to inject an
`abdm-extension` subtree into the normal-profile document, so it is a possible
amplifier, but there is no evidence that it owns the blocking dependency.

## Evidence and baseline timeline

| Phase | Affected normal profile | Evidence |
| --- | ---: | --- |
| First shell | approximately 180-300 s | Reported reproducibly on the affected profile |
| Service Worker registration | completed | Browser console |
| Persistence worker batch 1 | timed out at 10,000 ms | Constant and timeout path in `offline/db.ts`; matching browser error |
| Startup catalog progress grace | 20,000 ms | `PRODUCT_CATALOG_BOOTSTRAP_GRACE_MS`; the grace release is not catalog success |
| Server health | approximately 1.3 s | Captured affected-profile request |
| Database health | approximately 0.6 s | Captured affected-profile request |
| Catalog request dispatch | absent while stuck | Affected-profile network sequence |
| Product list | empty | Store/UI state while initialization was blocked |

The historical slow-query count is not evidence that this incident is SQL-bound:
both health endpoints responded and `get_items` was not dispatched during the
stuck interval.

The fix adds structured events for page-to-shell time, Service Worker
registration, main and worker IndexedDB open, critical and full hydration,
persistence worker creation and every batch, fallback, POS Profile/settings,
cashier loading, item worker creation, catalog API, transformation, IndexedDB
writes, and final store/UI hydration. Enable it with:

```text
/app/posapp/pos?posa_startup_trace=1
```

Then export the bounded event buffer from DevTools:

```js
copy(window.__POS_STARTUP_TRACE__.export())
```

Each event has a session id, sequence, phase, status, milliseconds since module
startup, optional duration, and structured details. Persistence batch events
include batch id, logical keys, physical tables, record count, duration, and the
10,000 ms timeout. This makes cold/warm comparisons directly diffable.

## Permanent fix

- Open and hydrate the main Dexie connection before creating the persistence
  worker. The worker now declares schema history without running historical
  data-scanning migrations.
- Hydrate only queues, opening state, and small boot-critical settings on the
  startup path. Full/large cache hydration remains an idle background contract.
- Allow at most 250 ms for a cold cached-catalog read before dispatching the
  online catalog request. A late cache result cannot overwrite a newer server
  response.
- Keep invoice/write-queue readiness on the critical subset instead of the full
  cache hydration promise.
- Preserve and replay all worker batches, in order, through grouped main-thread
  transactions after worker rejection or the 10 s timeout.
- Queue startup persistence batches behind the worker database-ready promise.
  The 10 s batch execution clock starts only after `persistence_worker_ready`;
  worker database opening has a separate 30 s watchdog.
- Do not mark a timed-out product source 100% complete. Remove it from the
  progress denominator, keep catalog readiness false, continue loading, and show
  a recoverable warning.
- Treat the period before the first health probe resolves as "Checking", rather
  than "Server Offline".
- Reconcile the browser and current Frappe realtime socket state when the network
  lifecycle starts, then force a no-cache HTTP health check. A 9-second watchdog
  and identity-guarded `finally` prevent a hung check or realtime `connecting`
  event from leaving the UI permanently in "Checking" or blocking later probes.
- Own catalog initialization deduplication inside the items store. All UI callers
  now share one in-flight promise keyed by the POS Profile catalog identity;
  transient customer and selector context updates do not queue another IndexedDB
  pass.
- Append the current build version to the unhashed `itemWorker.js` URL in both
  worker creation paths, while preserving the optional startup-trace parameter.
  This prevents the first request after a deployment from reusing an older worker.
- Release the startup overlay at shell/catalog usability. Boot-critical offline
  resource refresh continues under its own `offline.initial_resource_sync` trace
  and cannot hold an already usable catalog behind the progress surface.
- Negotiate schema versions independently from each resource's persisted server
  state. When an endpoint requests a full rebuild, clear its watermark and finish
  the clean retry immediately so successful resource health is promoted to
  `fresh` without waiting for a later timer tick.
- Trace every Item Price page with offset, reported next offset, row counts,
  `has_more`, and schema. A non-empty page can safely recover a missing/stale
  offset from its returned row count; an empty non-advancing page fails with the
  exact diagnostics instead of an opaque pagination error.
- Never delete a corrupt POS database automatically. Provide record-count/storage
  diagnostics and an export of invoice outbox, unified write queue, legacy queues,
  and invoice-intent journals.

With a deliberately never-settling IndexedDB catalog read, the unit-level after
measurement proves catalog API dispatch at the 250 ms grace boundary. The old
path had no bound and, in the affected browser, delayed dispatch for 180-300 s.
A production after measurement requires deploying this build; no production code
or browser data was changed during diagnosis.

## Catalog endpoint and database check

The initial request is
`posawesome.posawesome.api.items.get_items`, with POS Profile, profile warehouse,
customer/effective selling price list, allowed item groups, image flag, and an
initial limit of 50. The backend normalizes the profile, expands groups, and calls
`frappe.get_all("Item", ...)` in `_run_item_query`, followed by detail/stock/price
enrichment. The handler already emits a `get_items` performance event with
profile, row count, cache path, search flag, and group count.

An execution plan was not captured because the request did not start and this
workspace has no production database session. After deployment, capture the
actual SQL and run `EXPLAIN` with the affected POS Profile's exact filters. Record
the emitted `get_items` timing beside the browser `items.catalog_api` event. Do
not infer a plan from a different profile or a synthetic query.

Server and database usage gadgets each issue one request when mounted and poll
every 10 seconds. This is avoidable startup noise, but their observed 1.3 s and
0.6 s responses cannot explain an absent catalog request or a profile-only delay.

## Reproduction and test matrix

For every row, use the same user, POS Profile, network, build, and a fresh tab.
Capture the startup trace, Network HAR, console, IndexedDB diagnostics, shell
time, catalog-request start, first 50 rows, and final visible catalog time. Run
each row at least three times and report median and worst case.

| Data/profile | Extensions | Run | Expected diagnostic value |
| --- | --- | --- | --- |
| Existing affected profile | all enabled | cold and warm | Reproduce user impact and retain ABDM evidence |
| Existing affected profile | ABDM disabled only | cold and warm | Isolate ABDM contribution |
| Existing affected profile | all extensions disabled | cold and warm | Isolate extension aggregate |
| Exported clone of old/large DB | disabled | cold and warm | Reproduce schema/size effect safely |
| Clean temporary profile | disabled | cold and warm | Clean-schema control equivalent to Incognito |
| Synthetic large item/cache DB | disabled | cold and warm | Verify 250 ms online dispatch bound |
| Synthetic corrupt/open-blocked DB | disabled | cold and warm | Verify degraded mode without deletion |
| Hung/rejecting worker | disabled | cold and warm | Verify 10 s timeout and ordered durable replay |
| Service Worker/cache build N-1 | disabled | cold and warm | Verify version validation and network-first assets |

The Service Worker is network-first while online, validates candidate caches with
a completion marker, and keeps a rollback cache. Registration succeeds in the
incident, so stale Cache Storage is not the primary cause; the N-1 matrix row is
still required before release.

## Safe recovery for an affected user

1. Do not clear site data. Deploy the fixed build and load once with startup
   tracing enabled.
2. In DevTools run
   `await window.__POS_OFFLINE_DIAGNOSTICS__.inspect()` and save the table counts,
   database version, usage, and quota.
3. Export recoverable transactional data before any destructive action:
   `copy(JSON.stringify(await window.__POS_OFFLINE_DIAGNOSTICS__.exportRecoveryData(), null, 2))`.
   Store the result securely and verify the outbox/write-queue counts.
4. Test the same profile with ABDM disabled. This changes no POS data and provides
   the cleanest immediate workaround if the extension materially increases time.
5. Only after an operator verifies that drafts, offline invoices, payments, and
   queues are synced or exported may a disposable clone be cleared to prove a
   corruption hypothesis. Production deletion remains an explicit, separately
   approved recovery action.

## Verification coverage

Tests cover worker batching and value coalescing, exact timeout and durable
fallback, in-flight replay ordering, no historical full-table worker migrations,
grouped hydration and old-key fallback, blocked/large catalog reads, startup
independence from unrelated hydration, non-destructive corrupt/open failure,
progress release without false success, and queue readiness on the critical
subset. Existing Service Worker cache/version tests remain in place.
