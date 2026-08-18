import { Notice, Plugin, type TAbstractFile, type TFile } from 'obsidian';

import {
  CONNECTOR_ID,
  DEFAULT_HOST_ENDPOINT,
  PROTOCOL_VERSION,
  type ConnectorCapability,
  type ConnectorDelta,
  type ConnectorMessage,
  type HostMessage,
  type VaultIdentity,
  createCursor,
  createEventId,
  normalizeVaultPath,
} from './protocol';
import { BeavConnectorSettingTab } from './settings';
import { ConnectorTransport, type ConnectionState, type ConnectorTransportDelegate } from './transport';
import { buildSnapshot, connectorDocumentForFile } from './vaultSnapshot';

interface ConnectorSettings {
  vaultId: string;
  endpoint: string;
  encryptedPairingToken: string;
}

const DEFAULT_SETTINGS: ConnectorSettings = {
  vaultId: '',
  endpoint: DEFAULT_HOST_ENDPOINT,
  encryptedPairingToken: '',
};

type ElectronSafeStorage = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

function safeStorage(): ElectronSafeStorage | null {
  try {
    const electron = require('electron') as { safeStorage?: ElectronSafeStorage };
    return electron.safeStorage ?? null;
  } catch {
    return null;
  }
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
  return file instanceof (require('obsidian') as typeof import('obsidian')).TFile
    && file.extension.toLowerCase() === 'md';
}

export default class BeavConnectorPlugin extends Plugin implements ConnectorTransportDelegate {
  private connectorSettings: ConnectorSettings = DEFAULT_SETTINGS;
  private transport: ConnectorTransport | null = null;
  private connectionState: ConnectionState = 'offline';
  private connectionReason: string | undefined;
  private cursor = createCursor();
  private reconnectTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    if (!this.connectorSettings.vaultId) {
      this.connectorSettings.vaultId = crypto.randomUUID();
      await this.saveSettings();
    }

    this.addSettingTab(new BeavConnectorSettingTab(this));
    this.addCommand({
      id: 'reconnect-to-beav',
      name: 'Reconnect to Beav',
      callback: () => this.reconnect(),
    });
    this.addCommand({
      id: 'reset-beav-pairing',
      name: 'Reset Beav pairing',
      callback: () => this.resetPairing(),
    });

    this.registerEvent(this.app.vault.on('create', (file) => this.handleUpsert(file)));
    this.registerEvent(this.app.vault.on('modify', (file) => this.handleUpsert(file)));
    this.registerEvent(this.app.vault.on('delete', (file) => this.handleDelete(file)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.handleRename(file, oldPath)));
    this.registerEvent(this.app.metadataCache.on('changed', (file) => this.handleUpsert(file)));

    this.app.workspace.onLayoutReady(() => this.reconnect());
  }

  onunload(): void {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.transport?.close();
  }

  connectionDescription(): string {
    if (this.connectionState === 'ready') return 'Connected to Beav.';
    if (this.connectionState === 'connecting') return 'Connecting to Beav…';
    if (this.connectionReason) return `Connection unavailable: ${this.connectionReason}`;
    return 'Not connected to Beav.';
  }

  reconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.transport ??= new ConnectorTransport(this.connectorSettings.endpoint, this);
    this.transport.connect();
  }

  async resetPairing(): Promise<void> {
    this.connectorSettings.encryptedPairingToken = '';
    await this.saveSettings();
    new Notice('Beav pairing was reset for this vault.');
    this.reconnect();
  }

  onStateChange(state: ConnectionState, reason?: string): void {
    this.connectionState = state;
    this.connectionReason = reason;
    if (state === 'ready') {
      this.sendHello();
      return;
    }
    if (state === 'degraded') {
      this.scheduleReconnect();
    }
  }

  async onHostMessage(message: HostMessage): Promise<void> {
    if (message.type === 'beav.pair.accepted') {
      await this.storePairingToken(message.pairingToken);
      this.sendHello();
      return;
    }
    if (message.type === 'beav.snapshot.request') {
      await this.sendSnapshot();
      return;
    }
    if (message.type === 'beav.error') {
      this.onStateChange('degraded', `${message.code}: ${message.message}`);
    }
  }

  private vaultIdentity(): VaultIdentity {
    return {
      id: this.connectorSettings.vaultId,
      name: this.app.vault.getName(),
      configDir: normalizeVaultPath(this.app.vault.configDir),
    };
  }

  private capabilities(): ConnectorCapability[] {
    return [
      'vault-snapshot-v1',
      'vault-delta-v1',
      'metadata-cache-v1',
      'resolved-links-v1',
      'cached-read-v1',
    ];
  }

  private sendHello(): void {
    this.send({
      type: 'connector.hello',
      connectorId: CONNECTOR_ID,
      protocolVersion: PROTOCOL_VERSION,
      vault: this.vaultIdentity(),
      capabilities: this.capabilities(),
      ...(this.pairingToken() ? { pairingToken: this.pairingToken() ?? undefined } : {}),
    });
  }

  private async sendSnapshot(): Promise<void> {
    try {
      const snapshot = await buildSnapshot(this.app, this.vaultIdentity());
      this.cursor = snapshot.cursor;
      this.send({ type: 'connector.snapshot', snapshot });
    } catch (error) {
      this.onStateChange('degraded', error instanceof Error ? error.message : 'snapshot failed');
    }
  }

  private async handleUpsert(file: TAbstractFile): Promise<void> {
    if (!isMarkdownFile(file)) return;
    try {
      const document = await connectorDocumentForFile(this.app, file);
      this.sendDelta({
        kind: 'upsert',
        eventId: createEventId('upsert', document.path),
        cursor: this.nextCursor(),
        document,
      });
    } catch (error) {
      this.onStateChange('degraded', error instanceof Error ? error.message : 'note update failed');
    }
  }

  private handleDelete(file: TAbstractFile): void {
    if (!isMarkdownFile(file)) return;
    const path = normalizeVaultPath(file.path);
    this.sendDelta({
      kind: 'delete',
      eventId: createEventId('delete', path),
      cursor: this.nextCursor(),
      path,
    });
  }

  private handleRename(file: TAbstractFile, oldPath: string): void {
    if (!isMarkdownFile(file)) return;
    const from = normalizeVaultPath(oldPath);
    const to = normalizeVaultPath(file.path);
    this.sendDelta({
      kind: 'rename',
      eventId: createEventId('rename', `${from}:${to}`),
      cursor: this.nextCursor(),
      from,
      to,
    });
  }

  private sendDelta(delta: ConnectorDelta): void {
    this.send({ type: 'connector.delta', vaultId: this.connectorSettings.vaultId, delta });
  }

  private send(message: ConnectorMessage): void {
    if (!this.transport?.send(message)) this.onStateChange('degraded', 'waiting for Beav loopback connection');
  }

  private nextCursor(): string {
    this.cursor = createCursor();
    return this.cursor;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnect();
    }, 3_000);
  }

  private pairingToken(): string | null {
    if (!this.connectorSettings.encryptedPairingToken) return null;
    const storage = safeStorage();
    if (!storage?.isEncryptionAvailable()) return null;
    try {
      return storage.decryptString(Buffer.from(this.connectorSettings.encryptedPairingToken, 'base64'));
    } catch {
      return null;
    }
  }

  private async storePairingToken(token: string): Promise<void> {
    const storage = safeStorage();
    if (!storage?.isEncryptionAvailable()) {
      throw new Error('OS credential encryption is unavailable');
    }
    this.connectorSettings.encryptedPairingToken = storage.encryptString(token).toString('base64');
    await this.saveSettings();
  }

  private async loadSettings(): Promise<void> {
    this.connectorSettings = { ...DEFAULT_SETTINGS, ...await this.loadData() };
  }

  private async saveSettings(): Promise<void> {
    await this.saveData(this.connectorSettings);
  }
}
