targetScope = 'subscription'

@description('Azure region for all resources.')
param location string = 'australiaeast'

@description('Name of the resource group.')
param resourceGroupName string = 'lottery'

@description('Globally unique name of the App Service.')
param appServiceName string = 'lottery-maishid-20261002'

@secure()
@description('Administrator password for the management API.')
param adminKey string = ''

@secure()
@description('Secret used to hash participant codes.')
param codePepper string = ''

resource resourceGroup 'Microsoft.Resources/resourceGroups@2025-04-01' = {
  name: resourceGroupName
  location: location
}

module appService 'app-service.bicep' = {
  name: 'app-service'
  scope: resourceGroup
  params: {
    appServiceName: appServiceName
    adminKey: adminKey
    codePepper: codePepper
    location: location
  }
}

output resourceGroupName string = resourceGroup.name
output appServiceName string = appService.outputs.appServiceName
output appServiceDefaultHostName string = appService.outputs.defaultHostName
