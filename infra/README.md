# Azure infrastructure

This Bicep deployment creates:

- Resource group `lottery` in Australia East
- Linux App Service plan `lottery-maishid-20261002-plan` on the Free F1 SKU
- Linux App Service `lottery-maishid-20261002` using Node.js 22 LTS

The App Service name must be globally unique across Azure. If `lottery` is already
in use, this deployment uses the available name `lottery-maishid-20261002`.

## Validate

```powershell
az bicep build --file .\infra\main.bicep
```

## Deploy

Select the intended Azure subscription before deployment, then run:

```powershell
az account set --subscription "<subscription-id>"
az deployment sub create `
  --name lottery-infra `
  --location australiaeast `
  --template-file .\infra\main.bicep `
  --parameters .\infra\main.bicepparam

.\infra\package.ps1
az webapp deploy `
  --resource-group lottery `
  --name lottery-maishid-20261002 `
  --src-path .\infra\lottery-site.zip `
  --type zip
```

The packaging script adds `admin/index.html` and a dependency-free Node.js static
server so that the existing `/` and `/admin` routes resolve correctly.
