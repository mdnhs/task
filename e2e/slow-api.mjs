// (e2e) A transparent proxy in front of the API for the skeleton measurements (e2e/skeletons.spec.ts): the web's server components reach the API through it, so a test can
// hold every API answer back (GET /__delay/<ms>) while the route's loading.tsx is on screen, measure it, and then let the real page arrive. Local only.
import http from "node:http"

const TARGET = { host: "127.0.0.1", port: Number(process.env.E2E_API_PORT ?? 3101) }
let delay = 0
let match = null
http
  .createServer((req, res) => {
    // GET /__delay/<ms>[/<url-encoded regex>]: hold back every answer (or only the paths the regex matches) by <ms>. 0 = off.
    const m = /^\/__delay\/(\d+)(?:\/(.+))?$/.exec(req.url ?? "")
    if (m) {
      delay = Number(m[1])
      match = m[2] ? new RegExp(decodeURIComponent(m[2])) : null
      res.end(String(delay))
      return
    }
    const wait = !match || match.test(req.url ?? "") ? delay : 0
    const chunks = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
      setTimeout(() => {
        const up = http.request({ ...TARGET, path: req.url, method: req.method, headers: { ...req.headers, host: `${TARGET.host}:${TARGET.port}` } }, (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers)
          r.pipe(res)
        })
        up.on("error", () => { res.statusCode = 502; res.end() })
        up.end(Buffer.concat(chunks))
      }, wait)
    })
  })
  .listen(Number(process.env.E2E_PROXY_PORT ?? 3102), "127.0.0.1")
