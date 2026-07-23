# Shared AI receptionist configuration

The administrator page at `/receptionists` stores one receptionist profile per client. Each profile includes:

- Telnyx destination number and connection ID
- ARK client ID and existing private connection key
- receptionist script
- voice, pacing, pause detection, and Realtime model
- structured business information, services, service areas, hours, estimate days, and prompt-safe extra facts

Railway calls `/api/receptionist/config` with the destination number and Telnyx connection ID. The route requires `RECEPTIONIST_CONFIG_SECRET`, verifies the stored mapping, and returns the profile plus client-specific intake and usage URLs.

## Vercel variable

```text
RECEPTIONIST_CONFIG_SECRET=<long random value shared only with Railway>
```

Do not prefix this value with `NEXT_PUBLIC_`.

## Firestore

The editor saves full profiles at:

```text
ocmClients/{clientId}/settings/receptionist
```

The lookup fields are mirrored onto:

```text
connections/{clientId}
```

The destination phone number is normalized before lookup, and a number cannot be assigned to two clients through the admin API.
