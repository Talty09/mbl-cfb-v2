import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { config } from '../config';

let io: SocketServer | null = null;

/**
 * Socket.io carries live draft events and chat messages.
 * Events emitted by the server:
 *  - 'draft:pick'   — a pick was made; payload is the full updated draft state
 *  - 'chat:message' — a new chat message; payload is the message with its author
 */
export function initRealtime(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: { origin: config.corsOrigins },
  });
  return io;
}

export function getIo(): SocketServer {
  if (!io) throw new Error('Realtime not initialized — call initRealtime first');
  return io;
}
