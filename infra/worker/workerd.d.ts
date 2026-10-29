import type {
  WebSocket as WorkersWebSocket,
  WebSocketRequestResponsePair as WorkersPair,
} from '@cloudflare/workers-types'

// NOTE: the Workers runtime globals the sync Durable Object uses. The rest
// of infra is typed against Bun's globals (for `bun test`), which lack them.
declare global {
  const WebSocketPair: {
    new (): { 0: WorkersWebSocket; 1: WorkersWebSocket }
  }
  const WebSocketRequestResponsePair: {
    new (request: string, response: string): WorkersPair
  }
  interface ResponseInit {
    webSocket?: WorkersWebSocket | null
  }
}
