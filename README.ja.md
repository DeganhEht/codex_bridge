# Codex Bridge

<p align="center"><a href="README.md">简体中文</a> | <a href="README.en.md">English</a> | <b>日本語</b></p>

Codex デスクトップアプリで、同じタスクを GPT と DeepSeek で交互に続けられます。1 つの
タスクは `[GPT]` と `[DeepSeek]` の 2 つの端点を持ち、追加された内容だけを同期するので、
タスクが増え続けることはありません。

> Windows 10/11 のみ対応です。このページはクイックスタートです。手順を 1 つずつ確認
> したい場合は [docs/install.md](docs/install.md)（中国語）を参照してください。

## 出典と謝辞

本プロジェクトは [kaidongli30-cpu/Codex-Deepseek-Handoff](https://github.com/kaidongli30-cpu/Codex-Deepseek-Handoff)
（MIT License, Copyright (c) 2026 kaidongli30-cpu）を大幅に改造した派生版です。上流は
「GPT のタスクを DeepSeek に引き継ぐ」ための基礎とインストーラーを提供しています。
本リポジトリは引き継ぎを **固定ペア端点の差分同期** に作り替え、デスクトップでの
使い勝手とトラブルシュートを追加しました（詳細は [CHANGELOG.md](CHANGELOG.md)）。
上流の MIT ライセンスと著作権表示は [LICENSE](LICENSE) にそのまま保持しています。

サードパーティ資産について: DeepSeek の公式モデルカタログと公式 Codex セットアップ
スクリプトはユーザーの環境に置いたままとし、本リポジトリはそれらを再配布しません。
DeepSeek のブランドアイコンも再配布しません。インストーラーは、すでに完了している
公式セットアップを再利用するだけです。

本プロジェクトは 2 つの公式コンポーネントの上に成り立っています: **Codex デスクトップ
アプリ**（付属の `app-server` 経由でタスクを実行）と **DeepSeek 公式 API**。本プロジェクトは
サードパーティ製のツールであり、OpenAI および DeepSeek 公式との提携や推奨関係はありません。
これらの名称は各権利者に帰属します。

メンテナ: 本リポジトリの改造と保守は `DeganhEht` が行っています。

## このプロジェクトが解決する問題

DeepSeek 公式の連携で Codex から DeepSeek を使えますが、設定を切り替えると次のような
問題がよく起きます:

- GPT モードで見えていたタスクが DeepSeek モードで表示されない
- DeepSeek の新しい返信を GPT に戻してから続きができない
- DeepSeek の推論記録や Web 検索記録が原因で GPT がフォーマットエラーを報告する

Codex Bridge はその間にローカルの「引き継ぎ」層を追加します。デスクトップの
ショートカットをクリックしてタスクを選んだ瞬間に、追加分を反対側へ同期し、目的の
モードで Codex を開きます。

```text
GPT で作業 → Codex を完全に閉じる → 「交接给deepseek」をダブルクリック → タスクを選択 → DeepSeek で続行
DeepSeek で作業 → Codex を完全に閉じる → 「交接给GPT」をダブルクリック → タスクを選択 → GPT で続行
```

## 始める前に知っておくべき 3 つのこと

1. **本プロジェクトは Codex ではなく、DeepSeek API key も提供しません。** 先に Codex
   をインストールし、自分自身の公式 DeepSeek API key を用意してください。
2. **切り替える前に必ず Codex を完全に閉じてください。** GPT モードと DeepSeek モードを
   同時に動かさないでください。
3. **引き継ぎ 1 回につきショートカットは 1 回だけクリックします。** 記録が多いと時間が
   かかります。ツールが完了してから Codex が開きます。

## Codex にインストールしてもらう（推奨）

コマンドを自分で打つ必要はありません。下のブロックを丸ごと Codex（PC を操作できる
Codex セッション）に貼り付けてください。リポジトリを読んで順番に導入し、あなたの操作が
必要な場面では手を止めて確認します。

````text
この PC に Codex Bridge をインストールしてください: https://github.com/DeganhEht/codex_bridge

要件:
1. 先にリポジトリ内の README.md と docs/install.md を読み、記憶から手順を推測しないこと。
2. 順番に実行し、各手順の前に「これから何をするか」を 1 文で説明すること。
3. 私の操作が必要な手順（PowerShell 7 / Node.js の導入、DeepSeek 公式スクリプトの実行と
   API key の入力、Codex を完全に閉じる）では、いったん止めて私の確認を待つこと。
4. インストーラーは必ず -WhatIf でプレビューし、問題がなければ本実行すること。プレビューを
   省略しないこと。
5. 完了したらデスクトップに「交接给deepseek」と「交接给GPT」があることを確認し、検証用の
   タスクで一往復テストすること（GPT で発言 → 引き継ぎ → DeepSeek で確認と返信 → GPT へ戻す）。
6. どこかで失敗したら、エラー全文をそのまま私に見せること。勝手に読み飛ばしたり別の方法に
   変えたりしないこと。

まず実行計画を教えてください。私が「開始」と返すまで実行しないでください。
````

後で最新版へ更新する場合（`config.toml` は変更しません）:

````text
https://github.com/DeganhEht/codex_bridge を最新版に更新してください: プロジェクトのフォルダーで
git pull を実行し、次に work/thread-localizer/launcher/install.ps1 -SourceRoot <プロジェクトの
フォルダー> -SkipConfiguration -SkipShortcuts を実行してください。config.toml は変更せず、
デスクトップのショートカットも作り直さないでください。
````

引き継ぎに失敗したときは、ログを Codex に読ませてください:

````text
Codex Bridge での引き継ぎに失敗しました。%USERPROFILE%\.codex\model-switcher\handoff-logs\ と
%USERPROFILE%\.codex\model-switcher\thread-localizer\reports\ の最新のログとレポートを読んで、
失敗の原因と最小の修正手順を教えてください。まだファイルは変更しないでください。
````

日常の引き継ぎにプロンプトは不要です。次の 2 つのショートカットだけで完結します。

## 手動インストール（簡易版）

前提: Windows 10/11、[PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/install-powershell-on-windows)、
[Node.js 22.13 以上](https://nodejs.org/en/download)、サインイン済みの Codex デスクトップ版、
自分自身の公式 DeepSeek API key。

1. 先に **DeepSeek 公式のセットアップ**を完了します（本リポジトリは公式ファイルを再配布
   しません）:

   ```powershell
   $officialSetup = Join-Path $env:TEMP 'codex-deepseek-setup-en.ps1'
   Invoke-WebRequest -Uri 'https://cdn.deepseek.com/api-docs/codex-deepseek-setup-en.ps1' -OutFile $officialSetup
   notepad $officialSetup
   pwsh -NoProfile -ExecutionPolicy Bypass -File $officialSetup
   ```

   DeepSeek 公式の方法でテストメッセージに返信できることを確認し、Codex を完全に閉じます。

2. 本プロジェクトを取得し、ルートフォルダーで PowerShell 7 を開きます:

   ```powershell
   git clone https://github.com/DeganhEht/codex_bridge.git
   cd codex_bridge
   pwsh
   ```

   リポジトリのページで `Code` → `Download ZIP` を使い、展開したフォルダーのアドレスバーに
   `pwsh` と入力してもかまいません。

3. プレビューしてからインストールします:

   ```powershell
   pwsh -NoProfile -ExecutionPolicy Bypass -File ".\work\thread-localizer\launcher\install.ps1" -SourceRoot "$PWD" -WhatIf
   pwsh -NoProfile -ExecutionPolicy Bypass -File ".\work\thread-localizer\launcher\install.ps1" -SourceRoot "$PWD"
   ```

4. デスクトップに `交接给deepseek` と `交接给GPT` が現れれば完了です。最初は重要でない
   タスクで一往復試してください。

## 日常的な使い方

どちらのショートカットも「目的のモード」を意味し、**引き継ぎせずに開くだけ**もできます:

| 現在のモード | クリック | 動作 |
| --- | --- | --- |
| GPT | `交接给deepseek` | GPT 側のタスク一覧を表示し、選択したものを引き継いで DeepSeek モードで Codex を開く |
| DeepSeek | `交接给deepseek` | 「Codex を開くだけ」を選ぶと、アダプターを起動して前回のタスクを開く |
| DeepSeek | `交接给GPT` | DeepSeek 側の全タスク（DeepSeek モードで新しく作った会話を含む）を一覧し、同期して GPT モードで開く |
| GPT | `交接给GPT` | 同上。取り残した DeepSeek 側の会話を戻すのに使う。開くだけも可能 |

- 複数のタスクを選ぶと、それぞれ一度ずつ開かれるのでサイドバーに並びます。実際に
  引き継いだタスクが最後に前面へ来ます。2 件以上のときは集計ダイアログ（`codex://threads/...`
  リンク付き）が出て、同じ内容が
  `%USERPROFILE%\.codex\model-switcher\handoff-logs\last-handoff.json` に記録されます。
- DeepSeek を使った直後にタスクバーの公式 Codex アイコンから起動しないでください。引き継ぎを
  迂回するため、最新の DeepSeek の内容が GPT 側にまだ無い可能性があります。
- **終了はいつでも安全です。** DeepSeek モードの Codex を閉じても設定は書き換わらず、自動で
  GPT に戻ることも、ウィンドウが開くこともありません（ローカルアダプターが止まるだけ）。
  再開するときはショートカットから「Codex を開くだけ」を選び、モードを変えたいときはタスクを
  選べば差分が補われます。
- **Codex のアイコンから直接起動しても使えます:** インストーラーは
  `CodexDeepSeekAdapterGuard` というタスクスケジューラのタスクを登録します（ログオン時と
  1 分ごと）。「設定が DeepSeek モード + Codex が実行中 + ポートに誰もいない」ときだけ
  アダプターを起動するので、ショートカットを使わなくても無応答になりません。
  `config.toml` は変更せず、ショートカットの作成/削除も、プロセスの終了も行いません。
  反映は最大 1 分程度です（すぐ戻したいときは `交接给deepseek` →「Codex を開くだけ」）。
  このタスクは `wscript` 経由の非表示ウィンドウで動くため PowerShell のウィンドウは
  一切表示されず、Codex が終了していればインタープリターすら起動しません。使用する
  インタープリターのパスは `%USERPROFILE%\.codex\model-switcher\pwsh-path.txt` に記録し、
  見つからない場合は `handoff-logs\adapter-guard.log` に書き残します。

### タスク名のマーキングと並び順

引き継ぎ後、同じ作業の 2 つのタスクは `[GPT] 元の名前` と `[DeepSeek] 元の名前` に
変わります:

- 接頭辞は 1 回だけ付き、繰り返しても増えません。自分で変更した名前は保持されます。
- マーキングに失敗しても引き継ぎは中断されず、レポートに記録され次回に補われます。
- 選択画面は既定で「最近更新」の降順です。「時間 / Provider·モデル / タスク / 作業
  ディレクトリ」の見出しをクリックすると昇順・降順が切り替わり、検索・複数選択・全選択も
  そのまま使えます。

## よくある質問

### 1. インストーラーが `models-deepseek.json` が見つからないと表示する

DeepSeek 公式の接続が未完了か、公式モデルカタログが想定の場所にありません。公式スクリプト
を再実行し、DeepSeek 単体で Codex を開いて返信できることを確認し、Codex を完全に閉じてから
本インストーラーを実行してください。空の `models-deepseek.json` を自作しないでください。

### 2. ショートカットをクリックしても長時間ウィンドウが表示されない

連続クリックはせず、引き継ぎの完了を待ってください。エラーダイアログが出た場合は、全文・
レポートのパス・どちら向きの切り替えだったかを控えてください。詳しい調査は
[docs/troubleshooting.md](docs/troubleshooting.md) を参照してください。

### 3. 引き継いだタスクがサイドバーに表示されない

デスクトップのサイドバーは `preview` が空のタスクを飛ばしますが、作成直後の端点はまだ
1 ターンも実行していません。本バージョンは引き継ぎ時に元タスクの最初のユーザーメッセージを
補完し、書き込み前に `state_5.sqlite` をバックアップします（検証に失敗したら復元します）。
それでも見えない場合は、同じショートカットをもう一度クリックしてそのタスクを選んでください。

### 4. DeepSeek で `input: missing field call_id` エラーになる

旧バージョンは `call_id` の無いツール結果項目をそのまま注入していたため、DeepSeek が
リクエスト全体を拒否していました。本バージョンはそのような項目を書き込まず、さらに
ローカルアダプターで DeepSeek 宛のリクエストから除外します（ローカルの履歴は変更しません）。
除外ログは `%USERPROFILE%\.codex\model-switcher\handoff-logs\adapter-compat-<タイムスタンプ>.txt`
に出力されます。

### 5. DeepSeek モードでネットワーク切断が繰り返し表示される

同じ症状に見える原因が 2 つあります。

- **応答者がいない（最も多い）**: DeepSeek モードのリクエストはすべてローカルの
  アダプター `127.0.0.1:10101` に送られます。動いていないとすべてローカルで失敗します。
  `交接给deepseek` →「Codex を開くだけ」で確実に起動できます。ヘルスチェックには
  `pid` と `lifetime`（`codexRunning` で Codex を認識しているか分かります）が出ます。
  ランチャーのウィンドウを閉じてもアダプターは終了しなくなり、Codex 終了から 30 秒後に
  自分で片付けます。DeepSeek への切り替えに失敗してロールバックした場合も再起動されます。
- **外向き通信が遮断されている**: アダプターは `HTTPS_PROXY` / `HTTP_PROXY` /
  `NO_PROXY` を読み、443 への直結が失敗するときはローカルプロキシ（例:
  `http://127.0.0.1:7892`）を経由します。`proxyConfigured` / `proxyRequests` で確認でき、
  エラーは `adapter-compat-<タイムスタンプ>.txt` に記録されます。

DeepSeek モードへは必ず `交接给deepseek` から入ってください（アダプターを起動するのは
このショートカットです）。

その他（フォーマットエラー、Web 検索記録の競合、画像の扱い、古いタスクの重複、プロトコル
キャッシュなど）は [docs/troubleshooting.md](docs/troubleshooting.md) を参照してください。

## アンインストール方法

Codex を完全に閉じてから、プレビューと本実行を行います:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\model-switcher\uninstall.ps1" -WhatIf
pwsh -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\model-switcher\uninstall.ps1"
```

既定のアンインストールでは、本プロジェクトが導入した管理対象の設定・2 つのショートカット・
プログラムファイルだけを削除します。DeepSeek 公式のモデルカタログ、暗号化保存された
API key、引き継ぎ manifest とレポートは残ります。

## 既定の設定

- DeepSeek の思考強度は `max`、Web 検索は `live`。
- OpenAI/GPT は、そのタスクが以前使っていたモデルをできるだけ維持します。
- 引き継ぎツールはタスクごとに最後の DeepSeek モデルと思考強度を記憶し、GPT から戻す
  ときに優先して復元します。DeepSeek を一度も使っていないタスクだけ既定値になります。
- 通常の利用で `config.toml` を手で編集する必要はありません。

## プライバシーと安全

本プロジェクトはあなたの PC 上で Codex 自身の `app-server` を呼び出すだけです。中継
サーバーは運用せず、会話履歴をアップロードせず、API key をリポジトリに書き込まず、
`state_5.sqlite` や元の rollout を直接変更しません。変更前には dry-run レポートを生成し、
現在の Codex プロトコルに対応できない場合は推測せず停止します。詳細は
[docs/safety.md](docs/safety.md) を参照してください。

## 開発者向け

```powershell
npm test
pwsh -NoProfile -File ".\scripts\check-powershell.ps1"
pwsh -NoProfile -File ".\scripts\test-picker-sorting.ps1"
pwsh -NoProfile -File ".\scripts\test-sidebar-sync.ps1"
pwsh -NoProfile -File ".\scripts\test-handoff-result-contract.ps1"

npm run schema-check          # app-server プロトコルの確認/キャッシュのみ
npm run dry-run:deepseek      # レポート生成のみ
npm run dry-run:openai
```

既定のモデル設定は
[work/thread-localizer/data/handoff-settings.json](work/thread-localizer/data/handoff-settings.json)
にあります。DeepSeek のモデル slug はローカルの公式 `models-deepseek.json` に存在する必要が
あります。一部の Desktop はサードパーティのモデル名を除外するため、ランチャーは DeepSeek
モードでのみ `127.0.0.1` にバインドしたモデル名アダプターを起動します（互換名を公式 slug に
戻し、`call_id` の無い無主ツール結果を除外します）。GPT のリクエストは経由しません。

関連ドキュメント: [docs/architecture.md](docs/architecture.md)、
[docs/compatibility.md](docs/compatibility.md)、
[docs/troubleshooting.md](docs/troubleshooting.md)、[docs/safety.md](docs/safety.md)、
[work/thread-localizer/README.md](work/thread-localizer/README.md)。

## ライセンス

[MIT License](LICENSE) です。DeepSeek の公式モデルカタログとブランドアイコンは本リポジトリ
では再配布しません。個人のアイコン、API key、Codex のデータベース、タスクレポート、会話
履歴を公開リポジトリへコミットしないでください。
