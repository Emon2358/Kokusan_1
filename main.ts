// main.ts
import { Application, Router, send } from "https://deno.land/x/oak/mod.ts";

const app = new Application();
const router = new Router();

// 簡易的な投稿データ（実運用では DB 等に変更）
let posts: { id: number; user: string; content: string; timestamp: number }[] = [];

// 投稿一覧を取得するエンドポイント
router.get("/api/posts", (context) => {
  context.response.body = posts;
});

// 新規投稿を受け付けるエンドポイント
router.post("/api/posts", async (context) => {
  const body = await context.request.body({ type: "json" }).value;
  const newPost = {
    id: Date.now(),
    user: body.user,
    content: body.content,
    timestamp: Date.now(),
  };
  // 最新投稿を先頭に追加
  posts.unshift(newPost);
  context.response.body = newPost;
  context.response.status = 201;
});

// 静的ファイルを /static 以下に配置する設定
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

// フロントエンド用の index.html をルートで配信
app.use(async (context) => {
  await send(context, "/index.html", {
    root: `${Deno.cwd()}`,
  });
});

console.log("Server running on http://localhost:8000");
await app.listen({ port: 8000 });


