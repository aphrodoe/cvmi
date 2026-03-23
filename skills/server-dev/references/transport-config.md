# NostrServerTransport Configuration

## Complete Options Interface

```typescript
interface NostrServerTransportOptions {
  // Required
  signer: NostrSigner;
  relayHandler: RelayHandler | string[];

  // Optional - Server metadata
  serverInfo?: ServerInfo;

  // Optional - Discovery
  /** @deprecated Use isAnnouncedServer instead. */
  isPublicServer?: boolean;
  isAnnouncedServer?: boolean;
  publishRelayList?: boolean;
  relayListUrls?: string[];
  bootstrapRelayUrls?: string[];

  // Optional - Access control
  allowedPublicKeys?: string[];
  excludedCapabilities?: CapabilityExclusion[];

  // Optional - Features
  injectClientPubkey?: boolean;
  encryptionMode?: EncryptionMode;
  logLevel?: LogLevel;
}
```

## ServerInfo

```typescript
interface ServerInfo {
  name?: string; // Human-readable name
  picture?: string; // Icon URL
  website?: string; // Website URL
  about?: string; // Description
}
```

## CapabilityExclusion

```typescript
interface CapabilityExclusion {
  method: string; // e.g., "tools/call", "tools/list"
  name?: string; // Specific tool/resource name
}
```

## EncryptionMode

- `OPTIONAL` (default) - Use encryption if client supports it
- `REQUIRED` - Only accept encrypted connections
- `DISABLED` - Never use encryption

## Discoverability Options

- `isAnnouncedServer` - Publishes public announcement metadata for relay-based discovery
- `isPublicServer` - Deprecated alias for `isAnnouncedServer`
- `publishRelayList` - TypeScript SDK option that publishes `kind:10002` relay-list metadata unless explicitly disabled
- `relayListUrls` - Explicit relay URLs to advertise in the relay list
- `bootstrapRelayUrls` - Extra relays where discoverability events are published without advertising them as operational relays

## LogLevel

- `debug` - Detailed tracing
- `info` - Lifecycle events
- `warn` - Unexpected situations
- `error` - Failures
- `silent` - No logging

## Structured Tool Results

When building MCP servers on top of [`NostrServerTransport`](../../references/transport-config.md), structured outputs are defined at the tool level rather than on the transport.

- Use `outputSchema` on [`server.registerTool()`](../../SKILL.md) when the tool should expose a validated machine-readable result.
- Return `structuredContent` for programmatic consumers.
- Return `content` for human-readable summaries only.
- `content` and `structuredContent` do not need to contain the same data.
- If a tool is intended only for machine consumption, `content` may be `[]`.

Minimal pattern:

```typescript
server.registerTool(
  'get_weather',
  {
    description: 'Get weather information for a city',
    inputSchema: z.object({ city: z.string(), country: z.string() }),
    outputSchema: z.object({
      temperature: z.object({ celsius: z.number(), fahrenheit: z.number() }),
      conditions: z.string(),
    }),
  },
  async () => ({
    content: [],
    structuredContent: {
      temperature: { celsius: 22, fahrenheit: 71.6 },
      conditions: 'sunny',
    },
  })
);
```
