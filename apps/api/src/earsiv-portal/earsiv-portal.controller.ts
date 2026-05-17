import { All, Controller, Inject, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { EarsivPortalService } from "./earsiv-portal.service";

@Controller("earsiv-portal")
export class EarsivPortalController {
  constructor(@Inject(EarsivPortalService) private readonly earsivPortal: EarsivPortalService) {}

  @Post("open-session")
  openSession() {
    return this.earsivPortal.openSession();
  }

  @Post("logout-session")
  logoutSession() {
    return this.earsivPortal.logoutSession();
  }

  @Post("proxy-session")
  createProxySession() {
    return this.earsivPortal.createProxySession();
  }

  @All("proxy/:sessionId")
  proxyRoot(@Param("sessionId") sessionId: string, @Req() request: Request, @Res() response: Response) {
    return this.earsivPortal.proxyPortalRequest(sessionId, request, response);
  }

  @All("proxy/:sessionId/{*proxyPath}")
  proxyPath(@Param("sessionId") sessionId: string, @Req() request: Request, @Res() response: Response) {
    return this.earsivPortal.proxyPortalRequest(sessionId, request, response);
  }
}
