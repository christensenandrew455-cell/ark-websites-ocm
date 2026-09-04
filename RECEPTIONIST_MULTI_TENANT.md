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

ARK Client Center verifies the Telnyx signature and timestamp using `TELNYX_PUBLIC_KEY`, matches the destination phone number to one active business, and returns that business's profile plus its private intake and call-completion URLs. Railway should use:

```text
ARK_RUNTIME_URL=https://<ocm-host>/api/receptionist/runtime
```

No receptionist configuration secret is required. The removed `/api/receptionist/config` and `/api/receptionist/intake` compatibility routes must not be used.

For each verified incoming `call.initiated` event, the runtime also schedules one signed `receptionist.call.started` event for ARK Admin. The event uses the Telnyx call identifier for deduplication but stores no caller identity or caller number. Notification delivery runs after the runtime response so it does not delay the receptionist from answering.

Railway must post each completed call once to the returned `callCompletionUrl` with `action: "record"`, the returned `callCompletionKey`, and a stable provider `callId`. ARK hashes the account and call ID into one idempotent analytics event. Calls do not consume the monthly allowance. A unique lead counts once only when the business owner accepts it.

The runtime response includes the selected accepted-lead plan for context. Runtime lookups do not block calls based on lead usage; the Client Center enforces the accepted-lead limit atomically when the owner taps **Accept**.

The business profile includes the business name, owner, phone, email, time zone, regular service availability, optional emergency availability, service areas, services, and business facts. Service areas use one of two valid shapes: multiple states with no counties, or exactly one state with any number of counties. Firestore keeps the backward-compatible flat `serviceAreas` array, while the receptionist runtime also supplies `serviceAreaMode`, `serviceAreaStates`, and `serviceAreaCounties` so county restrictions are evaluated within their selected state. AI runtime controls do not come from ARK Client Center.

## Scheduled and emergency request contract

Every runtime profile contains `serviceRequestRouting`. Railway must follow its `mode` exactly:

- `scheduled-only`: offer normal scheduling, collect the caller's morning-or-evening preference first, and then collect the preferred day. `timingQuestion` is empty, the `emergency` branch is omitted, and the receptionist must not ask whether the call is an emergency.
- `asap-or-scheduled`: ask the exact non-leading `timingQuestion` returned by ARK. A caller who wants a normal project or a later visit stays on the scheduled path. A caller who requests help as soon as possible uses the returned `emergency` branch.

For the emergency branch, Railway must submit `requestUrgency: "emergency"` and use `requestedTimeWindow: "As soon as possible"`. The owner can enable this branch only for 24/7 emergency service, so `emergency.availability` is always `24/7`. It must collect the urgent problem and location without promising dispatch, arrival, or a confirmed appointment. If the caller reports a fire, gas odor, carbon monoxide, or another immediate danger, follow the returned safety instruction before continuing. Regular scheduling remains available in both modes.

ARK accepts the emergency marker only when that business has emergency service enabled. Accepted markers appear as an **Emergency · ASAP** indicator in Contacted You, remain attached if the owner accepts the lead into Clients, and use the urgent new-lead notification copy. Normal leads receive no emergency marker or emergency UI.

The model, voice, turn timing, output limits, context limits, response ceiling, call-duration ceiling, and provider credentials remain on Railway. ARK Client Center is the business-information control panel, connection router, intake destination, and Firestore-backed lead store.
