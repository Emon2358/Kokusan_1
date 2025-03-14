// main.ts
import { Application, Router, send } from "https://deno.land/x/oak/mod.ts";

// Deno KV を初期化（Deno Deployで利用可能）
const kv = await Deno.openKv();

const app = new Application();
const router = new Router();

// 既存の投稿機能（エラー処理を強化）
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
    console.error(e);
    context.response.status = 500;
    context.response.body = { error: "Internal Server Error" };
  }
});

// ─────────── ユーザー登録・検索・フレンド機能 ───────────

// ユーザー登録（既存の名前は使えない）
router.post("/api/register", async (context) => {
  try {
    const { username } = await context.request.body({ type: "json" }).value;
    if (!username) {
      context.response.status = 400;
      context.response.body = { error: "Username required" };
      return;
    }
    const userKey = ["user", username];
    const existing = await kv.get(userKey);
    if (existing.value) {
      context.response.status = 400;
      context.response.body = { error: "Username already taken" };
      return;
    }
    // 初期状態は空のフレンドリストを持つ
    await kv.set(userKey, { username, friends: [] });
    context.response.status = 201;
    context.response.body = { username };
  } catch (e) {
    console.error(e);
    context.response.status = 500;
    context.response.body = { error: "Internal Server Error" };
  }
});

// ユーザー検索（部分一致で返す）
router.get("/api/users/search", async (context) => {
  try {
    const query = context.request.url.searchParams.get("query") || "";
    const result: { username: string }[] = [];
    // KVのキー「user」プレフィックスを利用して全ユーザーを走査
    for await (const { value } of kv.list({ prefix: ["user"] })) {
      if (value.username.includes(query)) {
        result.push({ username: value.username });
      }
    }
    context.response.body = result;
  } catch (e) {
    console.error(e);
    context.response.status = 500;
    context.response.body = { error: "Internal Server Error" };
  }
});

// フレンド追加（双方のユーザーのフレンドリストを更新）
router.post("/api/friends", async (context) => {
  try {
    const { from, to } = await context.request.body({ type: "json" }).value;
    if (from === to) {
      context.response.status = 400;
      context.response.body = { error: "Cannot add yourself as friend" };
      return;
    }
    const fromKey = ["user", from];
    const toKey = ["user", to];
    const fromUser = await kv.get(fromKey);
    const toUser = await kv.get(toKey);
    if (!fromUser.value || !toUser.value) {
      context.response.status = 404;
      context.response.body = { error: "User not found" };
      return;
    }
    const fromFriends = fromUser.value.friends || [];
    if (fromFriends.includes(to)) {
      context.response.status = 400;
      context.response.body = { error: "Already friends" };
      return;
    }
    // 双方向にフレンド追加
    fromFriends.push(to);
    const toFriends = toUser.value.friends || [];
    toFriends.push(from);
    await kv.set(fromKey, { ...fromUser.value, friends: fromFriends });
    await kv.set(toKey, { ...toUser.value, friends: toFriends });
    context.response.status = 200;
    context.response.body = { message: "Friend added" };
  } catch (e) {
    console.error(e);
    context.response.status = 500;
    context.response.body = { error: "Internal Server Error" };
  }
});

// 指定ユーザーのフレンドリスト取得
router.get("/api/friends", async (context) => {
  try {
    const username = context.request.url.searchParams.get("username");
    if (!username) {
      context.response.status = 400;
      context.response.body = { error: "Username required" };
      return;
    }
    const userKey = ["user", username];
    const user = await kv.get(userKey);
    if (!user.value) {
      context.response.status = 404;
      context.response.body = { error: "User not found" };
      return;
    }
    context.response.body = { friends: user.value.friends || [] };
  } catch (e) {
    console.error(e);
    context.response.status = 500;
    context.response.body = { error: "Internal Server Error" };
  }
});

// ─────────── フレンド同士の会話機能 ───────────

// メッセージ送信（送信者と受信者がフレンドであるかチェック）
router.post("/api/messages", async (context) => {
  try {
    const { from, to, message } = await context.request.body({ type: "json" }).value;
    const fromKey = ["user", from];
    const user = await kv.get(fromKey);
    if (!user.value || !(user.value.friends || []).includes(to)) {
      context.response.status = 400;
      context.response.body = { error: "Not friends" };
      return;
    }
    // 会話IDはアルファベット順で決定（例："alice:bob"）
    const conversationId = [from, to].sort().join(":");
    const timestamp = Date.now();
    const messageKey = ["message", conversationId, timestamp];
    await kv.set(messageKey, { from, to, message, timestamp });
    context.response.status = 201;
    context.response.body = { message: "Message sent" };
  } catch (e) {
    console.error(e);
    context.response.status = 500;
    context.response.body = { error: "Internal Server Error" };
  }
});

// 指定ユーザー同士の会話履歴を取得（タイムスタンプ順）
router.get("/api/messages", async (context) => {
  try {
    const from = context.request.url.searchParams.get("from");
    const to = context.request.url.searchParams.get("to");
    if (!from || !to) {
      context.response.status = 400;
      context.response.body = { error: "from and to required" };
      return;
    }
    const fromKey = ["user", from];
    const user = await kv.get(fromKey);
    if (!user.value || !(user.value.friends || []).includes(to)) {
      context.response.status = 400;
      context.response.body = { error: "Not friends" };
      return;
    }
    const conversationId = [from, to].sort().join(":");
    const messages: any[] = [];
    for await (const { value } of kv.list({ prefix: ["message", conversationId] })) {
      messages.push(value);
    }
    messages.sort((a, b) => a.timestamp - b.timestamp);
    context.response.body = messages;
  } catch (e) {
    console.error(e);
    context.response.status = 500;
    context.response.body = { error: "Internal Server Error" };
  }
});

// ─────────── 静的ファイル配信 ───────────
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
