import { Body, Controller, Get, Post, Req, Res, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { createClearSessionCookie, createSessionCookie, readAuthSessionFromRequest, verifyAdminCredential } from "./auth-session";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

@Controller("auth")
export class AuthController {
  @Post("login")
  login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const parsed = loginSchema.parse(body);
    const verification = verifyAdminCredential(parsed.username, parsed.password);

    if (!verification.ok) {
      if (verification.reason === "server_auth_not_configured") {
        throw new ServiceUnavailableException("Canli API girisi icin SAFA_ADMIN_PASSWORD veya SAFA_ADMIN_PASSWORD_HASH ayarlanmali.");
      }

      throw new UnauthorizedException("Kullanici adi veya sifre hatali.");
    }

    const sessionCookie = createSessionCookie(request, verification.username);
    if (!sessionCookie) {
      throw new ServiceUnavailableException("Canli API oturum anahtari ayarli degil.");
    }

    response.setHeader("Set-Cookie", sessionCookie.cookie);
    return { authenticated: true, ...sessionCookie.session };
  }

  @Post("logout")
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader("Set-Cookie", createClearSessionCookie(request));
    return { authenticated: false };
  }

  @Get("session")
  session(@Req() request: Request) {
    const session = readAuthSessionFromRequest(request);
    if (!session) return { authenticated: false };
    return { authenticated: true, ...session };
  }
}
