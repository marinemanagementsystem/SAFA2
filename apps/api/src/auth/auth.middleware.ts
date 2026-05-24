import type { NextFunction, Request, Response } from "express";
import { readAuthSessionFromRequest, type AuthSession } from "./auth-session";

export type AuthenticatedRequest = Request & {
  authSession?: AuthSession;
};

function requestPath(request: Request) {
  return request.path || request.originalUrl.split("?")[0] || "/";
}

function isProtectedApiRequest(request: Request) {
  const path = requestPath(request);
  return path === "/api" || path.startsWith("/api/") || path === "/earsiv-services" || path.startsWith("/earsiv-services/");
}

function isPublicApiRequest(request: Request) {
  const path = requestPath(request);
  return (
    path === "/api/auth/login" ||
    path === "/api/auth/logout" ||
    path === "/api/auth/session" ||
    /^\/api\/public\/invoices\/[^/]+\.pdf$/.test(path)
  );
}

function isAuthorizedSchedulerRequest(request: Request) {
  const path = requestPath(request);
  if (path !== "/api/jobs/scheduled/gib-followup/run-next") return false;

  const expected = process.env.SAFA_SCHEDULER_SECRET?.trim();
  if (!expected) return false;

  const value = request.headers["x-safa-scheduler-secret"];
  const received = Array.isArray(value) ? value[0] : value;
  return received === expected;
}

export function apiAuthMiddleware(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  if (request.method === "OPTIONS" || !isProtectedApiRequest(request) || isPublicApiRequest(request) || isAuthorizedSchedulerRequest(request)) {
    next();
    return;
  }

  const session = readAuthSessionFromRequest(request);
  if (!session) {
    response.status(401).json({
      statusCode: 401,
      message: "Oturum gerekli. Lutfen tekrar giris yapin.",
      error: "Unauthorized"
    });
    return;
  }

  request.authSession = session;
  next();
}
