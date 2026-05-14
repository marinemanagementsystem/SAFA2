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
  return path === "/api" || path.startsWith("/api/");
}

function isPublicApiRequest(request: Request) {
  const path = requestPath(request);
  return path === "/api/auth/login" || path === "/api/auth/logout" || path === "/api/auth/session";
}

export function apiAuthMiddleware(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  if (request.method === "OPTIONS" || !isProtectedApiRequest(request) || isPublicApiRequest(request)) {
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
