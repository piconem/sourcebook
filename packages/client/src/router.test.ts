import { describe, expect, it } from "vitest";
import { parseRoute, routeHref } from "./router";

describe("router", () => {
  it.each([
    ["", { page: "home", kind: "projects" }],
    ["#/", { page: "home", kind: "projects" }],
    ["#/templates", { page: "home", kind: "templates" }],
    ["#/projects/payment-service", { page: "editor", kind: "projects", id: "payment-service" }],
    ["#/templates/design-doc", { page: "editor", kind: "templates", id: "design-doc" }],
    ["#/projects/p/s/sec1", { page: "editor", kind: "projects", id: "p", target: { sectionId: "sec1" } }],
    ["#/projects/p/s/sec1/b/sub2", { page: "editor", kind: "projects", id: "p", target: { sectionId: "sec1", subBlockId: "sub2" } }],
    ["#/projects/p/s/sec1/b/sub2/c/c-3", { page: "editor", kind: "projects", id: "p", target: { sectionId: "sec1", subBlockId: "sub2", commentId: "c-3" } }],
  ])("%s", (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
    expect(parseRoute(routeHref(route as never))).toEqual(route);
  });

  it("ignores a comment without a sub-block and unknown segments", () => {
    expect(parseRoute("#/projects/p/c/x")).toEqual({ page: "editor", kind: "projects", id: "p" });
    expect(parseRoute("#/projects/p/s/a/c/x")).toEqual({ page: "editor", kind: "projects", id: "p", target: { sectionId: "a" } });
  });
});
