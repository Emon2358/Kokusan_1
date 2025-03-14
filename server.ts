// mod.ts
// 国産第1号 - 分散型ソーシャルネットワーク（超高度版・公開性制御・埋め込みプレビュー・フレンド／グループ／画像投稿機能付き）
//
// 環境変数（Deno Deploy または .env）:
//   DOMAIN             : サービス運用ドメイン（例: yourdomain.com）
//   JWT_SECRET         : JWT シークレットキー
//   FEDERATION_SECRET  : フェデレーション向け認証シークレット

import { create, verify, getNumericDate, Payload } from "https://deno.land/x/djwt@v2.7/mod.ts";
import { hash, compare } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

// 環境変数から値を取得
const JWT_SECRET = Deno.env.get("JWT_SECRET") || "";
const FEDERATION_SECRET = Deno.env.get("FEDERATION_SECRET") || "";
const DOMAIN = Deno.env.get("DOMAIN") || "";

// 環境変数が設定されていない場合はエラーを throw する
if (!JWT_SECRET || !FEDERATION_SECRET || !DOMAIN) {
  throw new Error("JWT_SECRET, FEDERATION_SECRET, and DOMAIN must be set in environment variables.");
}

// Deno KV を利用したデータ永続化
const kv = await Deno.openKv();

// 簡易レートリミット（IP毎：1分間あたり60リクエスト）
const RATE_LIMIT = 60;
const rateLimitMap = new Map<string, { count: number; reset: number }>();

// 各種インターフェース
interface User {
  username: string;
  passwordHash: string;
}

interface Post {
  id: string;
  content: string;
  createdAt: string;
  author: string;
  visibility: "public" | "private";
  imageURL?: string; // 画像投稿時にURLがあれば
}

interface FriendRequest {
  from: string;
  to: string;
  createdAt: string;
}

interface Group {
  id: string;
  name: string;
  description: string;
  owner: string;
  members: string[];
  createdAt: string;
}

interface GroupPost {
  id: string;
  groupId: string;
  content: string;
  createdAt: string;
  author: string;
  imageURL?: string;
}

interface Image {
  id: string;
  data: string; // base64 文字列
  contentType: string;
  uploadedAt: string;
  uploader: string;
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

// 共通レスポンス関数
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

// JWT 認証ヘルパー
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

// ------------------------------
// HTML UI（OG/Twitter Card用メタタグ付き）
// ------------------------------
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
    <!-- アカウント管理 -->
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
    <!-- 投稿 -->
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
    <!-- フレンド機能 -->
    <section id="friendSection" style="display:none;">
      <h2>フレンド管理</h2>
      <form id="friendRequestForm">
        <input type="text" id="friendTo" placeholder="フレンド申請先のユーザー名" required>
        <button type="submit">フレンド申請</button>
      </form>
      <button id="loadFriends">フレンド一覧を表示</button>
      <div id="friendList"></div>
    </section>
    <!-- グループ機能 -->
    <section id="groupSection" style="display:none;">
      <h2>グループ管理</h2>
      <form id="createGroupForm">
        <input type="text" id="groupName" placeholder="グループ名" required>
        <input type="text" id="groupDescription" placeholder="グループの説明">
        <button type="submit">グループ作成</button>
      </form>
      <form id="joinGroupForm">
        <input type="text" id="joinGroupId" placeholder="参加するグループID" required>
        <button type="submit">グループ参加</button>
      </form>
      <button id="loadGroups">所属グループ一覧を表示</button>
      <div id="groupList"></div>
      <form id="groupPostForm" style="margin-top:20px; display:none;">
        <input type="text" id="groupPostGroupId" placeholder="投稿先グループID" required>
        <textarea id="groupPostContent" placeholder="グループ投稿内容" required></textarea>
        <input type="text" id="groupPostImageURL" placeholder="画像URL (任意)">
        <button type="submit">グループ投稿</button>
      </form>
      <button id="loadGroupPosts" style="display:none;">グループ投稿一覧を表示</button>
      <div id="groupPostList"></div>
    </section>
    <!-- 画像アップロード -->
    <section id="imageSection" style="display:none;">
      <h2>画像アップロード</h2>
      <form id="uploadImageForm" enctype="multipart/form-data">
        <input type="file" id="imageFile" accept="image/*" required>
        <button type="submit">画像アップロード</button>
      </form>
      <div id="uploadedImageInfo"></div>
    </section>
    <!-- 投稿一覧 -->
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
    
    // アカウント関連
    document.getElementById("registerForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("regUsername").value;
      const password = document.getElementById("regPassword").value;
      const res = await fetch("/api/register", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({username, password}) });
      alert(res.ok ? "登録に成功しました！" : "登録に失敗しました。");
    });
    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("loginUsername").value;
      const password = document.getElementById("loginPassword").value;
      const res = await fetch("/api/login", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({username, password}) });
      if(res.ok) {
        const data = await res.json();
        jwtToken = data.token;
        document.getElementById("currentUser").innerText = username;
        document.getElementById("userInfo").style.display = "flex";
        document.getElementById("postSection").style.display = "block";
        document.getElementById("friendSection").style.display = "block";
        document.getElementById("groupSection").style.display = "block";
        document.getElementById("imageSection").style.display = "block";
        alert("ログイン成功！");
      } else {
        alert("ログインに失敗しました。");
      }
    });
    document.getElementById("logoutButton").addEventListener("click", () => {
      jwtToken = "";
      document.getElementById("userInfo").style.display = "none";
      document.getElementById("postSection").style.display = "none";
      document.getElementById("friendSection").style.display = "none";
      document.getElementById("groupSection").style.display = "none";
      document.getElementById("imageSection").style.display = "none";
    });
    
    // 投稿
    document.getElementById("postForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const content = document.getElementById("postContent").value;
      const visibility = document.getElementById("postVisibility").value;
      const res = await fetch("/api/post", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwtToken }, body: JSON.stringify({content, visibility}) });
      if(res.ok) {
        document.getElementById("postContent").value = "";
        loadPosts(true);
      } else {
        alert("投稿に失敗しました。");
      }
    });
    
    async function loadPosts(reset=false) {
      if(reset) { currentPage = 0; document.getElementById("posts").innerHTML = ""; }
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
        document.getElementById("loadMore").style.display = (data.orderedItems.length < limit) ? "none" : "block";
        currentPage++;
      }
      document.getElementById("spinner").style.display = "none";
    }
    document.getElementById("loadMore").addEventListener("click", () => loadPosts());
    
    // 編集・削除
    document.getElementById("posts").addEventListener("click", async (e) => {
      const target = e.target;
      if(target.classList.contains("editBtn")){
        const postId = target.getAttribute("data-id");
        const newContent = prompt("新しい内容を入力してください:");
        if(newContent !== null) {
          const newVisibility = prompt("新しい公開設定を入力してください (public/private):", "public");
          if(newVisibility === "public" || newVisibility === "private"){
            const res = await fetch("/api/edit-post", { method: "PUT", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwtToken }, body: JSON.stringify({ id: postId, content: newContent, visibility: newVisibility }) });
            alert(res.ok ? "編集成功" : "編集失敗");
            loadPosts(true);
          } else { alert("無効な公開設定です。"); }
        }
      } else if(target.classList.contains("deleteBtn")){
        const postId = target.getAttribute("data-id");
        if(confirm("本当に削除しますか？")){
          const res = await fetch("/api/delete-post", { method: "DELETE", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwtToken }, body: JSON.stringify({ id: postId }) });
          alert(res.ok ? "削除成功" : "削除失敗");
          loadPosts(true);
        }
      }
    });
    
    // フレンド機能
    document.getElementById("friendRequestForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const to = document.getElementById("friendTo").value;
      const res = await fetch("/api/send-friend-request", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwtToken }, body: JSON.stringify({ to }) });
      alert(res.ok ? "フレンドリクエスト送信成功" : "フレンドリクエスト送信失敗");
    });
    document.getElementById("loadFriends").addEventListener("click", async () => {
      const res = await fetch("/api/friends", { headers: { "Authorization": "Bearer " + jwtToken } });
      if(res.ok) {
        const data = await res.json();
        const list = data.friends.map(f => "<li>" + f + "</li>").join("");
        document.getElementById("friendList").innerHTML = "<ul>" + list + "</ul>";
      }
    });
    
    // グループ機能
    document.getElementById("createGroupForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("groupName").value;
      const description = document.getElementById("groupDescription").value;
      const res = await fetch("/api/create-group", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwtToken }, body: JSON.stringify({ name, description }) });
      alert(res.ok ? "グループ作成成功" : "グループ作成失敗");
    });
    document.getElementById("joinGroupForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const groupId = document.getElementById("joinGroupId").value;
      const res = await fetch("/api/join-group", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwtToken }, body: JSON.stringify({ groupId }) });
      alert(res.ok ? "グループ参加成功" : "グループ参加失敗");
    });
    document.getElementById("loadGroups").addEventListener("click", async () => {
      const res = await fetch("/api/groups", { headers: { "Authorization": "Bearer " + jwtToken } });
      if(res.ok) {
        const data = await res.json();
        const list = data.groups.map(g => "<li>" + g.name + " (ID:" + g.id + ")</li>").join("");
        document.getElementById("groupList").innerHTML = "<ul>" + list + "</ul>";
        document.getElementById("groupPostForm").style.display = "block";
        document.getElementById("loadGroupPosts").style.display = "block";
      }
    });
    document.getElementById("groupPostForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const groupId = document.getElementById("groupPostGroupId").value;
      const content = document.getElementById("groupPostContent").value;
      const imageURL = document.getElementById("groupPostImageURL").value;
      const res = await fetch("/api/group-post", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwtToken }, body: JSON.stringify({ groupId, content, imageURL }) });
      alert(res.ok ? "グループ投稿成功" : "グループ投稿失敗");
    });
    document.getElementById("loadGroupPosts").addEventListener("click", async () => {
      const groupId = document.getElementById("groupPostGroupId").value;
      const res = await fetch(\`/api/group-outbox?groupId=\${groupId}&page=0&limit=10\`, { headers: { "Authorization": "Bearer " + jwtToken } });
      if(res.ok) {
        const data = await res.json();
        const list = data.orderedItems.map(p => "<div class='post'><p>" + p.content + "</p><small>" + p.published + "</small></div>").join("");
        document.getElementById("groupPostList").innerHTML = list;
      }
    });
    
    // 画像アップロード
    document.getElementById("uploadImageForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const res = await fetch("/api/upload-image", { method: "POST", headers: { "Authorization": "Bearer " + jwtToken }, body: formData });
      if(res.ok) {
        const data = await res.json();
        document.getElementById("uploadedImageInfo").innerText = "画像アップロード成功。画像ID: " + data.id;
      } else {
        alert("画像アップロード失敗");
      }
    });
    
    window.onload = () => { loadPosts(true); };
  </script>
</body>
</html>
`;

// ------------------------------
// API エンドポイント
// ------------------------------
async function handler(req: Request): Promise<Response> {
  // レートリミットチェック
  const rateRes = checkRateLimit(req);
  if(rateRes) return rateRes;
  
  const url = new URL(req.url);
  const pathname = url.pathname;
  const accept = req.headers.get("Accept") || "";
  
  // UI 提供
  if ((pathname === "/" || pathname === "/index.html") && accept.includes("text/html")) {
    return htmlResponse(htmlContent);
  }
  
  // ActivityPub 関連
  if (req.method === "GET" && pathname === "/.well-known/webfinger") {
    const resource = url.searchParams.get("resource") || "";
    return jsonResponse({
      subject: resource,
      links: [{ rel: "self", type: "application/activity+json", href: `https://${DOMAIN}/actor` }]
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
  
  // ユーザー登録
  if (req.method === "POST" && pathname === "/api/register") {
    try {
      const { username, password } = await req.json();
      if (!username || !password) return jsonResponse({ error: "Username and password required" }, 400);
      const userKey = ["user", username];
      if ((await kv.get<User>(userKey)).value) return jsonResponse({ error: "User already exists" }, 400);
      const passwordHash = await hash(password);
      await kv.set(userKey, { username, passwordHash });
      return jsonResponse({ message: "User registered" }, 201);
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }
  
  // ログイン（JWT 発行）
  if (req.method === "POST" && pathname === "/api/login") {
    try {
      const { username, password } = await req.json();
      if (!username || !password) return jsonResponse({ error: "Username and password required" }, 400);
      const user = (await kv.get<User>(["user", username])).value;
      if (!user) return jsonResponse({ error: "User not found" }, 404);
      if (!(await compare(password, user.passwordHash))) return jsonResponse({ error: "Invalid password" }, 401);
      const payload: Payload = { username, exp: getNumericDate(60 * 60) };
      const token = await create({ alg: "HS256", typ: "JWT" }, payload, JWT_SECRET);
      return jsonResponse({ token });
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }
  
  // 投稿作成（認証必須、visibility と任意の imageURL を含む）
  if (req.method === "POST" && pathname === "/api/post") {
    const username = await getUserFromAuth(req);
    if (!username) return jsonResponse({ error: "Unauthorized" }, 401);
    try {
      const { content, visibility, imageURL } = await req.json();
      if (!content) return jsonResponse({ error: "Content required" }, 400);
      const vis = (visibility === "private") ? "private" : "public";
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const post: Post = { id, content, createdAt, author: username, visibility: vis, imageURL };
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
  
  // 投稿編集（認証必須、投稿者のみ）
  if (req.method === "PUT" && pathname === "/api/edit-post") {
    const username = await getUserFromAuth(req);
    if (!username) return jsonResponse({ error: "Unauthorized" }, 401);
    try {
      const { id, content, visibility } = await req.json();
      if (!id || !content) return jsonResponse({ error: "ID and content required" }, 400);
      const mapping = await kv.get<{ key: string[] }>(["post_by_id", id]);
      if (!mapping.value) return jsonResponse({ error: "Post not found" }, 404);
      const compositeKey = mapping.value.key;
      const post = (await kv.get<Post>(compositeKey)).value;
      if (!post) return jsonResponse({ error: "Post not found" }, 404);
      if (post.author !== username) return jsonResponse({ error: "Not authorized" }, 403);
      post.content = content;
      if (visibility === "public" || visibility === "private") post.visibility = visibility;
      await kv.set(compositeKey, post);
      return jsonResponse({ message: "Post updated" });
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }
  
  // 投稿削除（認証必須、投稿者のみ）
  if (req.method === "DELETE" && pathname === "/api/delete-post") {
    const username = await getUserFromAuth(req);
    if (!username) return jsonResponse({ error: "Unauthorized" }, 401);
    try {
      const { id } = await req.json();
      if (!id) return jsonResponse({ error: "ID required" }, 400);
      const mapping = await kv.get<{ key: string[] }>(["post_by_id", id]);
      if (!mapping.value) return jsonResponse({ error: "Post not found" }, 404);
      const compositeKey = mapping.value.key;
      const post = (await kv.get<Post>(compositeKey)).value;
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
  if (req.method === "GET" && pathname === "/api/outbox") {
    const page = parseInt(url.searchParams.get("page") || "0");
    const limitParam = parseInt(url.searchParams.get("limit") || "10");
    const currentUser = await getUserFromAuth(req);
    const postsArray: Post[] = [];
    for await (const { value } of kv.list<Post>({ prefix: ["post"] }, { reverse: true })) {
      if (!value) continue;
      if (value.visibility === "public" || (currentUser && value.author === currentUser)) {
        postsArray.push(value);
      }
    }
    const totalItems = postsArray.length;
    const paginated = postsArray.slice(page * limitParam, page * limitParam + limitParam);
    const orderedItems = paginated.map(post => ({
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
  
  // Inbox：フェデレーション受信（専用ヘッダー認証）
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
  
  // ========================
  // フレンド機能エンドポイント
  // ========================
  
  // フレンドリクエスト送信
  if (req.method === "POST" && pathname === "/api/send-friend-request") {
    const currentUser = await getUserFromAuth(req);
    if (!currentUser) return jsonResponse({ error: "Unauthorized" }, 401);
    try {
      const { to } = await req.json();
      if (!to) return jsonResponse({ error: "Target username required" }, 400);
      const request: FriendRequest = { from: currentUser, to, createdAt: new Date().toISOString() };
      await kv.set(["friend_request", currentUser, to], request);
      return jsonResponse({ message: "Friend request sent" }, 201);
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }
  
  // フレンドリクエスト承認
  if (req.method === "POST" && pathname === "/api/accept-friend-request") {
    const currentUser = await getUserFromAuth(req);
    if (!currentUser) return jsonResponse({ error: "Unauthorized" }, 401);
    try {
      const { from } = await req.json();
      if (!from) return jsonResponse({ error: "Sender username required" }, 400);
      const reqKey = ["friend_request", from, currentUser];
      const request = (await kv.get<FriendRequest>(reqKey)).value;
      if (!request) return jsonResponse({ error: "Friend request not found" }, 404);
      const friendKey = (from < currentUser) ? ["friend", from, currentUser] : ["friend", currentUser, from];
      await kv.set(friendKey, { user1: friendKey[1], user2: friendKey[2] });
      await kv.delete(reqKey);
      return jsonResponse({ message: "Friend request accepted" });
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }
  
  // フレンド一覧取得
  if (req.method === "GET" && pathname === "/api/friends") {
    const currentUser = await getUserFromAuth(req);
    if (!currentUser) return jsonResponse({ error: "Unauthorized" }, 401);
    const friends: string[] = [];
    for await (const { value } of kv.list({ prefix: ["friend"] })) {
      if (!value) continue;
      if (value.user1 === currentUser) friends.push(value.user2);
      else if (value.user2 === currentUser) friends.push(value.user1);
    }
    return jsonResponse({ friends });
  }
  
  // ========================
  // グループ機能エンドポイント
  // ========================
  
  // グループ作成
  if (req.method === "POST" && pathname === "/api/create-group") {
    const currentUser = await getUserFromAuth(req);
    if (!currentUser) return jsonResponse({ error: "Unauthorized" }, 401);
    try {
      const { name, description } = await req.json();
      if (!name) return jsonResponse({ error: "Group name required" }, 400);
      const id = crypto.randomUUID();
      const group: Group = { id, name, description: description || "", owner: currentUser, members: [currentUser], createdAt: new Date().toISOString() };
      await kv.set(["group", id], group);
      return jsonResponse({ message: "Group created", groupId: id }, 201);
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }
  
  // グループ参加
  if (req.method === "POST" && pathname === "/api/join-group") {
    const currentUser = await getUserFromAuth(req);
    if (!currentUser) return jsonResponse({ error: "Unauthorized" }, 401);
    try {
      const { groupId } = await req.json();
      if (!groupId) return jsonResponse({ error: "Group ID required" }, 400);
      const groupKey = ["group", groupId];
      const group = (await kv.get<Group>(groupKey)).value;
      if (!group) return jsonResponse({ error: "Group not found" }, 404);
      if (!group.members.includes(currentUser)) {
        group.members.push(currentUser);
        await kv.set(groupKey, group);
      }
      return jsonResponse({ message: "Joined group" });
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }
  
  // グループ退出
  if (req.method === "POST" && pathname === "/api/leave-group") {
    const currentUser = await getUserFromAuth(req);
    if (!currentUser) return jsonResponse({ error: "Unauthorized" }, 401);
    try {
      const { groupId } = await req.json();
      if (!groupId) return jsonResponse({ error: "Group ID required" }, 400);
      const groupKey = ["group", groupId];
      const group = (await kv.get<Group>(groupKey)).value;
      if (!group) return jsonResponse({ error: "Group not found" }, 404);
      group.members = group.members.filter(m => m !== currentUser);
      await kv.set(groupKey, group);
      return jsonResponse({ message: "Left group" });
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }
  
  // 所属グループ一覧取得
  if (req.method === "GET" && pathname === "/api/groups") {
    const currentUser = await getUserFromAuth(req);
    if (!currentUser) return jsonResponse({ error: "Unauthorized" }, 401);
    const groups: Group[] = [];
    for await (const { value } of kv.list<Group>({ prefix: ["group"] })) {
      if (!value) continue;
      if (value.members.includes(currentUser)) groups.push(value);
    }
    return jsonResponse({ groups });
  }
  
  // グループ投稿
  if (req.method === "POST" && pathname === "/api/group-post") {
    const currentUser = await getUserFromAuth(req);
    if (!currentUser) return jsonResponse({ error: "Unauthorized" }, 401);
    try {
      const { groupId, content, imageURL } = await req.json();
      if (!groupId || !content) return jsonResponse({ error: "Group ID and content required" }, 400);
      const group = (await kv.get<Group>(["group", groupId])).value;
      if (!group || !group.members.includes(currentUser)) return jsonResponse({ error: "Not a member of the group" }, 403);
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const groupPost: GroupPost = { id, groupId, content, createdAt, author: currentUser, imageURL };
      const compositeKey = ["group_post", createdAt, id];
      await kv.set(compositeKey, groupPost);
      return jsonResponse({ message: "Group post created", id });
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }
  
  // グループ投稿一覧（ページネーション）
  if (req.method === "GET" && pathname === "/api/group-outbox") {
    const groupId = url.searchParams.get("groupId");
    if (!groupId) return jsonResponse({ error: "Group ID required" }, 400);
    const page = parseInt(url.searchParams.get("page") || "0");
    const limitParam = parseInt(url.searchParams.get("limit") || "10");
    const posts: GroupPost[] = [];
    for await (const { value } of kv.list<GroupPost>({ prefix: ["group_post"] }, { reverse: true })) {
      if (!value) continue;
      if (value.groupId === groupId) posts.push(value);
    }
    const totalItems = posts.length;
    const paginated = posts.slice(page * limitParam, page * limitParam + limitParam);
    return jsonResponse({ totalItems, orderedItems: paginated });
  }
  
  // ========================
  // 画像アップロード機能
  // ========================
  
  // 画像アップロード（multipart/form-data）
  if (req.method === "POST" && pathname === "/api/upload-image") {
    const currentUser = await getUserFromAuth(req);
    if (!currentUser) return jsonResponse({ error: "Unauthorized" }, 401);
    try {
      const form = await req.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") return jsonResponse({ error: "File not provided" }, 400);
      const buffer = await file.arrayBuffer();
      const base64Data = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      const id = crypto.randomUUID();
      const image: Image = { id, data: base64Data, contentType: file.type, uploadedAt: new Date().toISOString(), uploader: currentUser };
      await kv.set(["image", id], image);
      return jsonResponse({ message: "Image uploaded", id });
    } catch (e) {
      console.error(e);
      return jsonResponse({ error: "Image upload failed" }, 400);
    }
  }
  
  // 画像取得
  if (req.method === "GET" && pathname === "/api/image") {
    const id = url.searchParams.get("id");
    if (!id) return jsonResponse({ error: "Image ID required" }, 400);
    const image = (await kv.get<Image>(["image", id])).value;
    if (!image) return jsonResponse({ error: "Image not found" }, 404);
    const binary = Uint8Array.from(atob(image.data), c => c.charCodeAt(0));
    return new Response(binary, { headers: { "Content-Type": image.contentType, ...SECURITY_HEADERS } });
  }
  
  return textResponse("Not Found", 404);
}

export default { fetch: handler };
