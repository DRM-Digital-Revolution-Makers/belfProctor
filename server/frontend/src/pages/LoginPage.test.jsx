import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./LoginPage";

describe("LoginPage", () => {
  it("validates empty credentials without making a request", async () => {
    globalThis.fetch = vi.fn();
    render(<LoginPage />);
    await userEvent.click(screen.getByRole("button", { name: "common.login" }));
    expect(await screen.findByText("common.email / common.password")).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stores the token and calls onSuccess after a valid login", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: "signed-admin-token" }),
    });
    const onSuccess = vi.fn();
    render(<LoginPage onSuccess={onSuccess} />);
    await userEvent.type(screen.getByPlaceholderText("user@example.com"), "admin@example.com");
    await userEvent.type(screen.getByPlaceholderText("••••••••"), "strong-password");
    fireEvent.submit(screen.getByRole("button", { name: "common.login" }).closest("form"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(localStorage.getItem("token")).toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({
      method: "POST", credentials: "same-origin",
    }));
  });

  it("shows the server error and does not persist a token", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: "Invalid credentials" }),
    });
    render(<LoginPage />);
    await userEvent.type(screen.getByPlaceholderText("user@example.com"), "admin@example.com");
    await userEvent.type(screen.getByPlaceholderText("••••••••"), "wrong-password");
    fireEvent.submit(screen.getByRole("button", { name: "common.login" }).closest("form"));
    expect(await screen.findByText("Invalid credentials")).toBeVisible();
    expect(localStorage.getItem("token")).toBeNull();
  });
});
