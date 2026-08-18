import type { App, CachedMetadata, TFile } from 'obsidian';

import {
  type BlockMetadata,
  type ConnectorDocument,
  type ConnectorSnapshot,
  type HeadingMetadata,
  type LinkMetadata,
  type NoteMetadata,
  type VaultIdentity,
  createCursor,
  normalizeVaultPath,
} from './protocol';

const SNAPSHOT_CONCURRENCY = 4;

function sourceLine(position: { start?: { line?: number } } | undefined): number | undefined {
  const line = position?.start?.line;
  return typeof line === 'number' && Number.isFinite(line) ? line + 1 : undefined;
}

function linkMetadata(items: CachedMetadata['links'] | CachedMetadata['embeds'] | undefined): LinkMetadata[] {
  return (items ?? []).map((item) => ({
    target: String(item.link ?? '').trim(),
    ...(item.displayText ? { displayText: item.displayText } : {}),
    ...(item.original ? { original: item.original } : {}),
    ...(sourceLine(item.position) ? { line: sourceLine(item.position) } : {}),
  })).filter((item) => item.target.length > 0);
}

function headings(items: CachedMetadata['headings'] | undefined): HeadingMetadata[] {
  return (items ?? []).map((item) => ({
    text: item.heading,
    level: item.level,
    line: sourceLine(item.position) ?? 1,
  }));
}

function blocks(items: CachedMetadata['blocks'] | undefined): BlockMetadata[] {
  return Object.entries(items ?? {}).map(([id, item]) => ({
    id,
    line: sourceLine(item.position) ?? 1,
  }));
}

function tags(items: CachedMetadata['tags'] | undefined): string[] {
  return [...new Set((items ?? []).map((item) => item.tag.trim()).filter(Boolean))].sort();
}

function mapCountRecord(value: Record<string, number> | undefined): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value ?? {})
      .filter(([path, count]) => normalizeVaultPath(path).length > 0 && Number.isFinite(count))
      .map(([path, count]) => [normalizeVaultPath(path), count]),
  );
}

export function metadataForFile(app: App, file: TFile): NoteMetadata {
  const metadata = app.metadataCache.getFileCache(file);
  return {
    frontmatter: metadata?.frontmatter ?? {},
    headings: headings(metadata?.headings),
    tags: tags(metadata?.tags),
    links: linkMetadata(metadata?.links),
    embeds: linkMetadata(metadata?.embeds),
    blocks: blocks(metadata?.blocks),
    resolvedLinks: mapCountRecord(app.metadataCache.resolvedLinks[file.path]),
    unresolvedLinks: mapCountRecord(app.metadataCache.unresolvedLinks[file.path]),
  };
}

async function sha256(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function connectorDocumentForFile(app: App, file: TFile): Promise<ConnectorDocument> {
  const content = await app.vault.cachedRead(file);
  return {
    path: normalizeVaultPath(file.path),
    content,
    contentHash: await sha256(content),
    mtime: file.stat.mtime,
    size: file.stat.size,
    metadata: metadataForFile(app, file),
  };
}

async function mapConcurrent<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SNAPSHOT_CONCURRENCY, items.length) }, worker));
  return results;
}

export async function buildSnapshot(app: App, vault: VaultIdentity): Promise<ConnectorSnapshot> {
  const files = app.vault.getMarkdownFiles();
  return {
    vault,
    cursor: createCursor(),
    generatedAt: new Date().toISOString(),
    documents: await mapConcurrent(files, (file) => connectorDocumentForFile(app, file)),
  };
}
