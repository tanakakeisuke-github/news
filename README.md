# Bulknews Clone

[Bulknews](https://bulknews.net/) クローン。GitHub Actions で30分ごとにRSSフィードを取得し、静的HTMLとして GitHub Pages にデプロイします。

## セットアップ

### 1. リポジトリ作成

```bash
git init bulknews
cd bulknews
# このプロジェクトのファイルをコピー
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_NAME/bulknews.git
git push -u origin main
```

### 2. GitHub Pages を有効化

1. リポジトリの **Settings** → **Pages**
2. **Source** を `GitHub Actions` に変更

### 3. 完了

- push すると自動でビルド＆デプロイされます
- 以降 **30分ごと** に自動更新されます
- `https://YOUR_NAME.github.io/bulknews/` でアクセス

## ローカルで実行

```bash
npm install
npm run build
# → public/index.html が生成される
open public/index.html
```

## ニュースソースの追加・変更

`build.js` の `SOURCES` 配列を編集するだけ：

```js
{
  id: "mysite",          // ユニークID
  name: "サイト名",       // 表示名
  url: "https://...",    // サイトURL
  rss: "https://...",    // RSSフィードURL
},
```

## 更新頻度の変更

`.github/workflows/build.yml` の cron 式を変更：

```yaml
schedule:
  - cron: "*/30 * * * *"  # 30分ごと
  # - cron: "0 * * * *"   # 1時間ごと
  # - cron: "0 */6 * * *" # 6時間ごと
```

## 構成

```
bulknews/
├── build.js                      # RSS取得 → HTML生成
├── package.json
├── .github/workflows/build.yml   # GitHub Actions定義
└── public/                       # 生成物（git管理外）
    └── index.html
```
