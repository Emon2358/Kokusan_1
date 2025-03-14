// mod.ts
// 国産第1号 - 分散型ソーシャルネットワーク（超高度版・公開性制御・埋め込みプレビュー対応）
//
// 環境変数（Deno Deploy の設定または .env ファイル）:
//   DOMAIN             : サービス運用ドメイン（例: yourdomain.com）
//   JWT_SECRET         : JWT のシークレットキー
//   FEDERATION_SECRET  : フェデレーション向け認証用シークレット

import { create, verify, getNumericDate, Payload } from "https://deno.land/x/djwt@v2.7/mod.ts";
import { hash, compare } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

// 環境変数から値を取得
const JWT_SECRET = Deno.env.get("JWT_SECRET") || "";
const FEDERATION_SECRET = Deno.env.get("FEDERATION_SECRET") || "";
const DOMAIN = Deno.env.get("DOMAIN") || "";

if (!JWT_SECRET || !FEDERATION_SECRET || !DOMAIN) {
  console.error("Error: JWT_SECRET, FEDERATION_SECRET, and DOMAIN must be set in environment variables.");
  Deno.exit(1);
}

// Deno KV を利用したデータ永続化
const kv = await Deno.openKv();

// 簡易レートリミット（IP毎：1分間あたり60リクエスト）
const RATE_LIMIT = 60;
const rateLimitMap = new Map<string, { count: number; reset: number }>();

interface User {
  username: string;
  passwordHash: string;
}

interface Post {
  id: string;
  content: string;
  createdAt: string;
  author: string;
  visibility: "public" | "private";  // 公開性フラグ
}

// セキュリティヘッダー
const SECURITY_HEADERS: HeadersInit = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Access-Control-Allow-Origin": "*",
};

// 共通レスポンス関数（セキュリティヘッダー付き）
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
  });
}
function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain", ...SECURITY_HEADERS },
  });
}
function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html", ...SECURITY_HEADERS },
  });
}

// 簡易レートリミット（IP毎チェック）
function checkRateLimit(req: Request): Response | null {
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + 60000;
  }
  entry.count++;
  rateLimitMap.set(ip, entry);
  if (entry.count > RATE_LIMIT) {
    return jsonResponse({ error: "Too Many Requests" }, 429);
  }
  return null;
}

// JWT認証ヘルパー
async function getUserFromAuth(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.substring("Bearer ".length);
  try {
    const payload = await verify(token, JWT_SECRET, "HS256");
    return payload.username as string;
  } catch (e) {
    console.error("JWT verification failed:", e);
    return null;
  }
}

// UI 用 HTML（洗練されたクールなデザイン、ダークモード切替、編集・削除、公開設定付き）
// さらに、以下の OG/Twitter Card 用のメタタグを追加しており、Discord などのチャットアプリで URL を貼ると
// 埋め込みプレビューに「国産第一号」と「made in japane create by kato_junichi0817」が表示されます。
const htmlContent = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- Open Graph / Discord -->
  <meta property="og:title" content="国産第一号">
  <meta property="og:description" content="made in japane create by kato_junichi0817">
  <meta property="og:url" content="https://${DOMAIN}">
  <meta property="og:type" content="website">
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="国産第一号">
  <meta name="twitter:description" content="made in japane create by kato_junichi0817">
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary-color: #1DA1F2;
      --background-color: #ffffff;
      --accent-color: #657786;
      --border-color: #e1e8ed;
      --shadow-color: rgba(0, 0, 0, 0.1);
      --font-family: 'Roboto', sans-serif;
      --dark-background: #15202b;
      --dark-text: #e1e8ed;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-family);
      background: linear-gradient(135deg, var(--background-color), #f0f4f8);
      color: #14171a;
      line-height: 1.6;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-bottom: 40px;
      transition: background-color 0.3s, color 0.3s;
    }
    body.dark-mode {
      background: linear-gradient(135deg, var(--dark-background), #0e1116);
      color: var(--dark-text);
    }
    header {
      background: linear-gradient(135deg, var(--primary-color), #0d95e8);
      width: 100%;
      padding: 20px 0;
      text-align: center;
      color: #fff;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 2px 4px var(--shadow-color);
      display: flex;
      justify-content: center;
      align-items: center;
    }
    header h1 { font-size: 2.8rem; font-weight: 700; }
    header button { margin-left: 20px; padding: 8px 12px; border: none; border-radius: 4px; background: #fff; color: var(--primary-color); cursor: pointer; transition: background 0.3s; }
    header button:hover { background: #e8f5fd; }
    main { max-width: 800px; width: 100%; padding: 20px; }
    section { margin-bottom: 30px; }
    h2 { margin-bottom: 15px; color: var(--primary-color); font-size: 1.8rem; }
    form {
      background: #f5f8fa;
      padding: 20px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      margin-bottom: 20px;
      animation: fadeIn 0.6s ease-in-out;
    }
    body.dark-mode form { background: #192734; border-color: #38444d; }
    input, textarea, select {
      width: 100%;
      padding: 12px;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      margin-bottom: 10px;
      font-size: 1rem;
      transition: border-color 0.3s ease;
      background: #fff;
      color: #14171a;
    }
    body.dark-mode input, body.dark-mode textarea, body.dark-mode select {
      background: #15202b;
      color: var(--dark-text);
      border-color: #38444d;
    }
    input:focus, textarea:focus, select:focus { outline: none; border-color: var(--primary-color); }
    button {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 4px;
      background: var(--primary-color);
      color: #fff;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.3s ease, transform 0.2s ease;
    }
    button:hover { background: #0d95e8; transform: scale(1.02); }
    .post {
      background: #fff;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 15px;
      box-shadow: 0 2px 4px var(--shadow-color);
      transition: transform 0.2s ease;
    }
    body.dark-mode .post { background: #192734; border-color: #38444d; }
    .post:hover { transform: translateY(-3px); }
    .post p { font-size: 1.1rem; margin-bottom: 10px; }
    .post small { color: var(--accent-color); }
    #userInfo {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #f5f8fa;
      padding: 10px 15px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      margin-bottom: 20px;
      animation: fadeIn 0.6s ease-in-out;
    }
    body.dark-mode #userInfo { background: #192734; border-color: #38444d; }
    #userInfo p { margin: 0; font-size: 1.1rem; }
    .spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid var(--primary-color);
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @media (max-width: 600px) {
      header h1 { font-size: 2rem; }
      main { padding: 10px; }
      h2 { font-size: 1.6rem; }
    }
  </style>
</head>
<body>
  <header>
    <h1>国産第一号</h1>
    <button id="themeToggle">ダークモード</button>
  </header>
  <main>
    <section id="auth">
      <h2>アカウント管理</h2>
      <div id="register">
        <h3>新規登録</h3>
        <form id="registerForm">
          <input type="text" id="regUsername" placeholder="ユーザー名" required>
          <input type="password" id="regPassword" placeholder="パスワード" required>
          <button type="submit">登録する</button>
        </form>
      </div>
      <div id="login">
        <h3>ログイン</h3>
        <form id="loginForm">
          <input type="text" id="loginUsername" placeholder="ユーザー名" required>
          <input type="password" id="loginPassword" placeholder="パスワード" required>
          <button type="submit">ログインする</button>
        </form>
      </div>
      <div id="userInfo" style="display:none;">
        <p>ログイン中: <span id="currentUser"></span></p>
        <button id="logoutButton">ログアウト</button>
      </div>
    </section>
    <section id="postSection" style="display:none;">
      <h2>新規投稿</h2>
      <form id="postForm">
        <textarea id="postContent" placeholder="あなたの思いを記入..." required></textarea>
        <select id="postVisibility">
          <option value="public">公開</option>
          <option value="private">非公開</option>
        </select>
        <button type="submit">投稿する</button>
      </form>
    </section>
    <section id="feed">
      <h2>投稿一覧</h2>
      <div id="posts"></div>
      <button id="loadMore">さらに読み込む</button>
      <div id="spinner" class="spinner" style="display:none;"></div>
    </section>
  </main>
  <script>
    let jwtToken = "";
    let currentPage = 0;
    const limit = 10;
    
    // ダークモード切替
    const themeToggle = document.getElementById("themeToggle");
    themeToggle.addEventListener("click", () => {
      document.body.classList.toggle("dark-mode");
      themeToggle.textContent = document.body.classList.contains("dark-mode") ? "ライトモード" : "ダークモード";
    });
    
    document.getElementById("registerForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("regUsername").value;
      const password = document.getElementById("regPassword").value;
      const res = await fetch("/api/register", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({username, password})
      });
      if(res.ok) {
        alert("登録に成功しました！");
      } else {
        alert("登録に失敗しました。");
      }
    });
    
    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("loginUsername").value;
      const password = document.getElementById("loginPassword").value;
      const res = await fetch("/api/login", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({username, password})
      });
      if(res.ok) {
        const data = await res.json();
        jwtToken = data.token;
        document.getElementById("currentUser").innerText = username;
        document.getElementById("userInfo").style.display = "flex";
        document.getElementById("postSection").style.display = "block";
        alert("ログイン成功！");
      } else {
        alert("ログインに失敗しました。");
      }
    });
    
    document.getElementById("logoutButton").addEventListener("click", () => {
      jwtToken = "";
      document.getElementById("userInfo").style.display = "none";
      document.getElementById("postSection").style.display = "none";
    });
    
    document.getElementById("postForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const content = document.getElementById("postContent").value;
      const visibility = document.getElementById("postVisibility").value;
      const res = await fetch("/api/post", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + jwtToken
        },
        body: JSON.stringify({content, visibility})
      });
      if(res.ok) {
        document.getElementById("postContent").value = "";
        loadPosts(true);
      } else {
        alert("投稿に失敗しました。");
      }
    });
    
    async function loadPosts(reset=false) {
      if(reset) {
        currentPage = 0;
        document.getElementById("posts").innerHTML = "";
      }
      document.getElementById("spinner").style.display = "block";
      const res = await fetch(\`/api/outbox?page=\${currentPage}&limit=\${limit}\`);
      if(res.ok) {
        const data = await res.json();
        data.orderedItems.forEach(post => {
          const div = document.createElement("div");
          div.className = "post";
          div.innerHTML = "<p>" + post.content + "</p><small>" + post.published + "</small>";
          if(post.canEdit) {
            div.innerHTML += "<br><button class='editBtn' data-id='" + post.id + "'>編集</button>";
            div.innerHTML += "<button class='deleteBtn' data-id='" + post.id + "'>削除</button>";
          }
          document.getElementById("posts").appendChild(div);
        });
        if(data.orderedItems.length < limit) {
          document.getElementById("loadMore").style.display = "none";
        } else {
          document.getElementById("loadMore").style.display = "block";
        }
        currentPage++;
      }
      document.getElementById("spinner").style.display = "none";
    }
    
    document.getElementById("loadMore").addEventListener("click", () => loadPosts());
    
    // 編集・削除イベント（投稿者のみ実行可能）
    document.getElementById("posts").addEventListener("click", async (e) => {
      const target = e.target;
      if(target.classList.contains("editBtn")){
        const postId = target.getAttribute("data-id");
        const newContent = prompt("新しい内容を入力してください:");
        if(newContent !== null) {
          const newVisibility = prompt("新しい公開設定を入力してください (public/private):", "public");
          if(newVisibility === "public" || newVisibility === "private"){
            const res = await fetch("/api/edit-post", {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + jwtToken
              },
              body: JSON.stringify({ id: postId, content: newContent, visibility: newVisibility })
            });
            if(res.ok) {
              alert("編集成功");
              loadPosts(true);
            } else {
              alert("編集失敗");
            }
          } else {
            alert("無効な公開設定です。");
          }
        }
      } else if(target.classList.contains("deleteBtn")){
        const postId = target.getAttribute("data-id");
        if(confirm("本当に削除しますか？")){
          const res = await fetch("/api/delete-post", {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + jwtToken
            },
            body: JSON.stringify({ id: postId })
          });
          if(res.ok) {
            alert("削除成功");
            loadPosts(true);
          } else {
            alert("削除失敗");
          }
        }
      }
    });
    
    window.onload = () => { loadPosts(true); };
  </script>
</body>
</html>
`;

// メインハンドラー
async function handler(req: Request): Promise<Response> {
  // レートリミットチェック
  const rateLimitRes = checkRateLimit(req);
  if(rateLimitRes) return rateLimitRes;

  const url = new URL(req.url);
  const pathname = url.pathname;
  const accept = req.headers.get("Accept") || "";
  
  // UI 提供：ルートまたは index.html に HTML を返す
  if ((pathname === "/" || pathname === "/index.html") && accept.includes("text/html")) {
    return htmlResponse(htmlContent);
  }
  
  // --- ActivityPub 関連エンドポイント ---
  if (req.method === "GET" && pathname === "/.well-known/webfinger") {
    const resource = url.searchParams.get("resource") || "";
    return jsonResponse({
      subject: resource,
      links: [{
        rel: "self",
        type: "application/activity+json",
        href: `https://${DOMAIN}/actor`,
      }]
    });
  }
  if (req.method === "GET" && pathname === "/actor") {
    return jsonResponse({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${DOMAIN}/actor`,
      type: "Person",
      preferredUsername: "国産第一号",
      inbox: `https://${DOMAIN}/api/inbox`,
      outbox: `https://${DOMAIN}/api/outbox`,
      summary: "国産第一号 - 未来志向の分散型SNS"
    });
  }
  
  // --- API エンドポイント ---
  // ユーザー登録
  if (req.method === "POST" && pathname === "/api/register") {
    try {
      const body = await req.json();
      const { username, password } = body;
      if (!username || !password) return jsonResponse({ error: "Username and password required" }, 400);
      const userKey = ["user", username];
      const existing = await kv.get<User>(userKey);
      if (existing.value) return jsonResponse({ error: "User already exists" }, 400);
      const passwordHash = await hash(password);
      const user: User = { username, passwordHash };
      await kv.set(userKey, user);
      return jsonResponse({ message: "User registered" }, 201);
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }
  
  // ログイン（JWT 発行）
  if (req.method === "POST" && pathname === "/api/login") {
    try {
      const body = await req.json();
      const { username, password } = body;
      if (!username || !password) return jsonResponse({ error: "Username and password required" }, 400);
      const userKey = ["user", username];
      const userRecord = await kv.get<User>(userKey);
      const user = userRecord.value;
      if (!user) return jsonResponse({ error: "User not found" }, 404);
      const passwordValid = await compare(password, user.passwordHash);
      if (!passwordValid) return jsonResponse({ error: "Invalid password" }, 401);
      const payload: Payload = { username, exp: getNumericDate(60 * 60) };
      const token = await create({ alg: "HS256", typ: "JWT" }, payload, JWT_SECRET);
      return jsonResponse({ token });
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }
  
  // 投稿作成（認証必須）：visibility を含む
  if (req.method === "POST" && pathname === "/api/post") {
    const username = await getUserFromAuth(req);
    if (!username) return jsonResponse({ error: "Unauthorized" }, 401);
    try {
      const body = await req.json();
      const { content, visibility } = body;
      if (!content) return jsonResponse({ error: "Content required" }, 400);
      const vis = (visibility === "private") ? "private" : "public";
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const post: Post = { id, content, createdAt, author: username, visibility: vis };
      const compositeKey = ["post", createdAt, id];
      await kv.set(compositeKey, post);
      await kv.set(["post_by_id", id], { key: compositeKey });
      return jsonResponse({
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `https://${DOMAIN}/posts/${id}`,
        type: "Note",
        content: post.content,
        published: post.createdAt,
        attributedTo: `https://${DOMAIN}/actor`
      }, 201);
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }
  
  // 投稿編集（認証必須・投稿者のみ）：内容と公開設定の更新
  if (req.method === "PUT" && pathname === "/api/edit-post") {
    const username = await getUserFromAuth(req);
    if (!username) return jsonResponse({ error: "Unauthorized" }, 401);
    try {
      const body = await req.json();
      const { id, content, visibility } = body;
      if (!id || !content) return jsonResponse({ error: "ID and content required" }, 400);
      const mapping = await kv.get<{ key: string[] }>(["post_by_id", id]);
      if (!mapping.value) return jsonResponse({ error: "Post not found" }, 404);
      const compositeKey = mapping.value.key;
      const postRecord = await kv.get<Post>(compositeKey);
      const post = postRecord.value;
      if (!post) return jsonResponse({ error: "Post not found" }, 404);
      if (post.author !== username) return jsonResponse({ error: "Not authorized" }, 403);
      post.content = content;
      if (visibility === "public" || visibility === "private") {
        post.visibility = visibility;
      }
      await kv.set(compositeKey, post);
      return jsonResponse({ message: "Post updated" });
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }
  
  // 投稿削除（認証必須・投稿者のみ）
  if (req.method === "DELETE" && pathname === "/api/delete-post") {
    const username = await getUserFromAuth(req);
    if (!username) return jsonResponse({ error: "Unauthorized" }, 401);
    try {
      const body = await req.json();
      const { id } = body;
      if (!id) return jsonResponse({ error: "ID required" }, 400);
      const mapping = await kv.get<{ key: string[] }>(["post_by_id", id]);
      if (!mapping.value) return jsonResponse({ error: "Post not found" }, 404);
      const compositeKey = mapping.value.key;
      const postRecord = await kv.get<Post>(compositeKey);
      const post = postRecord.value;
      if (!post) return jsonResponse({ error: "Post not found" }, 404);
      if (post.author !== username) return jsonResponse({ error: "Not authorized" }, 403);
      await kv.delete(compositeKey);
      await kv.delete(["post_by_id", id]);
      return jsonResponse({ message: "Post deleted" });
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }
  
  // Outbox：投稿一覧（ページネーション・公開性制御付き）  
  // 非認証の場合は "public" の投稿のみ、認証済みなら自分の "private" 投稿も含む
  if (req.method === "GET" && pathname === "/api/outbox") {
    const page = parseInt(url.searchParams.get("page") || "0");
    const limitParam = parseInt(url.searchParams.get("limit") || "10");
    const currentUser = await getUserFromAuth(req);
    const allPosts: Post[] = [];
    for await (const { value } of kv.list<Post>({ prefix: ["post"] }, { reverse: true })) {
      if (!value) continue;
      if (value.visibility === "public" || (currentUser && value.author === currentUser)) {
        allPosts.push(value);
      }
    }
    const totalItems = allPosts.length;
    const paginatedPosts = allPosts.slice(page * limitParam, page * limitParam + limitParam);
    const orderedItems = paginatedPosts.map(post => ({
      id: `https://${DOMAIN}/posts/${post.id}`,
      type: "Note",
      content: post.content,
      published: post.createdAt,
      attributedTo: `https://${DOMAIN}/actor`,
      canEdit: currentUser === post.author
    }));
    return jsonResponse({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${DOMAIN}/api/outbox`,
      type: "OrderedCollection",
      totalItems,
      orderedItems
    });
  }
  
  // Inbox：フェデレーションからの受信（専用ヘッダー認証）
  if (req.method === "POST" && pathname === "/api/inbox") {
    const fedToken = req.headers.get("X-Federation-Token");
    if (fedToken !== FEDERATION_SECRET) return jsonResponse({ error: "Unauthorized federation request" }, 401);
    try {
      const data = await req.json();
      console.log("Received federated activity:", data);
      return new Response(null, { status: 202, headers: SECURITY_HEADERS });
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }
  
  return textResponse("Not Found", 404);
}

export default { fetch: handler };
