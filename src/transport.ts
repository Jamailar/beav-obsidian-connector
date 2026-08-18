import {
  type ConnectorMessage,
  type HostMessage,
  isHostMessage,
} from './protocol';

export type ConnectionState = 'offline' | 'connecting' | 'ready' | 'degraded';

export interface ConnectorTransportDelegate {
  onHostMessage(message: HostMessage): void | Promise<void>;
  onStateChange(state: ConnectionState, reason?: string): void;
}

export class ConnectorTransport {
  private socket: WebSocket | null = null;

  constructor(
    private readonly endpoint: string,
    private readonly delegate: ConnectorTransportDelegate,
  ) {}

  connect(): void {
    this.close();
    this.delegate.onStateChange('connecting');
    try {
      this.socket = new WebSocket(this.endpoint);
      this.socket.addEventListener('open', () => this.delegate.onStateChange('ready'));
      this.socket.addEventListener('close', () => this.delegate.onStateChange('degraded', 'loopback connection closed'));
      this.socket.addEventListener('error', () => this.delegate.onStateChange('degraded', 'loopback connection failed'));
      this.socket.addEventListener('message', (event) => this.handleMessage(event.data));
    } catch (error) {
      this.delegate.onStateChange('degraded', error instanceof Error ? error.message : 'loopback connection failed');
    }
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  send(message: ConnectorMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    try {
      const message = JSON.parse(data) as unknown;
      if (isHostMessage(message)) {
        void this.delegate.onHostMessage(message);
      }
    } catch {
      this.delegate.onStateChange('degraded', 'received an invalid host message');
    }
  }
}
