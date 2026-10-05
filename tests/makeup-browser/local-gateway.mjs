/** Loopback-only synthetic Auth transport + real PostgREST proxy. Not an application route. */
import { createServer } from "node:http";
import { claims, credentials, session, user } from "./local-auth.mjs";
const send = (res, status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:3045");
  res.setHeader("Access-Control-Allow-Headers", "authorization,apikey,content-type,x-client-info,prefer");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  try {
    if (req.url.startsWith("/auth/v1/.well-known/jwks.json")) return send(res, 200, { keys: [] });
    if (req.url.startsWith("/auth/v1/user")) {
      const data = claims(req.headers.authorization?.replace(/^Bearer /i, ""));
      const n = Number(data.sub.slice(-12));
      if (!Object.values(credentials).includes(n)) throw new Error("unknown local actor");
      return send(res, 200, user(n));
    }
    if (req.url.startsWith("/auth/v1/token")) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      const n = credentials[body.email] ?? Number(String(body.refresh_token).replace(/^local:/, ""));
      if (!Object.values(credentials).includes(n) || (body.email && body.password !== "local-test-only")) return send(res, 401, { msg: "invalid local credential" });
      return send(res, 200, session(n));
    }
    if (req.url.startsWith("/rest/v1/")) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const headers = { ...req.headers }; delete headers.host; delete headers["content-length"];
      const response = await fetch(`http://127.0.0.1:55446${req.url.slice("/rest/v1".length)}`, {
        method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      res.writeHead(response.status, Object.fromEntries([...response.headers].filter(([key]) => !["content-encoding", "transfer-encoding", "connection"].includes(key))));
      res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    return send(res, 404, { error: "unsupported local fixture endpoint" });
  } catch (error) { send(res, 401, { error: error.message }); }
}).listen(55445, "127.0.0.1", () => console.log("Synthetic gateway ready at 127.0.0.1:55445"));
