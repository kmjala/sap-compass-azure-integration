/**
 * This file contains code used by all Functions to send messages to a
 * Service Bus queue or topic.
 */

import {
  DefaultAzureCredential,
  ManagedIdentityCredential,
} from "@azure/identity";
import { ServiceBusClient, ServiceBusSender } from "@azure/service-bus";

// Cached client to minimise the number of active connections
let client: ServiceBusClient;
// Cached sender to minimise the number of active connections
export const cachedSender = new Map<string, ServiceBusSender>();

export function getServiceBusSender(queueOrTopicName: string) {
  // Service Bus client has to be created here inside the function, as mocking in
  // the tests otherwise does not work.
  if (!client) {
    client = getClient();
  }

  // If the client has already been created, return it
  if (cachedSender.has(queueOrTopicName)) {
    return cachedSender.get(queueOrTopicName);
  }

  const sender = client.createSender(queueOrTopicName);
  cachedSender.set(queueOrTopicName, sender);
  return sender;
}

function getClient() {
  // Use ManagedIdentity for authentication if a clientId is provided
  if (process.env.CompassServiceBusConnection__clientId) {
    return new ServiceBusClient(
      process.env.CompassServiceBusConnection__fullyQualifiedNamespace,
      new ManagedIdentityCredential({
        clientId: process.env.CompassServiceBusConnection__clientId,
      }),
    );
  }

  // If no clientId is provided (i.e. running it locally), then default to DefaultAzureCredential
  return new ServiceBusClient(
    process.env.CompassServiceBusConnection__fullyQualifiedNamespace,
    new DefaultAzureCredential(),
  );
}

export async function closeServiceBusClient() {
  if (client) {
    await client.close();
  }
}
