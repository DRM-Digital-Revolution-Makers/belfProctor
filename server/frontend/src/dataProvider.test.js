import { beforeEach, describe, expect, it, vi } from "vitest";
import { authFetch, customDataProvider } from "./dataProvider";

describe("authenticated data provider", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it("uses same-origin credentials and preserves request headers", async () => {
    fetch.mockResolvedValue({ status: 200 });
    await authFetch("/api/clients", { headers: { "X-Test": "yes" } });
    expect(fetch).toHaveBeenCalledWith("/api/clients", {
      credentials: "same-origin",
      headers: { "X-Test": "yes" },
    });
  });

  it("clears authentication and emits an event after a 401", async () => {
    fetch.mockResolvedValue({ status: 401 });
    const listener = vi.fn();
    window.addEventListener("auth:changed", listener, { once: true });
    await authFetch("/api/clients");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("normalizes list responses for Refine", async () => {
    fetch.mockResolvedValue({ status: 200, json: async () => ({ data: [{ id: "C1" }], total: 1 }) });
    const result = await customDataProvider("/api").getList({
      resource: "clients",
      pagination: { current: 2, pageSize: 10 },
    });
    expect(fetch).toHaveBeenCalledWith("/api/clients?page=2&pageSize=10", {
      credentials: "same-origin", headers: {},
    });
    expect(result).toEqual({ data: [{ id: "C1" }], total: 1 });
  });
});
