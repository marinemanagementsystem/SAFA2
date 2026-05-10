# GIB Direct e-Arsiv Integration

This project does not use a private integrator. The live target is GIB's official
"Bilgi Islem Sisteminin Entegrasyonu" route for e-Arsiv.

## What is already in the app

- `INVOICE_PROVIDER=gib-direct` selects the direct GIB provider.
- The direct provider checks required GIB configuration and fails closed until
  authorization and signing details are present.
- Invoice drafts remain idempotent: one `shipmentPackageId` can only have one
  invoice.
- The app only stores records returned by live integrations or explicitly imported real business exports.
- GIB direct settings can be entered from the Integrations screen or environment.

## Live issue pipeline

The provider now has a real, live-only pipeline:

1. Reserve the next local invoice number from `invoicePrefix + year + sequence`.
2. Build UBL-TR/e-Arsiv XML from the approved Trendyol draft.
3. Call a local external document signing command. The command must write a
   signed UBL XML containing a `Signature` element.
4. Render the configured SOAP body/envelope template.
5. Call a local external SOAP/WSS signing command. The command must write a
   SOAP envelope containing `Security`, `Timestamp`, and `Signature` elements.
6. Submit the WSS-signed SOAP envelope to the configured GIB service URL.
7. Store `unsigned.xml`, `signed.xml`, `soap-request-unsigned.xml`,
   `soap-request-signed.xml`, `gib-response.xml`, and `manifest.json` under
   `STORAGE_DIR/gib-direct/<invoiceNumber>/`.

This is intentionally adapter-style because production signing is usually done
with a mali muhur/NES/HSM or a KamuSM/vendor signing bridge. SAFA does not fake
that signature.

Required fields can be entered from the Integrations screen or environment:

- `GIB_EARSIV_TAX_ID`
- `GIB_EARSIV_SERVICE_URL`
- `GIB_EARSIV_SIGNER_COMMAND`
- `GIB_EARSIV_SOAP_SIGNER_COMMAND`
- `GIB_EARSIV_SOAP_BODY_TEMPLATE` or `GIB_EARSIV_SOAP_BODY_TEMPLATE_PATH`
- `GIB_EARSIV_INVOICE_PREFIX`
- `GIB_EARSIV_NEXT_SEQUENCE`
- `GIB_EARSIV_TEST_ACCESS_CONFIRMED=true`
- `GIB_EARSIV_PRODUCTION_ACCESS_CONFIRMED=true` for production
- `GIB_EARSIV_AUTHORIZATION_REFERENCE`

Both signer commands must include `{input}` and `{output}` placeholders.
Optional placeholders are `{invoiceNumber}`, `{uuid}`, and `{taxId}`.

Example shape:

```sh
java -jar /opt/kamusm-ubl-signer/signer.jar --input {input} --output {output} --vkn {taxId}
java -jar /opt/kamusm-wss-signer/wss-signer.jar --input {input} --output {output} --vkn {taxId}
```

The SOAP template can use `{signedXmlBase64}`, `{signedXmlEscaped}`,
`{signedXmlCdata}`, `{unsignedXmlBase64}`, `{invoiceNumber}`, `{uuid}`, and
`{taxId}`.

## Firebase Hosting to local API

When the Firebase Hosting panel calls the local API at `http://localhost:4000`,
Chrome requires Local Network Access permission for `https://safa-8f76e.web.app`.
If the permission prompt does not appear, open
`chrome://settings/content/localNetworkAccess` and allow the SAFA Firebase
origin. For development, you can avoid this browser gate by opening the panel
from `http://localhost:3000`, or by pointing `NEXT_PUBLIC_API_BASE_URL` to the
public Render API URL instead of localhost.

## What is required before live issuing

- GIB test access for e-Arsiv web services.
- GIB approval to use the non-portal integration method in production.
- Mali muhur or NES signing capability, exposed to SAFA through the external
  document and SOAP/WSS signer commands.
- Final UBL-TR/e-Arsiv XML mapping validated against GIB schemas.
- SOAP method mapping from the current GIB e-Arsiv technical guide and entered
  as the SOAP body template.
- Operational certificate storage policy for the local machine.
- 7x24 operation, audit logging, secure storage, and disaster recovery process.

## Existing portal access is separate

SAFA can already read issued e-Arsiv records from the GIB portal credentials and
match them to Trendyol orders. That capability must stay in place: it prevents
duplicate issuing for orders that already have a portal or Trendyol invoice.

Direct issuing is a stricter path. Portal username/password proves the operator
can manually use the portal, but direct web-service issuing still needs the GIB
test/live authorization, document signing, SOAP/WSS signing, and schema-valid
payloads. SAFA must not silently fall back from failed direct issuing to fake
success.

## Runtime fail-closed rules

- Missing GIB direct fields block live issuing.
- Missing `{input}` or `{output}` placeholders block live issuing.
- Missing test access confirmation blocks live issuing.
- Production mode also requires production authorization confirmation.
- A document signer output without `Signature` is rejected.
- A SOAP signer output without `Security`, `Timestamp`, and `Signature` is
  rejected.
- Empty GIB responses or SOAP faults are rejected.
- Response hashes and command hashes are stored in the trace manifest; generated
  fake provider IDs are not used.

## Why portal bot is not the default

The public e-Arsiv portal is a web UI. Automating hidden portal endpoints is brittle:
field names, tokens, session behavior, CAPTCHA, or signing flows can change without
API versioning. The application therefore treats direct GIB web service integration
as the production path and fails closed until that path is authorized.

Official references:

- https://ebelge.gib.gov.tr/
- https://ebelge.gib.gov.tr/dosyalar/kilavuzlar/e-Arsiv_Teknik_Kilavuzu_V.1.18.pdf
- https://ebelge.gib.gov.tr/dosyalar/kilavuzlar/e-ArsivBasvuruKilavuzu-v1.1.pdf
