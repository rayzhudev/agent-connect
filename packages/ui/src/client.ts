/**
 * Shared AgentConnect client singleton.
 */

import { AgentConnect } from '@agentconnect/sdk';
import type { AgentConnectClient } from '@agentconnect/sdk';

let clientPromise: Promise<AgentConnectClient> | null = null;

/**
 * Get or create the shared AgentConnect client instance.
 * Uses a singleton pattern to ensure all components share the same connection.
 */
export function getClient(): Promise<AgentConnectClient> {
  if (!clientPromise) {
    clientPromise = AgentConnect.connect();
  }
  return clientPromise;
}

/**
 * Reset the client connection.
 * Useful for testing or when the connection needs to be re-established.
 */
export function resetClient(): void {
  clientPromise = null;
}
