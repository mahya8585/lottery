# Azure デプロイ計画

## ステータス

デプロイ済み（Deployed）

## 1. デプロイ概要

- 作業区分: 既存ワークスペースの変更およびデプロイ
- 対象範囲: Azure インフラストラクチャーを構築し、取得済みのフロントエンドのみをデプロイする
- 制約: `/api/draw` および `/api/admin/*` は本リポジトリに含まれないため動作しない
- デプロイ方式: スタンドアロン Bicep と Azure CLI による ZIP デプロイ

## 2. Azure コンテキスト

- サブスクリプション: `MCAPS-Hybrid-REQ-73654-2024-maishid`
- サブスクリプション ID: `70bcc220-4d88-48f2-a59a-77bae4785eac`
- テナント ID: `16b3c013-d300-468d-ac64-7eda0820b6d3`
- リージョン: `australiaeast`
- リソースグループ: `lottery`
- App Service 名: `lottery-maishid-20261002`
- 当初指定された App Service 名 `lottery` は Azure 全体ですでに使用されている

## 3. アプリケーション分析

- デプロイ対象: `site/index.html`、`site/admin.html`、`site/script.js`、`site/styles.css`
- ホスティング方式: Linux App Service 上の依存パッケージ不要な Node.js 静的サーバー
- ランタイム: Node.js 22 LTS
- バックエンド API: リポジトリに存在しない。ユーザー承認によりフロントエンドのみをデプロイする

## 4. Azure アーキテクチャー

| リソース | 名前 | 構成 |
|---|---|---|
| リソースグループ | `lottery` | Australia East |
| App Service プラン | `lottery-maishid-20261002-plan` | Linux、Free F1 |
| App Service | `lottery-maishid-20261002` | Linux、Node.js 22 LTS |

プロビジョニング事前確認:

- Australia East は `Microsoft.Web/serverfarms` と `Microsoft.Web/sites` をサポートしている
- Japan East では F1 と B1 の上限がともに 0 だったため、ユーザー指示により Australia East の F1 へ変更した
- App Service 名 `lottery-maishid-20261002` は現時点で利用可能である

## 5. ワークスペースの変更予定

1. `infra/main.bicepparam` の App Service 名を利用可能な名前へ変更する。
2. PM2 で静的コンテンツを配信する App Service 起動コマンドを設定する。
3. Bicep テンプレートとパラメーターファイルをビルドおよび検証する。
4. `site/` の内容だけを ZIP デプロイ用にパッケージ化する。
   - `/admin` を静的配信できるよう、パッケージ内に `admin/index.html` を生成する。

## 6. セキュリティおよび運用設定

- HTTPS を必須にする。
- Web サイトと SCM エンドポイントで TLS 1.2 以上を必須にする。
- FTPS を無効にする。
- FTP および SCM の基本認証を無効にする。
- HTTP/2 を有効にする。
- 公開イベントサイトのため、パブリックネットワークアクセスを有効にする。
- シークレットや管理者認証情報はデプロイしない。
- 元サイトの状態変更 API は呼び出さない。

## 7. デプロイ手順

1. Bicep のビルドとサブスクリプションスコープの検証を実行する。
2. サブスクリプションスコープで what-if デプロイを実行する。
3. Bicep でリソースグループ、F1 プラン、App Service を作成する。
4. `index.html` がアーカイブ直下に配置されるようフロントエンドを ZIP 化する。
5. ZIP パッケージを App Service にデプロイする。
6. プロビジョニング状態、ランタイム設定、HTTPS エンドポイントの応答を確認する。
7. デプロイ済みの HTML、JavaScript、CSS にアクセスできることを確認する。

想定エンドポイント:

`https://lottery-maishid-20261002.azurewebsites.net`

## 8. ロールバック

- コードのロールバック: 以前の ZIP パッケージを再デプロイする。
- インフラストラクチャーのロールバック: 自動削除は行わない。リソース削除には別途明示的な承認が必要。

## 9. 検証証跡（Validation Proof）

Azure 検証ワークフローによる実行待ち。

検証チェックリスト:

- [x] All validation checks pass
  - [x] Azure CLI の認証、Bicep ビルド、ARM 検証、what-if を実行する。
  - [x] Bicep リンターを実行する。
  - [x] Azure Policy の割り当てと競合を確認する。
  - [x] Bicep 内のロール割り当てを静的に確認する。

準備段階の確認:

- 2026-10-02: ユーザーが日本語版デプロイ計画を承認。
- 2026-10-02: `az bicep build --file .\infra\main.bicep --stdout` が成功。
- 2026-10-02: `az bicep build-params --file .\infra\main.bicepparam --stdout` が成功。
- 2026-10-02: デプロイ対象の HTML、JavaScript、CSS がすべて存在することを確認。

検証結果:

- 2026-10-02: Azure CLI 認証に成功。
- 2026-10-02: Bicep コンパイルに成功。
- 2026-10-02: ARM 事前検証に失敗。対象サブスクリプションの F1 VM 上限は `0`、必要数は `1`。
- 2026-10-02: 同じクォータ不足により what-if に失敗。
- 2026-10-02: ユーザー承認により App Service プランを有料の Basic B1 へ変更。
- 2026-10-02: B1 で再検証したが、B1 VM 上限も `0`、必要数は `1` のため ARM 検証と what-if が失敗。
- 2026-10-02: ユーザー指示により Australia East の F1 へ変更。
- 2026-10-02: Australia East の F1 で Azure CLI 認証、Bicep ビルド、ARM 事前検証に成功。
- 2026-10-02: what-if に成功。作成6件、変更0件、削除0件。
- 2026-10-02: Bicep リンターにエラーなし。
- 2026-10-02: Azure Policy 19件を確認。App Service の FTP/SCM 基本認証無効化ポリシーに合わせて Bicep を更新し、再検証に成功。
- 2026-10-02: マネージド ID、外部データサービス、ロール割り当てを使用しない構成のため、追加 RBAC は不要と確認。
- 2026-10-02: `.\infra\package.ps1` で ZIP パッケージを作成し、`index.html`、`admin.html`、`admin/index.html`、`script.js`、`styles.css` の存在を検証。

実行コマンド:

```powershell
& "$env:USERPROFILE\.agents\skills\azure-validate\references\recipes\scripts\validate-deployment.ps1" `
  -Scope sub `
  -Location australiaeast `
  -Template .\infra\main.bicep `
  -Parameters .\infra\main.bicepparam `
  -Subscription 70bcc220-4d88-48f2-a59a-77bae4785eac

az bicep lint --file .\infra\main.bicep
.\infra\package.ps1
```

最終結果:

- Core Validation: `OVERALL: PASS`
- ARM 事前検証: 成功
- what-if: 作成6件、変更0件、削除0件
- Bicep lint: エラーなし
- パッケージビルド: 成功
- Azure Policy: 確認・対応済み
- RBAC 静的確認: 追加ロール不要

## 10. デプロイ結果

- 実行日: 2026-10-02
- サブスクリプションデプロイ: `lottery-infra-20261002`
- インフラストラクチャー状態: `Succeeded`
- コードデプロイ: OneDeploy、ステータス `4`、完了済み
- App Service 状態: `Running`
- 公開 URL: `https://lottery-maishid-20261002.azurewebsites.net`
- リージョン: Australia East
- App Service プラン: Free F1

HTTPS 動作確認:

| URL | HTTP 状態 | Content-Type |
|---|---:|---|
| `/` | 200 | `text/html; charset=utf-8` |
| `/admin` | 200 | `text/html; charset=utf-8` |
| `/script.js` | 200 | `application/javascript; charset=utf-8` |
| `/styles.css` | 200 | `text/css; charset=utf-8` |

構成確認:

- HTTPS 強制: 有効
- Node.js: 22 LTS
- TLS 最小バージョン: 1.2
- SCM TLS 最小バージョン: 1.2
- FTPS: 無効
- FTP 基本認証: 無効
- SCM 基本認証: 無効
- HTTP/2: 有効

### ライブ RBAC 確認

- 本 App Service はマネージド ID を使用していない。
- 外部データサービスや Azure リソースへのデータプレーンアクセスはない。
- Bicep にロール割り当てはなく、実行時に必要な RBAC もない。
- 結果: 合格。

注意事項:

- 本デプロイにはバックエンド API が含まれないため、抽選および管理 API 操作は動作しない。
- ZIP デプロイ CLI は待機中にタイムアウトを報告したが、その後スタートアッププローブが成功し、OneDeploy の完了ステータスと全公開 URL の HTTP 200 を確認した。
