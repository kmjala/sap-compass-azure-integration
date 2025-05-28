param location string = resourceGroup().location
param sapServiceBus string
param sapBaseUrl string
@secure()
param sapApiKey string
param sapApiProdOrderConf2Delay int

output functionAppName string = functionApp.outputs.functionAppName
output functionAppPrincipalId string = managedIdentity.properties.principalId

module storageAccount 'bicep/storage-account.bicep' = {
  name: 'storage-account'
  params: {
    location: location
    functionAppIdentityName: managedIdentity.name
  }
}

@description('Identity for the Function App')
resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'mi-fa-${uniqueString(resourceGroup().id)}'
  location: location
  tags: resourceGroup().tags
}

module serviceBus 'bicep/service-bus.bicep' = {
  name: 'service-bus'
  params: {
    location: location
    functionAppIdentityName: managedIdentity.name
  }
}

module logAnalytics 'bicep/log-analytics.bicep' = {
  name: 'log-analytics'
  params: {
    location: location
  }
}

module functionApp 'bicep/function-app.bicep' = {
  name: 'function-app'
  params: {
    applicationInsightsName: logAnalytics.outputs.applicationInsights
    // Deploying to westus3, as this is the only supported region for the
    // Flex Consumption plan allowed by the GPS Azure policy
    location: 'westus3'
    managedIdentityName: managedIdentity.name
    sapApiKey: sapApiKey
    sapBaseUrl: sapBaseUrl
    sapServiceBus: sapServiceBus
    serviceBusName: serviceBus.outputs.namespace
    storageAccountName: storageAccount.outputs.name
    sapApiProdOrderConf2Delay: sapApiProdOrderConf2Delay
  }
}
