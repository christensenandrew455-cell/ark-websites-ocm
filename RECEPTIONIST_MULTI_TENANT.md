# Shared AI receptionist configuration

ARK Client Center stores one receptionist profile per client at:

```text
accounts/{clientId}
```

ARK Admin edits the same authoritative business record through its private Accounts workspace. The connected receptionist number, connection key, enabled state, and business profile remain fields on that account record. Removing or disabling the receptionist fields stops call routing without deleting the customer account.

A shared Railway receptionist service forwards the original signed Telnyx call event to:

```text
POST /api/receptionist/runtime
```

ARK Client Center verifies the Telnyx signature and timestamp using `TELNYX_PUBLIC_KEY`, matches the destination phone number to one business, verifies that its monthly call allowance is not exhausted, and returns that business's profile plus its private intake and call-completion URLs. Railway should use:

```text
ARK_RUNTIME_URL=https://<ocm-host>/api/receptionist/runtime
```

No receptionist configuration secret is required. The removed `/api/receptionist/config` and `/api/receptionist/intake` compatibility routes must not be used.

Railway must post each completed call once to the returned `callCompletionUrl` with `action: "record"`, the returned `callCompletionKey`, and a stable provider `callId`. ARK hashes the account and call ID into one idempotent call event, so retries never consume another call. Saving or accepting a lead does not create a charge and does not change the call count.

The runtime response includes the selected call plan, calls used, calls remaining, and billing-period end. Once no calls remain, new runtime lookups return `MONTHLY_CALL_LIMIT_REACHED`. A call already in progress may still report completion, and the counter never results in an overage charge.

The business profile includes the business name, owner, phone, email, hours, time zone, estimate availability, service areas, services, and business facts. Service areas use one of two valid shapes: multiple states with no counties, or exactly one state with any number of counties. Firestore keeps the backward-compatible flat `serviceAreas` array, while the receptionist runtime also supplies `serviceAreaMode`, `serviceAreaStates`, and `serviceAreaCounties` so county restrictions are evaluated within their selected state. AI runtime controls do not come from ARK Client Center.

The model, voice, turn timing, output limits, context limits, response ceiling, call-duration ceiling, and provider credentials remain on Railway. ARK Client Center is the business-information control panel, connection router, intake destination, and Firestore-backed lead store.
