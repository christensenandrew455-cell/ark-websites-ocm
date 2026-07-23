# Shared AI receptionist configuration

ARK Client Center stores one receptionist profile per client at:

```text
ocmClients/{clientId}/settings/receptionist
```

The administrator edits the same business and AI information customers see through the Accounts workspace. The connected receptionist number is stored privately on the client connection record and can be removed to stop call routing without deleting the customer account.

A shared Railway receptionist service can request the correct client profile from:

```text
GET /api/receptionist/config?phone=<destination-number>&connectionId=<optional-telnyx-connection-id>
```

The request must include the server-only secret as either:

```text
Authorization: Bearer <RECEPTIONIST_CONFIG_SECRET>
```

or:

```text
x-ark-receptionist-key: <RECEPTIONIST_CONFIG_SECRET>
```

## Vercel variable

```text
RECEPTIONIST_CONFIG_SECRET=<long random value shared only with Railway>
```

Do not prefix this value with `NEXT_PUBLIC_`.

The route matches the normalized destination phone number, checks that the account and receptionist are enabled, verifies the optional Telnyx connection ID when one is stored, and returns the client-specific intake URL plus the saved business and AI profile.

The AI model and provider credentials remain on Railway. Vercel is only the control panel and Firestore-backed profile store and does not need `AI_MODEL`, `OPENAI_API_KEY`, or other AI runtime credentials.
