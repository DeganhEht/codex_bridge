# Codex-DeepSeek-Handoff

<p align="center"><a href="README.md">简体中文</a> | <a href="README.en.md">English</a> | <b>日本語</b></p>

Codex デスクトップアプリで、GPT と DeepSeek が同じタスクを続けて使えるようにするローカルツールです。

> このツールは現在 Windows のみ対応しています。コマンドラインを使うのが初めてでも大丈夫です。
> このガイドは「プロジェクトのダウンロード方法」から順番に説明します。

## 出典と謝辞

本プロジェクトは [kaidongli30-cpu/Codex-Deepseek-Handoff](https://github.com/kaidongli30-cpu/Codex-Deepseek-Handoff)
（MIT License, Copyright (c) 2026 kaidongli30-cpu）を大幅に改造した派生版です。
上流は「GPT のタスクを DeepSeek に引き継ぐ」ための基礎とインストーラーを提供して
います。本リポジトリは引き継ぎを **固定ペア端点の差分同期** に作り替え、デスクトップ
での使い勝手とトラブルシュートを追加しました（詳細は [CHANGELOG.md](CHANGELOG.md)）。
上流の MIT ライセンスと著作権表示は [LICENSE](LICENSE) にそのまま保持しています。

サードパーティ資産について: DeepSeek の公式モデルカタログと公式 Codex セットアップ
スクリプトはユーザーの環境に置いたままとし、本リポジトリはそれらを再配布しません。
DeepSeek のブランドアイコンも再配布しません。インストーラーは、すでに完了している
公式セットアップを再利用するだけです。これらの権利は DeepSeek に帰属します。

メンテナ: 本リポジトリの改造と保守は `DeganhEht` が行っています。
元のプロジェクトと設計は上記の上流リポジトリによるものです。

## このプロジェクトが解決する問題

DeepSeek 公式の連携で Codex で DeepSeek を使えるようになりますが、設定を切り替えると次のような問題がよく起きます:

- GPT モードで見えていたタスクが DeepSeek モードで表示されない
- DeepSeek の新しい返信を GPT に戻してから続きができない
- DeepSeek の推論記録や Web 検索記録が原因で GPT がフォーマットエラーを報告する

このプロジェクトは GPT と DeepSeek の間にローカルの「引き継ぎ（ハンドオフ）」層を追加します。流れは次のとおりです:

```text
GPT で作業する
    ↓
Codex を完全に閉じる
    ↓
デスクトップの「交接给deepseek」をクリック
    ↓
タスクを引き継いでから、DeepSeek モードの Codex を開く
    ↓
DeepSeek で元のタスクを続ける
    ↓
Codex を完全に閉じる
    ↓
デスクトップの「交接给GPT」をクリック
    ↓
整理と引き継ぎを行ってから、GPT モードの Codex を開く
```

両側は同じ作業のリレー版を見ることになります。DeepSeek の返信は GPT に戻せますし、GPT の新しい返信も DeepSeek に引き継げます。

## 始める前に知っておくべき3つのこと

1. **このプロジェクトは Codex ではありませんし、DeepSeek API key を提供するものでもありません。** Codex のインストールと、自分自身の DeepSeek 公式 API key が必要です。
2. **切り替える前に Codex を完全に閉じてください。** GPT モードと DeepSeek モードを同時に実行しないでください。
3. **引き継ぎ中はショートカットを1回だけクリックしてください。** 履歴が多いと時間がかかることがあります。引き継ぎが完了してから Codex が開きます。

## インストール前の準備

### 1. Windows を使っていることを確認する

対応:

- Windows 10
- Windows 11

macOS と Linux は現在このプロジェクトで検証していません。

### 2. Codex が正常に開けることを確認する

いつもの方法で Codex を開き、ChatGPT/OpenAI にログインできて、既存タスクを開けることを確認します。確認したら Codex を完全に閉じます。

Codex がまだインストールされていない場合は、[OpenAI 公式ページ](https://developers.openai.com/) からインストールとログインを済ませてから戻ってきてください。

### 3. PowerShell 7 をインストールする

PowerShell は、以下のインストールコマンドを貼り付けて実行するためのウィンドウです。Windows 標準の古いものは「Windows PowerShell」と呼ばれます。このプロジェクトでは **PowerShell 7** を推奨します。

Windows のスタートメニューから `PowerShell 7` を検索して開きます。ウィンドウに次のコマンドをコピーして Enter を押します:

```powershell
$PSVersionTable.PSVersion
```

最初の行のメジャーバージョンが `7` ならこの条件は満たされています。

PowerShell 7 が見つからない場合は、Microsoft 公式の手順に従ってください:

- [Microsoft: Windows への PowerShell 7 のインストール](https://learn.microsoft.com/powershell/scripting/install/install-powershell-on-windows)

Windows 11 ではターミナルで次のコマンドも実行できます:

```powershell
winget install --id Microsoft.PowerShell --source winget
```

インストール後、古いウィンドウを閉じて `PowerShell 7` を開き直します。

### 4. Node.js をインストールする

PowerShell 7 で実行:

```powershell
node --version
```

このプロジェクトには **Node.js 22.13.0 以降**が必要です。現在の Node.js 24 LTS を推奨します。
`v22.13.0`、それより新しい `v22...`、または `v24...` は利用できますが、
`v20...` 以前はサポートされません。

バージョンが古い場合、または `node` が認識されない場合は、Node.js 公式サイトから
現在の **LTS（長期サポート版）** をダウンロードします:

- [Node.js 公式ダウンロードページ](https://nodejs.org/en/download)

インストールは既定のオプションのままで構いません。インストール後、PowerShell 7 を開き直して `node --version` を再度実行します。

### 5. DeepSeek API key を準備する

自分自身の DeepSeek 公式 API key が必要です。API key を人に教えたり、このプロジェクトのファイルに書き込んだり、GitHub にコミットしたりしないでください。DeepSeek 公式ドキュメント:

- [DeepSeek API 公式ドキュメント](https://api-docs.deepseek.com/api/deepseek-api/)

すでに DeepSeek 公式の方法で Codex を開ける場合は、次のセクションに進んでください。

## このプロジェクトをダウンロードする

### 方法 A: ZIP をダウンロード（初心者向け）

1. 本リポジトリのページ <https://github.com/DeganhEht/codex_bridge> を開く
2. 上部の緑色の `Code` ボタンをクリック
3. `Download ZIP` をクリック
4. ダウンロード後、エクスプローラーで ZIP ファイルを探す
5. ZIP を右クリックして「すべて展開」を選ぶ
6. 展開されたフォルダーを開く

次のものが一度にすべて見えるまでフォルダーを開いて進めてください:

```text
README.md
package.json
work フォルダー
scripts フォルダー
```

これらが見えたら、正しい「プロジェクトのルート」にいます。

### 正しいフォルダーで PowerShell 7 を開く

1. プロジェクトルートのウィンドウを開いたままにする
2. エクスプローラー上部のアドレスバーをクリック
3. アドレスバーの既存テキストを削除
4. `pwsh` と入力
5. Enter を押す

PowerShell 7 が正しいプロジェクトフォルダーで開きます。

次のコマンドで確認:

```powershell
Test-Path ".\work\thread-localizer\launcher\install.ps1"
```

出力:

```text
True
```

これなら場所は正しいです。`False` と表示されたら、PowerShell を閉じて、`README.md`、`package.json`、`work` が本当に入っているフォルダーまでエクスプローラーで進み、再度 `pwsh` と入力してください。

## 初回インストール

### 手順 1: まず DeepSeek 公式の設定を完了する

このプロジェクトは DeepSeek 公式モデルカタログを再配布しないため、先に DeepSeek 公式の Codex 設定スクリプトを実行する必要があります。

先ほど開いた PowerShell 7 で、次のブロックをまとめてコピーして Enter を押します:

```powershell
$officialSetup = Join-Path $env:TEMP 'codex-deepseek-setup-en.ps1'
Invoke-WebRequest `
  -Uri 'https://cdn.deepseek.com/api-docs/codex-deepseek-setup-en.ps1' `
  -OutFile $officialSetup
notepad $officialSetup
```

メモ帳でダウンロードした公式スクリプトが開きます。ダウンロード元が `cdn.deepseek.com` であることを確認し、メモ帳を閉じて、PowerShell 7 で実行:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File $officialSetup
```

公式スクリプトの案内に従って DeepSeek API key を設定します。

完了後:

1. PowerShell と Codex を完全に閉じる
2. DeepSeek 公式スクリプトが作成した方法で Codex を一度開く
3. DeepSeek がテストメッセージに正常に返信することを確認
4. もう一度 Codex を完全に閉じる

DeepSeek 自体がまだ正常に返信できない場合は、このプロジェクトをインストールしないでください。公式の基本設定が成功して初めて、引き継ぎ層が正常に動作します。

### 手順 2: インストーラーが行う操作をプレビューする

プロジェクトルートに戻り、前述の方法でアドレスバーに `pwsh` と入力して PowerShell 7 を開きます。

次のブロックをコピーして Enter:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File ".\work\thread-localizer\launcher\install.ps1" `
  -SourceRoot "$PWD" `
  -WhatIf
```

`-WhatIf` は「プレビューのみで、実際には変更しない」という意味です。`What if:` の行が複数表示され、最後に次のように表示されます:

```text
"whatIf": true
```

この手順ではタスクを移行せず、Codex を起動せず、モデルリクエストも送信しません。

ここで赤いエラーが出た場合は、後述の「よくある質問」を先に確認してください。実際のインストールコマンドを繰り返し実行しないでください。

### 手順 3: インストール

プレビューでエラーがなければ、同じ PowerShell 7 ウィンドウで次を実行します。`-WhatIf` がないだけの同じコマンドです:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File ".\work\thread-localizer\launcher\install.ps1" `
  -SourceRoot "$PWD"
```

インストーラーは次のことを行います:

- Codex の関連設定をバックアップ
- 新しい設定を現在の Codex が読めるか検証
- 引き継ぎツールをインストール
- デスクトップに2つのショートカットを作成

Codex のタスクデータベースを直接変更したり、元のタスクを削除したり、自動でメッセージを送信したりはしません。

### 手順 4: デスクトップのショートカットを確認する

インストールが成功すると、デスクトップに次の2つが表示されます:

```text
交接给deepseek
交接给GPT
```

それぞれの役割:

| ショートカット | いつクリックするか | 何をするか |
| --- | --- | --- |
| `交接给deepseek` | GPT を使っていて DeepSeek に切り替えたいとき | GPT のタスクを DeepSeek に引き継いでから Codex を開く |
| `交接给GPT` | DeepSeek を使っていて GPT に戻りたいとき | DeepSeek のタスクを整理して GPT に引き継いでから Codex を開く |

## 初めての引き継ぎ

最初は重要でないテストタスクで動作確認することをおすすめします。

### GPT から DeepSeek へ切り替える

1. 通常の GPT ログイン方法で Codex を開く
2. テストタスクを新規作成し、分かりやすいメッセージを送る。例:

   ```text
   これはGPTとDeepSeekの引き継ぎテストです。
   ```

3. GPT の返信が完了するまで待つ
4. Codex を完全に閉じる
5. 数秒待って、Codex のウィンドウが完全に消えたことを確認
6. デスクトップの `交接给deepseek` をダブルクリック
7. **1回だけクリックして待つ**
8. 引き継ぎが完了すると、Codex が DeepSeek 設定で自動的に開く
9. 「最近」または対応するプロジェクトでテストタスクを探す
10. GPT のテストメッセージと返信が見えることを確認
11. 同じタスクで DeepSeek にもう一度返信させる

### DeepSeek から GPT へ戻る

1. DeepSeek の返信が完全に終わるまで待つ
2. Codex を完全に閉じる
3. 数秒待つ
4. デスクトップの `交接给GPT` をダブルクリック
5. **1回だけクリックして待つ**
6. ツールがまず、GPT と互換性のない推論記録と Web 検索記録を処理する
7. 完了すると Codex が GPT ログイン設定に戻る
8. テストタスクを開く
9. DeepSeek が送信した内容が見えることを確認
10. GPT にもう一度メッセージを送り、正常に返信することを確認

すべて成功すれば、双方向の引き継ぎが動作しています。

## 日常的な使い方

2つのショートカットは「目標モード」を意味し、どちらも**引き継ぎせずに Codex を
開くだけ**の使い方ができます:

- **`交接给deepseek`:** Codex を閉じてからクリック。選択画面に GPT 側のタスクが
  並び、選ぶと引き継ぎ・DeepSeek 設定の書き込み・ローカルアダプターの起動を行い、
  DeepSeek モードで Codex を開きます。**「仅打开 Codex（继续当前模式）」** を選べば、
  アダプターを起動して前回のタスクを開くだけにもできます。
- **`交接给GPT`:** Codex を閉じてからクリック。DeepSeek 側のタスク（DeepSeek
  モードで新しく作った会話も含む）が並び、選ぶと同期して GPT モードで Codex を
  開きます。

複数のタスクを同時に選んだ場合、選んだタスクを 1 つずつ順番に開きます。これに
よりすべてが Codex のサイドバーに表示され（`[GPT]` / `[DeepSeek]` のプレフィックスで
判別できます）、最後に前面へ来るのは実際に新しく引き継いだタスクです。2 つ以上を
処理した回は、各タスク名と `codex://threads/...` リンクをまとめた通知が表示され、
同じ内容が `%USERPROFILE%\.codex\model-switcher\handoff-logs\last-handoff.json` にも
書き込まれます。

DeepSeek を使った直後に、タスクバーの公式 Codex アイコンをクリックしないでください。引き継ぎ手順をスキップすることになり、新しい DeepSeek の内容が GPT のタスクにまだ表示されない可能性があります。

### 終了と再開

- **DeepSeek モードの Codex を閉じても自動処理は何も行いません:** アダプターを停止し、`config.toml` はそのままにして終了します。設定の書き込み・ウィンドウの再表示・同期は行わないため、Codex を閉じた直後にシャットダウンしても安全です。
- 同期はショートカットをクリックしてタスクを選んだ瞬間だけ行われるため、シャットダウンで引き継ぎが中断されることはありません。
- 再開するときは対応するショートカットをクリックし、**「仅打开 Codex（继续当前模式）」** を選びます。記録があれば前回のタスクをディープリンクで開き、なければ通常起動します。
- DeepSeek モードの Codex を閉じた後はアダプターも終了しています。その状態で公式アイコンから Codex を起動すると、設定は DeepSeek のままアダプターがないためリクエストが失敗します。DeepSeek を使うときは必ず `交接给deepseek` から入ってください。

### タスク名のマーキングと並び順

引き継ぎ後、同じ作業の2つのエンドポイントは次のように改名されます:

```text
[GPT] 元のタスク名
[DeepSeek] 元のタスク名
```

- プレフィックスは一度だけ付き、繰り返し引き継いでも `[GPT] [GPT] ...` のようにはなりません。
- 自分で名前を変更した場合は、その名前を保ったままプレフィックスだけが付きます。
- マーキングに失敗しても引き継ぎは中断されず、レポートに記録されて次回の引き継ぎで再試行されます。
- タスク選択画面は既定で「最終更新」の降順（新しい順）です。`時間 / Provider·モデル / タスク / 作業ディレクトリ` の見出しをクリックすると並び順を切り替えられます。検索とチェックボックスはこれまでどおり使えます。

## ショートカットをクリックしても Codex がすぐに表示されないのはなぜ？

これは設計どおりの動作で、ショートカットが壊れているわけではありません。

ツールはまず次のことを行います:

1. 引き継ぎが必要なタスクを探す
2. すでに引き継がれていないか確認し、重複を防ぐ
3. 新しいターゲットタスクを作成
4. 互換性のないレコードを変換
5. 引き継ぎ結果を完全に検証
6. 検証成功後に前の古いタスクを削除
7. その後で Codex を開く

タスクが多いほど待ち時間は長くなります。もう一度クリックしても速くはならず、プログラムが反応しないと誤解する原因になるので、最初のクリックの結果を待ってください。

## よくある質問

### 1. インストーラーが `models-deepseek.json` が見つからないと表示する

DeepSeek 公式の基本設定がまだ成功していないか、公式モデルカタログが想定された場所にありません。

対処方法:

1. 「手順 1: まず DeepSeek 公式の設定を完了する」の公式スクリプトを再実行
2. DeepSeek が単独で Codex を開いて正常に返信することを確認
3. Codex を完全に閉じる
4. このプロジェクトのインストーラーを再実行

空の `models-deepseek.json` を自分で作成しないでください。空ファイルは公式モデルカタログの代わりにはなりません。

### 2. ショートカットをクリックしても長時間ウィンドウが表示されない

連続クリックしないでください。引き継ぎが完了するのを待ちます。エラーダイアログが出た場合は、次の内容を記録してください:

- ダイアログの全文
- ダイアログが示すレポートパス
- GPT → DeepSeek の切り替えだったか、DeepSeek → GPT の切り替えだったか

詳しくは [トラブルシューティング](docs/troubleshooting.md) を参照してください。

### 3. タスクが「最近」に表示されるがピン留めされていない

タスクが開けて、メッセージが揃っていて、返信を続けられるなら、引き継ぎは成功しています。ピン留めは Codex の UI 状態であり、タスクのコンテキストには影響しません。必要なら手動でピン留めしてください。

### 4. 同じ名前の古いタスクが2つある

初期のテストや失敗した引き継ぎによって古いタスクが残ることがあります。名前だけで判断せず、開いてどちらが最新で返信を続けられるかを確認してください。Codex のデータベースや rollout ファイルを直接変更しないでください。

### 5. GPT が `Invalid input[*].content ... maximum length 0` を報告する

これは通常、古い DeepSeek 推論レコードが変換されていないことを意味します。現在のバージョンは DeepSeek → GPT の引き継ぎ時に、新しいターゲットの互換性のない `content` をクリーンアップします。エラーレポートを保持し、タスクデータベースや rollout を手動で変更しないでください。詳しくは [トラブルシューティング](docs/troubleshooting.md) を参照してください。

### 6. DeepSeek の Web 検索後に GPT へ戻すとエラーになる

DeepSeek と GPT では Web 検索レコードの ID 形式が異なる場合があります。このプロジェクトは GPT へ戻すときに検索呼び出しと結果の関連 ID を同期させます。衝突を見つけた場合はレコードを削除せず、停止して報告します。

### 7. DeepSeek は返信できるが画像を理解できない

引き継ぎツールはタスクコンテキストの保存と変換だけを行い、モデルに画像認識能力を追加するものではありません。画像が使えるかどうかは選択した DeepSeek モデルと API の機能次第です。

### 8. DeepSeek で `input: missing field call_id` エラーになる

古いバージョンでは、`call_id` を持たない OpenAI のツール結果項目が DeepSeek タスクにそのまま注入され、DeepSeek 側がリクエスト全体を拒否していました（`input: missing field call_id`）。

現在のバージョンでは2か所で対処します。引き継ぎ時にそのような項目を DeepSeek タスクへ書き込まないことに加え、DeepSeek モードのリクエストはローカルアダプターを通り、DeepSeek へ送るリクエストからのみ孤立したツール結果を除去します。ローカルの会話履歴は変更しません。除去の記録は次のファイルに残ります:

```text
%USERPROFILE%\.codex\model-switcher\handoff-logs\adapter-compat-<タイムスタンプ>.txt
```

Codex の更新後に同様のエラーが出る場合は、そのログとレポートのパスを保持したうえで確認してください。

## アンインストール方法

アンインストール前に Codex を完全に閉じます。

PowerShell 7 を開き、まずプレビューコマンドを実行:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File "$env:USERPROFILE\.codex\model-switcher\uninstall.ps1" `
  -WhatIf
```

プレビューに問題がなければ、正式にアンインストール:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File "$env:USERPROFILE\.codex\model-switcher\uninstall.ps1"
```

既定では、このプロジェクトがインストールした管理設定、2つのショートカット、プログラムファイルだけを削除します。次のものは保持されます:

- DeepSeek 公式モデルカタログ
- 暗号化して保存された API key
- 引き継ぎマニフェスト
- 引き継ぎレポートと manifest

## 既定の設定

- DeepSeek の推論強度: `max`
- DeepSeek の Web 検索: `live`
- OpenAI/GPT: 可能な場合はタスクが以前使っていた GPT モデルを維持

今後 DeepSeek モデルを変更する場合、新しいモデルは公式カタログに宣言され、Codex が必要とする Responses API をサポートしている必要があります。一般ユーザーが `config.toml` を手動で編集する必要はありません。

## プライバシーと安全

このプロジェクトは、お使いの PC にある Codex の `app-server` をローカルで呼び出します:

- チャット中継サーバーは運営しない
- チャット履歴をこのプロジェクト作者のサーバーにアップロードしない
- API key を Git に書き込まない
- `state_5.sqlite`、`session_index.jsonl`、ソース rollout を直接変更しない
- 書き込み前に dry-run レポートを生成し、新しいタスクの検証完了までソースを保持
- 累積タスクバックアップを作成せず、成功後は公式プロトコルで前のタスクを完全に削除
- 現在の Codex プロトコルと互換性がない場合は、推測して続行せず停止
- 引き継ぎマニフェストで同じタスクが二重コピーされるのを防ぐ
- ユーザーごとのロックで、連続クリックによる複数同時実行を防ぐ

詳しくは [安全ドキュメント](docs/safety.md) を参照してください。

## 開発者向け

インストールして使うだけならここで読み終えてください。以下はコードを確認したり、プロトコルをデバッグしたり、開発に参加したりする人向けです。

### ローカルテスト

プロジェクトルートで実行:

```powershell
npm test
pwsh -NoProfile -File ".\scripts\check-powershell.ps1"
```

### プロトコル確認と dry-run

```powershell
npm run schema-check
npm run dry-run:deepseek
npm run dry-run:openai
```

`schema-check` は Codex app-server プロトコルを確認・キャッシュするだけで、モデルターンを開始しません。dry-run はレポートを生成するだけです。移行ロジックを初めて変更するときは、範囲を広げる前に1つのタスクで検証してください。

### 既定モデルの変更

プロバイダー既定設定は次にあります:

[work/thread-localizer/data/handoff-settings.json](work/thread-localizer/data/handoff-settings.json)

- OpenAI は `preserve-existing` を使い、タスクが以前使っていた GPT モデルに戻す
- DeepSeek の既定値は `deepseek-v4-pro + max`。DeepSeek モードで Codex を開いている間は、Codex 標準のモデルメニューから現在のタスクを V4 Pro/V4 Flash と Low/High/Max の間で切り替えられる
- 一部の Codex Desktop はサードパーティ製モデルの slug を除外するため、ランチャーは2つのローカル互換エントリを生成する。DeepSeek モード中だけ `127.0.0.1` のモデル名アダプターを起動し、送信するモデル名だけを公式 DeepSeek slug に戻す。GPT 通信はこのアダプターを経由せず、メッセージ本文、ツール呼び出し、検索記録、応答ストリームも書き換えない
- 引き継ぎツールはタスクごとに最後に使用した DeepSeek モデルと思考強度を記憶し、GPT から戻るときに復元する。DeepSeek を一度も使用していないタスクだけが既定値を使う
- DeepSeek のモデル slug はローカルの公式 `models-deepseek.json` に存在する必要がある

### 関連ドキュメント

- [アーキテクチャ](docs/architecture.md)
- [互換性マトリックス](docs/compatibility.md)
- [トラブルシューティング](docs/troubleshooting.md)
- [安全](docs/safety.md)
- [CLI とプロトコルの詳細](work/thread-localizer/README.md)
- [中文 README](README.md)
- [English README](README.en.md)

## ライセンス

このプロジェクトは [MIT License](LICENSE) です。

DeepSeek 公式モデルカタログとブランドアイコンはこのリポジトリで再配布しません。インストーラーはユーザー PC にある公式設定を再利用します。個人のアイコン、API key、Codex データベース、タスクレポート、チャット履歴を公開リポジトリにコミットしないでください。
