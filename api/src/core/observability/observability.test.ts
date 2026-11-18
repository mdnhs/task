import { describe, expect, test } from "vitest"
import { makeLogErrorReporter, noopErrorReporter, safeCapture, fakeErrorReporter } from "./error-reporter"
import { makeLogger } from "./logger"
import { makeMetrics, startMetricsServer } from "./metrics"
import { logJobFailure, instrumentJob } from "../queue/bull-queue"

const cap = () => {
  const lines: string[] = []
  return { lines, logger: makeLogger({ level: "debug", destination: { write: (s: string) => void lines.push(s) } }) }
}
const drizzleLike = () => Object.assign(new Error("Failed query: insert into \"user\" (email) values ($1)\nparams: leak@example.com"), { cause: { code: "23505", detail: "leak@example.com" } })

describe("metrics", () => {
  test("render has the listed series and no tenant id label", () => {
    const m = makeMetrics()
    m.counter("http_requests_total", { method: "GET", route: "/v1/tasks", status_class: "2xx" }).inc()
    m.histogram("http_request_duration_seconds", { route: "/v1/tasks" }).observe(0.03)
    m.gauge("db_pool_waiting").set(2)
    m.counter("queue_jobs_total", { name: "events.relay", result: "ok" }).inc(3)
    m.histogram("queue_job_duration_seconds", { name: "events.relay" }).observe(1.2)
    m.gauge("sweep_tenants_processed", { job: "tasks.recurrence" }).set(7)
    m.gauge("event_relay_lag_seconds").set(4)
    m.counter("rate_limited_total", { bucket: "auth" }).inc()
    const out = m.render()
    for (const name of ["http_requests_total", "http_request_duration_seconds", "db_pool_waiting", "queue_jobs_total", "queue_job_duration_seconds", "sweep_tenants_processed", "event_relay_lag_seconds", "rate_limited_total"]) {
      expect(out, name).toContain(`# TYPE ${name} `)
    }
    expect(out).toContain('http_requests_total{method="GET",route="/v1/tasks",status_class="2xx"} 1')
    expect(out).toContain('http_request_duration_seconds_bucket{le="0.05",route="/v1/tasks"} 1')
    expect(out).toContain('http_request_duration_seconds_bucket{le="+Inf",route="/v1/tasks"} 1')
    expect(out).toContain('http_request_duration_seconds_sum{route="/v1/tasks"} 0.03')
    expect(out).toContain("db_pool_waiting 2")
    expect(out).toContain('queue_jobs_total{name="events.relay",result="ok"} 3')
    expect(out.toLowerCase()).not.toContain("tenant_id")
    expect(out).not.toMatch(/tenantid/i)
  })

  test("a tenant id label, an unknown series and a wrong type are refused (cardinality guard)", () => {
    const m = makeMetrics()
    expect(() => m.counter("http_requests_total", { tenantId: "t1" })).not.toThrow() // creating the handle is lazy...
    expect(() => m.counter("http_requests_total", { tenant_id: "t1" }).inc()).toThrow(/tenant/)
    expect(() => m.counter("http_requests_total", { tenantId: "t1" }).inc()).toThrow(/tenant/)
    expect(() => m.counter("nope" as never).inc()).toThrow(/unknown/)
    expect(() => m.gauge("http_requests_total").set(1)).toThrow(/unknown/)
  })

  test("label values are escaped", () => {
    const m = makeMetrics()
    m.counter("rate_limited_total", { bucket: 'a"b\\c\nd' }).inc()
    expect(m.render()).toContain('rate_limited_total{bucket="a\\"b\\\\c\\nd"} 1')
  })

  test("the metrics listener serves /metrics only, on its own port, bound to the interface it was given", async () => {
    const m = makeMetrics()
    m.counter("rate_limited_total", { bucket: "auth" }).inc()
    let collected = 0
    const server = await startMetricsServer({ metrics: m, port: 0, host: "127.0.0.1", collect: () => void collected++ })
    try {
      const addr = server.address() as { address: string; port: number }
      expect(addr.address).toBe("127.0.0.1")
      const ok = await fetch(`http://127.0.0.1:${addr.port}/metrics`)
      expect(ok.status).toBe(200)
      expect(ok.headers.get("content-type")).toContain("text/plain")
      expect(await ok.text()).toContain('rate_limited_total{bucket="auth"} 1')
      expect(collected).toBe(1)
      for (const [method, path] of [["GET", "/"], ["GET", "/healthz"], ["GET", "/v1/me"], ["POST", "/metrics"]]) expect((await fetch(`http://127.0.0.1:${addr.port}${path}`, { method })).status, `${method} ${path}`).toBe(404)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })
})

describe("error reporter", () => {
  test("the default reporter logs the class name, the pg code and the ids, never the message or the cause detail", () => {
    const { lines, logger } = cap()
    makeLogErrorReporter(logger).capture(drizzleLike(), { requestId: "r-1", tenantId: "t-1", route: "/v1/tasks/{id}" })
    const out = lines.join("")
    expect(JSON.parse(out)).toMatchObject({ level: 50, name: "Error", code: "23505", requestId: "r-1", tenantId: "t-1", route: "/v1/tasks/{id}", msg: "unhandled error" })
    expect(out).not.toMatch(/Failed query|leak@|params/)
  })
  test("the no-op default and a throwing reporter are safe", () => {
    expect(() => noopErrorReporter.capture(new Error("x"), {})).not.toThrow()
    expect(() => safeCapture({ capture: () => { throw new Error("down") } }, new Error("x"), {})).not.toThrow()
  })
  test("the fake records what was captured", () => {
    const f = fakeErrorReporter()
    const e = new Error("x")
    f.capture(e, { requestId: "r" })
    expect(f.captured).toEqual([{ err: e, ctx: { requestId: "r" } }])
  })
})

describe("worker", () => {
  test("worker job failure logs name, jobId and requestId (when present), never the payload", () => {
    const { lines, logger } = cap()
    logJobFailure(logger, { name: "notification.send", id: "job-42", data: { requestId: "0b9d6f3e-5c1a-4f6e-9a57-2f1d3c8e7a10", to: "leak@example.com", password: "PAYLOADSECRET", body: "x" } }, drizzleLike())
    logJobFailure(logger, { name: "events.relay", id: "job-43", data: { requestId: "bad id with spaces" } }, new Error("x"))
    const [a, b] = lines.map((l) => JSON.parse(l))
    expect(a).toMatchObject({ job: "notification.send", jobId: "job-42", requestId: "0b9d6f3e-5c1a-4f6e-9a57-2f1d3c8e7a10", name: "Error", code: "23505" })
    expect(b.requestId).toBeUndefined() // a requestId that is not id-shaped is not logged
    expect(lines.join("")).not.toMatch(/leak@|PAYLOADSECRET|Failed query/)
  })

  test("a job run counts queue_jobs_total and the duration, reports a failure with the job name, and rethrows", async () => {
    const metrics = makeMetrics()
    const reporter = fakeErrorReporter()
    let now = 0
    const clock = { now: () => new Date(now) }
    const ok = await instrumentJob({ metrics, errorReporter: reporter, clock }, { name: "events.relay", id: "j1", data: {} }, async () => { now += 1500 })
    expect(ok).toBeUndefined()
    await expect(instrumentJob({ metrics, errorReporter: reporter, clock }, { name: "tasks.recurrence", id: "j2", data: { requestId: "0b9d6f3e-5c1a-4f6e-9a57-2f1d3c8e7a10" } }, async () => { throw new Error("bad") })).rejects.toThrow("bad")
    const out = metrics.render()
    expect(out).toContain('queue_jobs_total{name="events.relay",result="ok"} 1')
    expect(out).toContain('queue_jobs_total{name="tasks.recurrence",result="failed"} 1')
    expect(out).toContain('queue_job_duration_seconds_sum{name="events.relay"} 1.5')
    expect(reporter.captured).toHaveLength(1)
    expect(reporter.captured[0].ctx).toEqual({ jobName: "tasks.recurrence", jobId: "j2", requestId: "0b9d6f3e-5c1a-4f6e-9a57-2f1d3c8e7a10" })
  })
})
