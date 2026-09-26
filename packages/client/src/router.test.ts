import { describe, expect, it } from "vitest";
import { parseRoute, routeHref } from "./router";

describe("router", () => {
  it.each([
    ["", { page: "home", kind: "projects" }],
    ["#/", { page: "home", kind: "projects" }],
    ["#/templates", { page: "home", kind: "templates" }],
    ["#/projects/payment-service", { page: "editor", kind: "projects", id: "payment-service" }],
    ["#/templates/design-doc", { page: "editor", kind: "templates", id: "design-doc" }],
  ])("%s", (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
    expect(parseRoute(routeHref(route as never))).toEqual(route);
  });
});
