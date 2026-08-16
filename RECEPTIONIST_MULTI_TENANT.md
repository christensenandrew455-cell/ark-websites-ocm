# Shared AI receptionist configuration

ARK Client Center stores one receptionist profile per client at:

```text
ocmClients/{clientId}/settings/receptionist
```

The administrator edits the same business information customers see through the Accounts workspace. The connected receptionist number is stored privately on the client connection record and can be removed to stop call routing without deleting the customer account.

A shared Railway receptionist service forwards the original signed Telnyx call event to:

```text
POST /api/receptionist/runtime
```

ARK Client Center verifies the Telnyx signature and timestamp using `TELNYX_PUBLIC_KEY`, matches the destination phone number to one business, and returns that business's profile plus its private intake and call-usage URLs. Railway should use:

```text
ARC_RUNTIME_URL=https://<ocm-host>/api/receptionist/runtime
```

No receptionist configuration secret is required. The removed `/api/receptionist/config` and `/api/receptionist/intake` compatibility routes must not be used.

Railway must post each completed call once to the returned `usageUrl` with `action: "record"` and a stable `callId`. If that call also saves a lead through `intakeUrl`, send the identical value as `callControlId` (or the intake idempotency key). ARK derives the same usage ID from both requests, so the $2 call/lead unit is charged once rather than twice.

The business profile includes the business name, owner, phone, email, hours, time zone, estimate availability, service areas, services, and business facts. AI runtime controls do not come from ARK Client Center.

The model, voice, turn timing, output limits, context limits, response ceiling, call-duration ceiling, and provider credentials remain on Railway. ARK Client Center is the business-information control panel, connection router, intake destination, and Firestore-backed lead store.
