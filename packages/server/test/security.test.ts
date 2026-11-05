import { describe, expect, it } from "vitest";
import { buildProjectApp } from "./helpers.js";

function multipart(filename: string, data: Buffer, type: string) {
  const boundary = "----sourcebook";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe("security headers", () => {
  it("sends nosniff, same-origin framing and referrer policy on every response", async () => {
    const { server } = await buildProjectApp();
    for (const url of ["/api/projects", "/api/projects/test/notebook", "/api/does-not-exist"]) {
      const res = await server.inject({ method: "GET", url });
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
      expect(res.headers["referrer-policy"]).toBe("same-origin");
      expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    }
  });

  it("serves an uploaded SVG (which can hold scripts) sandboxed", async () => {
    const { app, server } = await buildProjectApp();
    const block = (await app.inject({ method: "POST", url: "/api/blocks", payload: { title: "Pics" } })).json();
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/users")</script><rect width="1" height="1"/></svg>`);
    const up = await app.inject({ method: "POST", url: `/api/assets?blockId=${block.id}`, ...multipart("x.svg", svg, "image/svg+xml") });
    expect(up.statusCode).toBe(201);
    const res = await server.inject({ method: "GET", url: up.json().url });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    expect(res.headers["content-security-policy"]).toMatch(/^sandbox;/);
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
