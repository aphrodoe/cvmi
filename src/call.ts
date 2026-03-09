import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { NostrClientTransport, PrivateKeySigner, EncryptionMode } from '@contextvm/sdk';
import { nip19 } from 'nostr-tools';
import { loadConfig, getUseConfig, DEFAULT_RELAYS } from './config/index.ts';
import type { CvmiConfig, ServerTargetConfig } from './config/index.ts';
import { generatePrivateKey, normalizePrivateKey, normalizePublicKey } from './utils/crypto.ts';
import { BOLD, DIM, RESET } from './constants/ui.ts';

export interface CallOptions {
  config?: string;
  privateKey?: string;
  relays?: string[];
  encryption?: EncryptionMode;
  isStateless?: boolean;
  debug?: boolean;
  verbose?: boolean;
  raw?: boolean;
  help?: boolean;
}

export interface ParseCallResult {
  server: string | undefined;
  capability: string | undefined;
  input: Record<string, unknown>;
  debug: boolean;
  verbose: boolean;
  raw: boolean;
  help: boolean;
  privateKey: string | undefined;
  relays: string[] | undefined;
  encryption: EncryptionMode | undefined;
  isStateless: boolean | undefined;
  config: string | undefined;
  unknownFlags: string[];
}

interface ResolvedServerTarget {
  input: string;
  pubkey: string;
  relays: string[];
  encryption: EncryptionMode;
  isStateless: boolean;
  aliasName?: string;
  description?: string;
}

function coerceValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (
    (value.startsWith('{') && value.endsWith('}')) ||
    (value.startsWith('[') && value.endsWith(']'))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export function parseCallArgs(args: string[]): ParseCallResult {
  const result: ParseCallResult = {
    server: undefined,
    capability: undefined,
    input: {},
    debug: false,
    verbose: false,
    raw: false,
    help: false,
    privateKey: undefined,
    relays: undefined,
    encryption: undefined,
    isStateless: undefined,
    config: undefined,
    unknownFlags: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';

    const consumeValue = (flagName: string): string | undefined => {
      const nextIndex = ++i;
      const value = args[nextIndex];
      if (value === undefined || value.startsWith('--')) {
        result.unknownFlags.push(`${flagName} (missing value)`);
        if (value?.startsWith('--')) i--;
        return undefined;
      }
      return value;
    };

    if (arg === '--debug') {
      result.debug = true;
      result.verbose = true;
    } else if (arg === '--verbose') {
      result.verbose = true;
    } else if (arg === '--raw') {
      result.raw = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--private-key') {
      result.privateKey = consumeValue('--private-key');
    } else if (arg === '--relays') {
      const value = consumeValue('--relays');
      result.relays = value ? value.split(',').map((relay) => relay.trim()) : undefined;
    } else if (arg === '--encryption-mode') {
      const value = consumeValue('--encryption-mode');
      if (value === 'required') result.encryption = EncryptionMode.REQUIRED;
      else if (value === 'disabled') result.encryption = EncryptionMode.DISABLED;
      else if (value === 'optional') result.encryption = EncryptionMode.OPTIONAL;
      else result.unknownFlags.push(`--encryption-mode${value ? ` (${value})` : ''}`);
    } else if (arg === '--config') {
      result.config = consumeValue('--config');
    } else if (arg === '--stateless') {
      result.isStateless = true;
    } else if (arg === '--stateful') {
      result.isStateless = false;
    } else if (arg.startsWith('--')) {
      result.unknownFlags.push(arg);
    } else if (!result.server) {
      result.server = arg;
    } else if (!result.capability) {
      result.capability = arg;
    } else if (arg.includes('=')) {
      const [key, ...rest] = arg.split('=');
      if (!key) {
        result.unknownFlags.push(arg);
        continue;
      }
      result.input[key] = coerceValue(rest.join('='));
    } else {
      result.unknownFlags.push(arg);
    }
  }

  return result;
}

function getAlias(config: CvmiConfig, input: string): ServerTargetConfig | undefined {
  return config.servers?.[input];
}

function resolveServerTarget(
  config: CvmiConfig,
  serverInput: string,
  options: CallOptions
): ResolvedServerTarget {
  const alias = getAlias(config, serverInput);
  const useConfig = getUseConfig(config.use || {});
  const configuredStateless = config.use?.isStateless;

  return {
    input: serverInput,
    pubkey: normalizePublicKey(alias?.pubkey ?? serverInput),
    relays: options.relays ?? alias?.relays ?? useConfig.relays ?? DEFAULT_RELAYS,
    encryption:
      options.encryption ?? alias?.encryption ?? useConfig.encryption ?? EncryptionMode.OPTIONAL,
    isStateless: options.isStateless ?? alias?.isStateless ?? configuredStateless ?? true,
    aliasName: alias ? serverInput : undefined,
    description: alias?.description,
  };
}

function formatDisplayPubkey(pubkey: string): string {
  return nip19.npubEncode(pubkey);
}

function logVerbose(enabled: boolean | undefined, message: string): void {
  if (enabled) {
    console.log(message);
  }
}

function renderToolList(tools: Tool[]): void {
  if (tools.length === 0) {
    console.log('  (no tools exposed)');
    return;
  }

  for (const tool of tools) {
    console.log(`  - ${tool.name}${tool.description ? `: ${tool.description}` : ''}`);
  }
}

function renderToolSchema(tool: Tool): void {
  renderSchemaProperties(tool.inputSchema as Record<string, unknown>, 'input parameters');
}

function formatSchemaType(schema: Record<string, unknown> | undefined): string {
  if (!schema) return 'unknown';

  if (typeof schema.type === 'string') {
    if (schema.type === 'array') {
      const itemType = formatSchemaType(
        schema.items && typeof schema.items === 'object'
          ? (schema.items as Record<string, unknown>)
          : undefined
      );
      return `${itemType}[]`;
    }

    return schema.type;
  }

  if (Array.isArray(schema.type) && schema.type.every((value) => typeof value === 'string')) {
    return schema.type.join(' | ');
  }

  if (Array.isArray(schema.anyOf)) {
    const variants = schema.anyOf
      .filter(
        (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
      )
      .map((entry) => formatSchemaType(entry));
    if (variants.length > 0) {
      return variants.join(' | ');
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const variants = schema.oneOf
      .filter(
        (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
      )
      .map((entry) => formatSchemaType(entry));
    if (variants.length > 0) {
      return variants.join(' | ');
    }
  }

  if (schema.properties && typeof schema.properties === 'object') {
    return 'object';
  }

  return 'unknown';
}

function renderNestedSchemaProperties(schema: Record<string, unknown>, indent: number): void {
  const properties =
    schema.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, unknown>)
      : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);

  for (const [name, value] of Object.entries(properties)) {
    const property =
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
    const type = formatSchemaType(property);
    const description =
      typeof property?.description === 'string' ? property.description : undefined;
    const enumValues = Array.isArray(property?.enum) ? ` enum(${property.enum.join(', ')})` : '';
    const prefix = ' '.repeat(indent);

    console.log(
      `${prefix}- ${name}${required.has(name) ? '' : '?'}: ${type}${enumValues}${description ? ` - ${description}` : ''}`
    );

    if (type === 'object' && property?.properties && typeof property.properties === 'object') {
      renderNestedSchemaProperties(property, indent + 2);
    }
  }
}

function getNestedObjectSchema(
  property: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!property) return undefined;

  if (
    property.type === 'object' &&
    property.properties &&
    typeof property.properties === 'object'
  ) {
    return property;
  }

  if (
    property.type === 'array' &&
    property.items &&
    typeof property.items === 'object' &&
    (property.items as Record<string, unknown>).type === 'object' &&
    (property.items as Record<string, unknown>).properties &&
    typeof (property.items as Record<string, unknown>).properties === 'object'
  ) {
    return property.items as Record<string, unknown>;
  }

  return undefined;
}

function renderSchemaProperties(
  schema: Record<string, unknown> | undefined,
  emptyLabel: string
): void {
  const properties =
    schema?.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, unknown>)
      : {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  const names = Object.keys(properties);

  if (names.length === 0) {
    console.log(`  (no ${emptyLabel})`);
    return;
  }

  for (const name of names) {
    const property = properties[name] as Record<string, unknown> | undefined;
    const type = formatSchemaType(property);
    const description =
      typeof property?.description === 'string' ? property.description : undefined;
    const enumValues = Array.isArray(property?.enum) ? ` enum(${property.enum.join(', ')})` : '';

    const nestedObjectSchema = getNestedObjectSchema(property);
    if (nestedObjectSchema) {
      console.log(
        `  - ${name}${required.has(name) ? '' : '?'}: ${type}${description ? ` - ${description}` : ''}`
      );
      renderNestedSchemaProperties(nestedObjectSchema, 4);
      continue;
    }

    console.log(
      `  - ${name}${required.has(name) ? '' : '?'}: ${type}${enumValues}${description ? ` - ${description}` : ''}`
    );
  }
}

function hasRenderableContent(value: unknown): value is {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; mimeType: string; data: string }
    | { type: 'audio'; mimeType: string; data: string }
    | Record<string, unknown>
  >;
  structuredContent?: unknown;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

function renderStructuredValue(value: unknown, indent = 0): void {
  const prefix = ' '.repeat(indent);

  if (value === null || value === undefined) {
    console.log(`${prefix}${String(value)}`);
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      console.log(`${prefix}[]`);
      return;
    }

    for (const item of value) {
      if (item !== null && typeof item === 'object') {
        console.log(`${prefix}-`);
        renderStructuredValue(item, indent + 2);
      } else {
        console.log(`${prefix}- ${String(item)}`);
      }
    }
    return;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      console.log(`${prefix}{}`);
      return;
    }

    for (const [key, entryValue] of entries) {
      if (entryValue !== null && typeof entryValue === 'object') {
        console.log(`${prefix}${key}:`);
        renderStructuredValue(entryValue, indent + 2);
      } else {
        console.log(`${prefix}${key}: ${String(entryValue)}`);
      }
    }
    return;
  }

  console.log(`${prefix}${String(value)}`);
}

function renderDefaultResult(result: unknown): void {
  if (!hasRenderableContent(result)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.structuredContent !== undefined) {
    renderStructuredValue(result.structuredContent);
    return;
  }

  for (const item of result.content) {
    if (item.type === 'text') {
      console.log(item.text);
    } else if (item.type === 'image') {
      const data = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
      console.log(`[image ${item.mimeType}, ${data.length} bytes base64]`);
    } else if (item.type === 'audio') {
      const data = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
      console.log(`[audio ${item.mimeType}, ${data.length} bytes base64]`);
    } else {
      console.log(JSON.stringify(item, null, 2));
    }
  }
}

export const __test__ = {
  renderDefaultResult,
  resolveServerTarget,
  printServerSummary,
  printToolHelp,
};

async function createRemoteClient(target: ResolvedServerTarget, options: CallOptions) {
  let privateKey = options.privateKey;
  if (!privateKey) {
    privateKey = generatePrivateKey();
  }

  privateKey = normalizePrivateKey(privateKey);

  const signer = new PrivateKeySigner(privateKey);
  const transport = new NostrClientTransport({
    signer,
    relayHandler: target.relays,
    serverPubkey: target.pubkey,
    encryptionMode: target.encryption,
    isStateless: target.isStateless,
    logLevel: options.debug ? 'debug' : 'silent',
  });

  const client = new Client({ name: 'cvmi', version: '0.1.0' });
  await client.connect(transport);

  return {
    client,
    async close() {
      await client.close();
      await transport.close();
    },
  };
}

function printServerSummary(target: ResolvedServerTarget, tools: Tool[]): void {
  const serverLabel = target.aliasName
    ? `${formatDisplayPubkey(target.pubkey)} (${target.aliasName})`
    : formatDisplayPubkey(target.pubkey);
  console.log(`${BOLD}Server pubkey:${RESET} ${serverLabel}`);
  console.log(`${BOLD}Relays:${RESET} ${target.relays.join(', ')}`);
  if (target.description) {
    console.log(`${BOLD}Description:${RESET} ${target.description}`);
  }
  console.log(`${BOLD}Tools:${RESET} ${tools.length}`);
  renderToolList(tools);
}

function printServerHelp(target: ResolvedServerTarget, tools: Tool[]): void {
  console.log(`${BOLD}Usage:${RESET} cvmi call <server> <capability> [key=value ...] [options]`);
  console.log();
  printServerSummary(target, tools);
  console.log();
  console.log(`${BOLD}Examples:${RESET}`);
  console.log(`  ${DIM}$${RESET} cvmi call ${target.input}`);
  console.log(`  ${DIM}$${RESET} cvmi call ${target.input} <tool> --help`);
  console.log(`  ${DIM}$${RESET} cvmi call ${target.input} <tool> key=value`);
}

function printToolHelp(target: ResolvedServerTarget, tool: Tool): void {
  console.log(
    `${BOLD}Usage:${RESET} cvmi call ${target.input} ${tool.name} [key=value ...] [options]`
  );
  console.log();
  console.log(`${BOLD}Capability:${RESET} ${tool.name}`);
  console.log(`${BOLD}Kind:${RESET} tool`);
  if (tool.description) {
    console.log(`${BOLD}Description:${RESET} ${tool.description}`);
  }
  console.log(`${BOLD}Input:${RESET}`);
  renderToolSchema(tool);

  const outputSchema = (tool as Tool & { outputSchema?: Record<string, unknown> }).outputSchema;
  if (outputSchema) {
    console.log(`${BOLD}Output:${RESET}`);
    renderSchemaProperties(outputSchema, 'output fields');
  }
}

function resolveToolName(capability: string): string {
  return capability.startsWith('tool:') ? capability.slice('tool:'.length) : capability;
}

export async function call(
  serverArg: string | undefined,
  capabilityArg: string | undefined,
  input: Record<string, unknown>,
  options: CallOptions
): Promise<void> {
  const config = await loadConfig(
    {
      use: {
        relays: options.relays,
        encryption: options.encryption,
      },
    },
    options.config
  );

  const serverInput = serverArg ?? getUseConfig(config.use || {}).serverPubkey;
  if (!serverInput) {
    showCallHelp();
    process.exit(1);
  }

  const target = resolveServerTarget(config, serverInput, options);
  logVerbose(
    options.verbose,
    `Connecting to ${target.aliasName ?? formatDisplayPubkey(target.pubkey)}...`
  );
  const remote = await createRemoteClient(target, options);

  try {
    if (!capabilityArg) {
      logVerbose(options.verbose, 'Discovering tools...');
      const toolsResult = await remote.client.listTools();
      const tools = toolsResult.tools;
      if (options.help) {
        printServerHelp(target, tools);
      } else {
        printServerSummary(target, tools);
      }
      return;
    }

    const toolName = resolveToolName(capabilityArg);
    if (options.help) {
      logVerbose(options.verbose, 'Discovering tools...');
      const toolsResult = await remote.client.listTools();
      const tool = toolsResult.tools.find((entry) => entry.name === toolName);
      if (!tool) {
        throw new Error(`Capability not found: ${capabilityArg}`);
      }
      printToolHelp(target, tool);
      return;
    }

    logVerbose(options.verbose, `Calling tool: ${toolName}`);
    const result = await remote.client.callTool({
      name: toolName,
      arguments: input,
    });

    if (options.raw) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    renderDefaultResult(result);
  } finally {
    await remote.close();
  }
}

export function showCallHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} cvmi call <server> [capability] [key=value ...] [options]

${BOLD}Description:${RESET}
  Connect directly to a remote ContextVM server and inspect or invoke its capabilities.

${BOLD}Arguments:${RESET}
  <server>                Server pubkey (npub1 or hex) or configured alias
  <capability>            Capability selector, currently tool name or tool:<name>
  key=value               Input arguments for tool calls

${BOLD}Options:${RESET}
  --config <path>         Path to custom config JSON file
  --private-key <key>     Your Nostr private key (hex/nsec format, auto-generated if not provided)
  --relays <urls>         Comma-separated relay URLs
  --encryption-mode       Encryption mode: optional, required, disabled
  --stateless             Enable stateless transport mode (default)
  --stateful              Disable stateless transport mode
  --raw                   Print raw JSON result
  --verbose               Enable cvmi progress logging
  --debug                 Enable SDK debug logging
  --help, -h              Show this help message

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} cvmi call weather
  ${DIM}$${RESET} cvmi call weather --help
  ${DIM}$${RESET} cvmi call weather weather.get_current city=Lisbon
  ${DIM}$${RESET} cvmi call weather --debug
  ${DIM}$${RESET} cvmi call npub1... tool:weather.get_current city=Lisbon --raw
  `);
}
