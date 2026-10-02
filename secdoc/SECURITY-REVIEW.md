# セキュリティチェックリスト

- 対象: `https://raffle-ghms-jp-20260930-02.azurewebsites.net/`
- 確認日: 2026-10-02
- 確認範囲: 公開されている HTML、JavaScript、CSS の静的レビュー
- 制約: 本チェックではライブ環境への攻撃的な操作や、状態変更 API の呼び出しは実施していない

## 確認済みの問題

### [ ] SEC-001 管理者パスワードが URL に含まれる

- 重要度: High
- 信頼度: 10/10
- 該当箇所:
  - [`site/script.js`](../site/script.js#L143)
  - [`site/script.js`](../site/script.js#L159)
  - [`site/script.js`](../site/script.js#L195)
  - [`site/script.js`](../site/script.js#L222)
- 内容:
  - 管理者パスワードを `adminKey` クエリパラメーターとして、統計取得、CSV 出力、リセット、締め切り API に送信している。
  - `encodeURIComponent` は URL エンコードであり、認証情報の秘匿化にはならない。
- 想定される影響:
  - URL がブラウザー履歴、プロキシ、ロードバランサー、Web サーバー、APM、アクセスログなどに記録される可能性がある。
  - CSV 出力 URL は DOM に保持され、管理者パスワードを含む URL が再利用される可能性がある。
  - 漏えいした認証情報により、抽選結果の閲覧・出力、イベントのリセット、抽選の締め切りが行われる可能性がある。
- 推奨対策:
  - パスワードは TLS 上の `POST` リクエストボディで一度だけ送信する。
  - 認証成功後は、短時間で失効するサーバー側セッションを使用する。
  - セッション Cookie に `Secure`、`HttpOnly`、`SameSite=Strict` を設定する。
  - URL、ログ、テレメトリから `adminKey` を除去し、既存ログに記録されている場合はローテーションと削除を検討する。

### [ ] SEC-002 API エラーメッセージによる DOM XSS の可能性

- 重要度: Medium
- 信頼度: 8/10
- 該当箇所:
  - [`site/script.js`](../site/script.js#L30)
  - [`site/script.js`](../site/script.js#L107)
- 内容:
  - `/api/draw` が返した `data.error` をエスケープせず `setResult` に渡している。
  - `setResult` は受け取った文字列を `innerHTML` に代入している。
  - 正常系の賞品名には `escapeHtml` が使用されているが、エラー系には同じ保護がない。
- 想定される影響:
  - API が攻撃者入力をエラー文へ反映する場合、または上流コンポーネントがレスポンスを書き換えられる場合、同一オリジン上で任意の JavaScript が実行される可能性がある。
- 推奨対策:
  - エラーメッセージは `textContent` で表示する。
  - 装飾が必要な場合は、固定した DOM 要素を DOM API で構築し、外部入力を HTML として解釈しない。
  - API のエラー文はサーバー側で固定メッセージにする。
  - 防御層として、`unsafe-inline` を許可しない Content Security Policy をレスポンスヘッダーに設定する。

## バックエンドで追加検証が必要なリスク

### [ ] SEC-003 「1 人 1 回」がサーバー側で強制されていることを確認する

- 潜在的重要度: High
- 信頼度: 7/10
- 該当箇所:
  - [`site/index.html`](../site/index.html#L18)
  - [`site/script.js`](../site/script.js#L87)
  - [`site/script.js`](../site/script.js#L115)
- 懸念:
  - クライアントは `/api/draw` に空の JSON を送信し、抽選後にボタンを無効化しているだけである。
  - ボタンの再有効化、ページの再読み込み、API の直接呼び出しによってクライアント側制限を回避できる。
- 確認項目:
  - [ ] サーバーが信頼できる認証済み ID から参加者を識別している。
  - [ ] 2 回目以降の抽選をサーバー側で拒否している。
  - [ ] 抽選回数の確認と結果保存が競合しないよう、原子的に処理されている。
  - [ ] Cookie、IP アドレス、User-Agent、Local Storage、クライアント指定 ID のみに依存していない。

### [ ] SEC-004 管理 API の認可と CSRF 対策を確認する

- 潜在的重要度: High
- 信頼度: 7/10
- 該当箇所:
  - [`site/script.js`](../site/script.js#L195)
  - [`site/script.js`](../site/script.js#L222)
- 懸念:
  - リセットと締め切りは状態変更操作だが、クライアントから CSRF トークンやオリジンに紐づく証明が送信されていない。
  - 確認ダイアログはクライアント側の UI であり、セキュリティ制御にはならない。
- 確認項目:
  - [ ] すべての管理 API がリクエストごとにサーバー側で認証・認可を行っている。
  - [ ] 状態変更操作を `POST` など適切な HTTP メソッドだけに制限している。
  - [ ] `Origin` または `Referer` を検証している。
  - [ ] Cookie 認証へ変更する場合、SameSite Cookie と推測困難な CSRF トークンを併用している。
  - [ ] `GET` やメソッドオーバーライドによる状態変更を許可していない。

### [ ] SEC-005 CSV Formula Injection 対策を確認する

- 潜在的重要度: Medium
- 信頼度: 7/10
- 該当箇所:
  - [`site/admin.html`](../site/admin.html#L30)
  - [`site/script.js`](../site/script.js#L159)
  - [`site/script.js`](../site/script.js#L165)
- 懸念:
  - 参加者名を外部入力できる場合、`=`、`+`、`-`、`@` で始まる値が表計算ソフトで数式として実行される可能性がある。
  - 管理画面の HTML エスケープは CSV ファイルを保護しない。
- 確認項目:
  - [ ] CSV の区切り文字、引用符、改行を正しくエスケープしている。
  - [ ] 数式として解釈され得る文字で始まるセルを無害化している。
  - [ ] エクスポートのレスポンスに安全な `Content-Type` と `Content-Disposition` を設定している。

## 優先順位

1. SEC-001: URL から管理者認証情報を完全に除去する。
2. SEC-003、SEC-004: 抽選回数制限、管理 API の認証・認可、CSRF 対策をバックエンドで検証する。
3. SEC-002: API エラー表示を `textContent` に変更する。
4. SEC-005: CSV 生成処理の Formula Injection 対策を検証する。
