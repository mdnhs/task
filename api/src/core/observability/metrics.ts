import { createServer, type Server } from "node:http"

/** Every series the API exposes (B7 Task 15). Names are fixed here so a typo or a high-cardinality label is a thrown error, not a silent new series. */
const DEFS = {
  http_requests_total: { type: "counter", help: "HTTP requests by method, route template and status class" },
  http_request_duration_seconds: { type: "histogram", help: "HTTP request duration by route template" },
  db_pool_waiting: { type: "gauge", help: "Clients waiting for a Postgres connection" },
  queue_jobs_total: { type: "counter", help: "Background jobs by name and result" },
  queue_job_duration_seconds: { type: "histogram", help: "Background job duration by name" },
  sweep_tenants_processed: { type: "gauge", help: "Tenants handled by the last run of a sweep job" },
  event_relay_lag_seconds: { type: "gauge", help: "Age of the oldest domain event not yet relayed" },
  rate_limited_total: { type: "counter", help: "Requests refused by a rate limit bucket" },
} as const
export type MetricName = keyof typeof DEFS
type Labels = Record<string, string>
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

export interface Metrics {
  counter(name: MetricName, labels?: Labels): { inc(n?: number): void }
  gauge(name: MetricName, labels?: Labels): { set(v: number): void }
  histogram(name: MetricName, labels?: Labels): { observe(sec: number): void }
  /** Prometheus text exposition (version 0.0.4). */
  render(): string
}

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")
const fmt = (labels: Labels, extra?: Labels) => {
  const all = { ...labels, ...extra }
  const k = Object.keys(all).sort()
  return k.length ? `{${k.map((n) => `${n}="${esc(all[n])}"`).join(",")}}` : ""
}

export function makeMetrics(): Metrics {
  type Series = { labels: Labels; value: number; buckets?: number[]; sum?: number }
  const store = new Map<string, Map<string, Series>>()
  const series = (name: MetricName, type: string, labels: Labels = {}): Series => {
    const def = DEFS[name] as { type: string } | undefined
    if (!def || def.type !== type) throw new Error(`unknown ${type} metric ${String(name)}`)
    for (const l of Object.keys(labels)) if (/tenant/i.test(l)) throw new Error(`metric ${name}: tenant ids are not labels (cardinality); they belong in logs`)
    const byKey = store.get(name) ?? store.set(name, new Map()).get(name)!
    const key = fmt(labels)
    return byKey.get(key) ?? byKey.set(key, { labels, value: 0, ...(type === "histogram" ? { buckets: BUCKETS.map(() => 0), sum: 0 } : {}) }).get(key)!
  }
  return {
    counter: (name, labels) => ({ inc: (n = 1) => void (series(name, "counter", labels).value += n) }),
    gauge: (name, labels) => ({ set: (v) => void (series(name, "gauge", labels).value = v) }),
    histogram: (name, labels) => ({
      observe: (sec) => {
        const s = series(name, "histogram", labels)
        s.value += 1
        s.sum! += sec
        BUCKETS.forEach((b, i) => sec <= b && s.buckets![i]++)
      },
    }),
    render: () =>
      Object.entries(DEFS).flatMap(([name, def]) => [
        `# HELP ${name} ${def.help}`,
        `# TYPE ${name} ${def.type}`,
        ...[...(store.get(name as MetricName)?.values() ?? [])].flatMap((s) =>
          def.type === "histogram"
            ? [...BUCKETS.map((b, i) => `${name}_bucket${fmt(s.labels, { le: String(b) })} ${s.buckets![i]}`), `${name}_bucket${fmt(s.labels, { le: "+Inf" })} ${s.value}`, `${name}_sum${fmt(s.labels)} ${s.sum}`, `${name}_count${fmt(s.labels)} ${s.value}`]
            : [`${name}${fmt(s.labels)} ${s.value}`],
        ),
      ]).join("\n") + "\n",
  }
}

/**
 * The internal metrics listener (ruling S10): its own port, `GET /metrics` only, never mounted on the public app and never behind the
 * public proxy. The caller decides whether to start it (METRICS_PORT unset = off) and which interface (METRICS_HOST, default loopback).
 * `collect` refreshes pull-style gauges (the pool) just before a scrape. Returns the server; the caller closes it.
 */
export function startMetricsServer(o: { metrics: Metrics; port: number; host?: string; collect?: () => void }): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method === "GET" && (req.url ?? "").split("?")[0] === "/metrics") {
      try {
        o.collect?.()
      } catch {
        // a gauge that cannot be read is simply stale
      }
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" }).end(o.metrics.render())
      return
    }
    res.writeHead(404, { "content-type": "text/plain" }).end("not found\n")
  })
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(o.port, o.host ?? "127.0.0.1", () => resolve(server))
  })
}
