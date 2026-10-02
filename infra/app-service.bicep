@description('Name of the App Service.')
param appServiceName string

@description('Azure region for the App Service resources.')
param location string

@secure()
@description('Administrator password for the management API.')
param adminKey string

@secure()
@description('Secret used to hash participant codes.')
param codePepper string

var appServicePlanName = '${appServiceName}-plan'

resource appServicePlan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  sku: {
    name: 'F1'
    tier: 'Free'
    size: 'F1'
    family: 'F'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource appService 'Microsoft.Web/sites@2024-11-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    clientAffinityEnabled: false
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'node /home/site/wwwroot/server.js'
      alwaysOn: false
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      http20Enabled: true
      appSettings: [
        {
          name: 'DATA_FILE'
          value: '/home/data/lottery-state.json'
        }
        {
          name: 'ADMIN_KEY'
          value: adminKey
        }
        {
          name: 'CODE_PEPPER'
          value: codePepper
        }
        {
          name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE'
          value: 'true'
        }
      ]
    }
  }
}

resource basicPublishingCredentialsPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-11-01' = {
  parent: appService
  name: 'ftp'
  properties: {
    allow: false
  }
}

resource scmBasicPublishingCredentialsPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-11-01' = {
  parent: appService
  name: 'scm'
  properties: {
    allow: false
  }
}

output appServiceName string = appService.name
output defaultHostName string = appService.properties.defaultHostName
