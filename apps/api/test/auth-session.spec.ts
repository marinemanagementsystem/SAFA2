import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { apiAuthMiddleware } from "../src/auth/auth.middleware";
import { createSessionCookie, readAuthSessionFromRequest, verifyAdminCredential } from "../src/auth/auth-session";

const originalEnv = { ...process.env };

function mockRequest(cookie?: string): Request {
  return {
    protocol: "https",
    headers: {
      "x-forwarded-proto": "https",
      ...(cookie ? { cookie } : {})
    }
  } as unknown as Request;
}

function mockApiRequest(path: string, cookie?: string): Request {
  return {
    method: "GET",
    path,
    originalUrl: path,
    protocol: "https",
    headers: {
      "x-forwarded-proto": "https",
      ...(cookie ? { cookie } : {})
    }
  } as unknown as Request;
}

function mockResponse() {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  };
  return response as unknown as Response & typeof response;
}

describe("auth session", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.K_SERVICE;
    process.env.NODE_ENV = "test";
    process.env.SAFA_ADMIN_USERNAME = "sarper";
    process.env.SAFA_ADMIN_PASSWORD = "secret-password";
    delete process.env.SAFA_ADMIN_PASSWORD_HASH;
    process.env.SAFA_SESSION_SECRET = "test-session-secret";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("verifies configured backend credentials", () => {
    expect(verifyAdminCredential("sarper", "secret-password")).toEqual({ ok: true, username: "sarper" });
    expect(verifyAdminCredential("sarper", "wrong")).toEqual({ ok: false, reason: "mismatch" });
  });

  it("creates and verifies signed http-only session cookies", () => {
    const issued = createSessionCookie(mockRequest(), "sarper");
    expect(issued?.cookie).toContain("HttpOnly");
    expect(issued?.cookie).toContain("Secure");
    expect(issued?.cookie).toContain("SameSite=Lax");

    const cookieHeader = issued?.cookie.split(";")[0];
    const session = readAuthSessionFromRequest(mockRequest(cookieHeader));
    expect(session?.username).toBe("sarper");
    expect(session?.source).toBe("api");
  });

  it("requires explicit credentials in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SAFA_ADMIN_PASSWORD;
    delete process.env.SAFA_ADMIN_PASSWORD_HASH;

    expect(verifyAdminCredential("sarper", "secret-password")).toEqual({
      ok: false,
      reason: "server_auth_not_configured"
    });
  });

  it("rejects protected API requests without a session", () => {
    const response = mockResponse();
    const next = vi.fn() as NextFunction;

    apiAuthMiddleware(mockApiRequest("/api/settings"), response, next);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Unauthorized" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("allows public auth session checks without a session", () => {
    const response = mockResponse();
    const next = vi.fn() as NextFunction;

    apiAuthMiddleware(mockApiRequest("/api/auth/session"), response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });
});
