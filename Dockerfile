# --- ステージ1: ビルド環境 (Build Stage) ---
FROM node:20-alpine AS builder

WORKDIR /app

# 依存関係ファイルをコピー
COPY package.json package-lock.json* ./

# 依存ライブラリをインストール
RUN npm install

# ソースコードを全てコピー
COPY . .

# ビルド実行
RUN npm run build

# --- ステージ2: 実行環境 (Production Stage) ---
FROM nginx:alpine

# 【重要】デフォルトのNginx設定とindex.htmlを削除してクリーンにする
RUN rm -rf /etc/nginx/conf.d/*
RUN rm -rf /usr/share/nginx/html/*

# カスタム設定ファイルをコピー
COPY nginx.conf /etc/nginx/conf.d/default.conf

# ビルド成果物をコピー
COPY --from=builder /app/dist /usr/share/nginx/html

# ポート80を公開
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]