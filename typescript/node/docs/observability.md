# Observability

## Diagnostics surface (`diagnostics`)

`diagnostics(options, binding)` returns non-fatal configuration warnings —
never secrets, never request data.

| Code | Level | Condition |
| --- | --- | --- |
| `csrf-no-binding` | warning | CSRF enabled but no subject/session/preauth extractor configured. |
| `origin-empty-allowlist` | warning | Origin enabled with empty `allowedOrigins` (rejects all). |
| `rate-limit-default-limit` | info | Rate limit enabled with default window/limit. |

Call at startup and log the result:

```ts
import { diagnostics, resolveOptions, DefaultCsrfBindingResolver } from "@apipilot/node";

const options = resolveOptions(pluginOptions);
const binding = new DefaultCsrfBindingResolver(pluginOptions.csrfBinding);
for (const d of diagnostics(options, binding)) {
  console[d.level === "warning" ? "warn" : "info"](`${d.code}: ${d.message}`);
}
// keyRingDiagnostics(keyRing, csrfEnabled) checks multi-instance key safety.
```

## Logging

The middleware records warn-level diagnostics for security rejections
(origin, fetch-metadata, cookie, CSRF) — surface them through your own
logger or metrics pipeline.

## Correlation in logs

Every response carries `meta.requestId`; log it alongside request logs
to trace a request across services.

## Pipeline counters (`Metrics`)

`ApiPilotOptions.metrics` accepts a `Metrics` instance; when omitted the
shared `DEFAULT_METRICS` is used. Counters are in-memory and
per-process � export `snapshot()` to your metrics pipeline.

| Counter | Incremented when |
| --- | --- |
| `csrf.issued` | CSRF bootstrap endpoint issues a token |
| `csrf.validated` | CSRF token validates successfully |
| `csrf.rejected` | CSRF header missing, binding unresolvable, or token invalid |
| `csrf.expired` | CSRF token past `tokenLifetimeSeconds` |
| `rate_limited` | Rate limiter rejects a request |
| `validation_failed` | Pagination/validation stage rejects |
| `origin_rejected` | Origin policy rejects |
| `fetch_metadata_rejected` | Fetch Metadata policy rejects |
| `cookie_rejected` | Cookie policy rejects |

```ts
import { Metrics } from "@apipilot/node";

app.use(apiPilot({
  metrics: new Metrics(),
}));
// ... later:
const snap = metrics.snapshot(); // Record<string, number>
```

## Log redaction (`redactString`, `redactValue`)

`DEFAULT_REDACTION_POLICY` masks sensitive keys (password, token,
authorization, cookie, csrf, api_key, ...) and `Bearer` tokens. Use
before writing request data to logs:

```ts
import { redactString, redactValue } from "@apipilot/node";

const safe = redactString(raw);
const safeObj = redactValue(fields);
```
