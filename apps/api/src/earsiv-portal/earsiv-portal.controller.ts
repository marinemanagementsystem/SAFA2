import { Controller, Inject, Post } from "@nestjs/common";
import { EarsivPortalService } from "./earsiv-portal.service";

@Controller("earsiv-portal")
export class EarsivPortalController {
  constructor(@Inject(EarsivPortalService) private readonly earsivPortal: EarsivPortalService) {}

  @Post("open-session")
  openSession() {
    return this.earsivPortal.openSession();
  }
}
