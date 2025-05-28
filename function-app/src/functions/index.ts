import { app } from "@azure/functions";
import { initialiseConversionTable } from "../conversions/conversion-table";

/**
 * This file contains Function App lifecycle hooks and/or registers Functions
 * that do not tied to a specific SAP-MES integration.
 */

import * as appInsights from "applicationinsights";
import { closeServiceBusClient } from "../service-bus-client";

// configure Application Insights
appInsights
  .setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
  .setAutoCollectRequests(true)
  .setAutoCollectPerformance(true, false)
  .setAutoCollectExceptions(true)
  .setAutoCollectDependencies(true)
  .setAutoCollectConsole(true, false)
  .setAutoCollectPreAggregatedMetrics(true)
  .setSendLiveMetrics(true)
  .setInternalLogging(false, true)
  .enableWebInstrumentation(false)
  .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
  .start();

// Initialise the conversion table once at the start of the Function App
app.hook.appStart(initialiseConversionTable);

app.hook.appTerminate(closeServiceBusClient);
