export const CONNECTOR_ID = 'beav-connector';
export const PROTOCOL_VERSION = 1;
export const DEFAULT_HOST_ENDPOINT = 'ws://127.0.0.1:49221/beav-connector';

export type ConnectorCapability =
  | 'vault-snapshot-v1'
  | 'vault-delta-v1'
  | 'metadata-cache-v1'
  | 'resolved-links-v1'
  | 'cached-read-v1';

export interface VaultIdentity {
  id: string;
  name: string;
  configDir: string;
}

export interface HeadingMetadata {
  text: string;
  level: number;
  line: number;
}

export interface LinkMetadata {
  target: string;
  displayText?: string;
  original?: string;
  line?: number;
}

export interface BlockMetadata {
  id: string;
  line: number;
}

export interface NoteMetadata {
  frontmatter: Record<string, unknown>;
  headings: HeadingMetadata[];
  tags: string[];
  links: LinkMetadata[];
  embeds: LinkMetadata[];
  blocks: BlockMetadata[];
  resolvedLinks: Record<string, number>;
  unresolvedLinks: Record<string, number>;
}

export interface ConnectorDocument {
  path: string;
  content: string;
  contentHash: string;
  mtime: number;
  size: number;
  metadata: NoteMetadata;
}

export interface ConnectorSnapshot {
  vault: VaultIdentity;
  cursor: string;
  generatedAt: string;
  documents: ConnectorDocument[];
}

export type ConnectorDelta =
  | {
      kind: 'upsert';
      eventId: string;
      cursor: string;
      document: ConnectorDocument;
    }
  | {
      kind: 'delete';
      eventId: string;
      cursor: string;
      path: string;
    }
  | {
      kind: 'rename';
      eventId: string;
      cursor: string;
      from: string;
      to: string;
    };

export type HostMessage =
  | {
      type: 'beav.pair.accepted';
      pairingToken: string;
    }
  | {
      type: 'beav.connector.ready';
      cursor?: string;
    }
  | {
      type: 'beav.snapshot.request';
    }
  | {
      type: 'beav.error';
      code: string;
      message: string;
    };

export type ConnectorMessage =
  | {
      type: 'connector.hello';
      connectorId: typeof CONNECTOR_ID;
      protocolVersion: typeof PROTOCOL_VERSION;
      vault: VaultIdentity;
      capabilities: ConnectorCapability[];
      pairingToken?: string;
    }
  | {
      type: 'connector.snapshot';
      snapshot: ConnectorSnapshot;
    }
  | {
      type: 'connector.delta';
      vaultId: string;
      delta: ConnectorDelta;
    }
  | {
      type: 'connector.status';
      vaultId: string;
      state: 'connecting' | 'ready' | 'degraded';
      reason?: string;
    };

export function normalizeVaultPath(path: string): string {
  return path.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
}

export function createCursor(epoch = Date.now()): string {
  return `${epoch}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEventId(kind: ConnectorDelta['kind'], path: string): string {
  return `${kind}:${normalizeVaultPath(path)}:${createCursor()}`;
}

export function isHostMessage(value: unknown): value is HostMessage {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return type === 'beav.pair.accepted'
    || type === 'beav.connector.ready'
    || type === 'beav.snapshot.request'
    || type === 'beav.error';
}
