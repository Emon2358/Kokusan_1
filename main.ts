// main.ts
// ※ローカルで実行する場合は必ず --unstable フラグを付与してください。
// 例: deno run --allow-net --unstable main.ts

import { Application, Router, send } from "https://deno.land/x/oak/mod.ts";

// Deno KV の初期化（Deno Deploy または --unstable が必要）
const kv = await Deno.openKv();

const app = new Application();
const router = new Router();

// ───── /api/register エンドポイント ─────
router.post("/api/register", async (context) => {
  try {
    // リクエストボディが存在するかチェック
    if (!context.request.hasBody) {
      context.response.status = 400;
      context.response.body = { error: "リクエストボディが存在しません" };
      return;
    }
    // JSON ボディとして取得
    const bodyResult = context.request.body({ type: "json" });
    const body = await bodyResult.value;
    
    // username の存在と型チェック
    const username = body.username;
    if (!username || typeof username !== "string") {
      context.response.status = 400;
      context.response.body = { error: "username が必要です（文字列）" };
      return;
    }
    
    // KV 上で username の重複チェック
    const userKey = ["user", username];
    const existing = await kv.get(userKey);
    if (existing.value) {
      context.response.status = 400;
      context.response.body = { error: "既に使われているユーザー名です" };
      return;
    }
    
    // 新規ユーザー登録（フレンドリストは初期状態は空）
    await kv.set(userKey, { username, friends: [] });
    context.response.status = 201;
    context.response.body = { username };
  } catch (error) {
    console.error("Error in /api/register:", error);
    context.response.status = 500;
    context.response.body = { error: "Internal Server Error" };
  }
});

// ───── その他のエンドポイント例 ─────
// ※ここでは簡易な投稿機能を例示しています
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

// 静的ファイル（例: index.html）を配信する設定
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
