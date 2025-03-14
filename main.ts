// main.ts
// ※ローカルでテストする場合は、--unstable フラグを付与してください。
// 例: deno run --allow-net --unstable main.ts

import { Application, Router, send } from "https://deno.land/x/oak/mod.ts";

// Deno Deploy 環境では Deno KV が利用可能
const kv = await Deno.openKv();

const app = new Application();
const router = new Router();

// ───── /api/register エンドポイント ─────
router.post("/api/register", async (context) => {
  try {
    // リクエストにボディが存在するかチェック
    if (!context.request.hasBody) {
      context.response.status = 400;
      context.response.body = { error: "リクエストボディが存在しません" };
      return;
    }
    // JSON パース（Oak の場合、body({ type: "json" }) で取得）
    const bodyResult = context.request.body({ type: "json" });
    const body = await bodyResult.value;
    console.log("Received /api/register body:", body);

    // username の存在・型チェック
    const username = body.username;
    if (!username || typeof username !== "string") {
      context.response.status = 400;
      context.response.body = { error: "username が必要です（文字列）" };
      return;
    }
    
    // KV 上で既存のユーザー名チェック
    const userKey = ["user", username];
    const existing = await kv.get(userKey);
    if (existing.value) {
      context.response.status = 400;
      context.response.body = { error: "既に使われているユーザー名です" };
      return;
    }
    
    // ユーザー登録：初期状態は空のフレンドリスト
    await kv.set(userKey, { username, friends: [] });
    context.response.status = 201;
    context.response.body = { username };
  } catch (error) {
    // 詳細なエラーログを出力（Deno Deploy のログで確認可能）
    console.error("Error in /api/register:", error);
    context.response.status = 500;
    context.response.body = { error: "Internal Server Error" };
  }
});

// ───── 簡易な投稿機能の例 ─────
let posts: { id: number; user: string; content: string; timestamp: number }[] = [];

router.get("/api/posts", (context) => {
  context.response.body = posts;
});

router.post("/api/posts", async (context) => {
  try {
    const body = await context.request.body({ type: "json" }).value;
    const newPost = {
      id: Date.now(),
      user: body.user,
      content: body.content,
      timestamp: Date.now(),
    };
    posts.unshift(newPost);
    context.response.body = newPost;
    context.response.status = 201;
  } catch (e) {
    console.error("Error in /api/posts:", e);
    context.response.status = 500;
    context.response.body = { error: "Internal Server Error" };
  }
});

// ───── 静的ファイル配信（index.html など） ─────
app.use(async (context, next) => {
  if (context.request.url.pathname.startsWith("/static")) {
    await send(context, context.request.url.pathname, {
      root: `${Deno.cwd()}`,
    });
  } else {
    await next();
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

app.use(async (context) => {
  await send(context, "/index.html", {
    root: `${Deno.cwd()}`,
  });
});

console.log("Server running on http://localhost:8000");
await app.listen({ port: 8000 });
