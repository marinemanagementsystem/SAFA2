# GIB Direct e-Arsiv Integration

This project does not use a private integrator. The live target is GIB's official
"Bilgi Islem Sisteminin Entegrasyonu" route for e-Arsiv.

## What is already in the app

- `INVOICE_PROVIDER=mock` keeps invoice issuing safe for local testing.
- `INVOICE_PROVIDER=gib-direct` selects the direct GIB provider scaffold.
- The direct provider checks required GIB configuration and fails closed until
  authorization and signing details are present.
- Invoice drafts remain idempotent: one `shipmentPackageId` can only have one
  invoice.

## What is required before live issuing

- GIB test access for e-Arsiv web services.
- GIB approval to use the non-portal integration method in production.
- Mali muhur or NES signing capability.
- Final UBL-TR/e-Arsiv XML mapping validated against GIB schemas.
- SOAP method mapping from the current GIB e-Arsiv technical guide.
- Operational certificate storage policy for the local machine.

## Why portal bot is not the default

The public e-Arsiv portal is a web UI. Automating hidden portal endpoints is brittle:
field names, tokens, session behavior, CAPTCHA, or signing flows can change without
API versioning. The application therefore treats direct GIB web service integration
as the production path and uses mock mode until that path is authorized.

Official references:

- https://ebelge.gib.gov.tr/
- https://ebelge.gib.gov.tr/dosyalar/kilavuzlar/e-Arsiv_Teknik_Kilavuzu_V.1.18.pdf
- https://ebelge.gib.gov.tr/dosyalar/kilavuzlar/e-ArsivBasvuruKilavuzu-v1.1.pdf
