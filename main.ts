import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Deno Deploy KV をオープン
const kv = await Deno.openKv();

// 接続中の WebSocket クライアントを管理するセット
const clients = new Set<WebSocket>();

// 中央アカウント（ユーザー名が「国産第1号」）を返す
function getCentral(): WebSocket | null {
  for (const client of clients) {
    if ((client as any).username === "国産第1号" && client.readyState === WebSocket.OPEN) {
      return client;
    }
  }
  return null;
}

// HTML（Discord にインスパイアされた UI、背景・ロード画面・画像アップロードボタン付き）
const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>国産第1号</title>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';">
  <style>
    /* 背景は Unsplash のランダム画像（またはお好みのものに変更可能） */
    body { margin: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: url('https://source.unsplash.com/random/1920x1080') no-repeat center center fixed; background-size: cover; color: white; }
    /* ロード画面 */
    #loading { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; font-size: 2rem; z-index: 1000; }
    /* ログイン・チャット UI */
    .container { display: flex; height: 100vh; }
    .sidebar { width: 240px; background-color: rgba(32,34,37,0.9); padding: 10px; }
    .chat { flex: 1; display: flex; flex-direction: column; background-color: rgba(47,49,54,0.9); }
    .header { padding: 10px; background-color: rgba(47,49,54,0.95); }
    .messages { flex: 1; padding: 10px; overflow-y: auto; }
    .input { padding: 10px; background-color: rgba(47,49,54,0.95); display: flex; gap: 5px; }
    input, button { padding: 5px; font-size: 1rem; }
    #login { position: absolute; top: 0; left: 0; right: 0; bottom: 0;
             background-color: rgba(0,0,0,0.85); display: flex; justify-content: center; align-items: center; flex-direction: column; z-index: 100; }
    .hint { font-size: 0.8rem; color: #b9bbbe; margin-top: 5px; }
  </style>
</head>
<body>
  <!-- ロード画面 -->
  <div id="loading">Loading...</div>
  <!-- ログイン画面 -->
  <div id="login">
    <h2>ログイン</h2>
    <input id="username" placeholder="ユーザー名" />
    <input id="friendcode" placeholder="フレンドコード" />
    <button id="loginBtn">ログイン</button>
    <p>フレンドコードは「国産第1号」です。<br>※これ以外ではチャットできません。</p>
  </div>
  <!-- チャット画面 -->
  <div class="container" id="chatContainer" style="display:none;">
    <div class="sidebar">
      <h3>フレンドリスト</h3>
      <ul id="friendList">
        <li>国産第1号</li>
      </ul>
      <hr>
      <!-- 画像アップロード -->
      <input type="file" id="imageInput" accept="image/*" />
      <button id="uploadBtn">Upload Image</button>
    </div>
    <div class="chat">
      <div class="header">
        <h2>チャットルーム</h2>
      </div>
      <div class="messages" id="messages"></div>
      <div class="input">
        <input id="messageInput" placeholder="メッセージを入力... (/coinflipでコイン投げ)" style="flex:1;" />
        <button id="sendBtn">送信</button>
      </div>
    </div>
  </div>
  <script>
    // ロード画面非表示
    window.onload = () => {
      document.getElementById('loading').style.display = 'none';
    };
    let ws;
    const usernameInput = document.getElementById('username');
    const friendcodeInput = document.getElementById('friendcode');
    document.getElementById('loginBtn').onclick = () => {
      const username = usernameInput.value.trim();
      const friendcode = friendcodeInput.value.trim();
      if (friendcode !== "国産第1号") {
        alert("フレンドコードが正しくありません");
        return;
      }
      // WebSocket 接続（HTTP→WS へ変換）
      ws = new WebSocket(location.origin.replace(/^http/, 'ws') + "/ws");
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "login", username, friend: friendcode }));
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "login_success") {
          document.getElementById('login').style.display = 'none';
          document.getElementById('chatContainer').style.display = 'flex';
          addMessage("システム", "ログインに成功しました");
        } else if (msg.type === "message") {
          addMessage(msg.username, msg.text);
        } else if (msg.type === "system") {
          addMessage("システム", msg.text);
        } else if (msg.type === "image") {
          addImageMessage(msg.username, msg.url);
        } else if (msg.type === "error") {
          alert(msg.message);
        }
      };
      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
      };
    };
    document.getElementById('sendBtn').onclick = sendMessage;
    document.getElementById('messageInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
    function sendMessage() {
      const input = document.getElementById('messageInput');
      const text = input.value.trim();
      if (text && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "message", text }));
        input.value = "";
      }
    }
    // 画像アップロード処理
    document.getElementById('uploadBtn').onclick = async () => {
      const fileInput = document.getElementById('imageInput');
      if (fileInput.files.length === 0) {
        alert("アップロードする画像を選択してください");
        return;
      }
      const file = fileInput.files[0];
      const formData = new FormData();
      formData.append("image", file);
      try {
        const res = await fetch("/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (data.url) {
          // 画像アップロード完了後、WebSocket 経由で画像メッセージを送信
          ws.send(JSON.stringify({ type: "image", url: data.url }));
        }
      } catch (err) {
        console.error("画像アップロードエラー:", err);
      }
    };
    function addMessage(username, text) {
      const messagesDiv = document.getElementById('messages');
      const messageElement = document.createElement('div');
      messageElement.textContent = username + ": " + text;
      messagesDiv.appendChild(messageElement);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
    function addImageMessage(username, url) {
      const messagesDiv = document.getElementById('messages');
      const container = document.createElement('div');
      const name = document.createElement('div');
      name.textContent = username + ":";
      const img = document.createElement('img');
      img.src = url;
      img.style.maxWidth = "300px";
      img.style.display = "block";
      container.appendChild(name);
      container.appendChild(img);
      messagesDiv.appendChild(container);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  </script>
</body>
</html>`;

// rate limit: 1秒以内の連続送信を防止
function rateLimit(socket: WebSocket, limitMs: number = 1000): boolean {
  const now = Date.now();
  if (!((socket as any).lastMessageTime)) {
    (socket as any).lastMessageTime = 0;
  }
  if (now - (socket as any).lastMessageTime < limitMs) {
    return false;
  }
  (socket as any).lastMessageTime = now;
  return true;
}

// WebSocket ハンドラ（ユーザー管理は KV を利用）
async function handleWebSocket(socket: WebSocket, req: Request) {
  socket.onopen = () => {
    console.log("WebSocket 接続確立");
    (socket as any).authenticated = false;
  };
  socket.onmessage = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === "login") {
        // 非同期処理で KV を利用したユーザー管理
        (async () => {
          const username = typeof data.username === "string" ? data.username.trim() : "";
          if (!username || username.length > 20) {
            socket.send(JSON.stringify({ type: "error", message: "ユーザー名が無効です" }));
            socket.close();
            return;
          }
          if (data.friend !== "国産第1号") {
            socket.send(JSON.stringify({ type: "error", message: "フレンドコードが正しくありません" }));
            socket.close();
            return;
          }
          // 中央アカウントの場合、既に接続中なら拒否
          if (username === "国産第1号") {
            if (getCentral()) {
              socket.send(JSON.stringify({ type: "error", message: "中央アカウントは既に接続中です" }));
              socket.close();
              return;
            }
          }
          // KV でユーザー情報を取得・登録（存在しなければ新規作成、あれば最終ログイン時刻を更新）
          const key = ["user", username];
          const userRec = await kv.get(key);
          if (!userRec.value) {
            await kv.set(key, { username, created: Date.now() });
          } else {
            await kv.set(key, { ...userRec.value, lastLogin: Date.now() });
          }
          (socket as any).authenticated = true;
          (socket as any).username = username;
          (socket as any).lastMessageTime = Date.now();
          clients.add(socket);
          socket.send(JSON.stringify({ type: "login_success" }));
          console.log(username, "がログインしました");
        })().catch((err) => {
          console.error(err);
          socket.send(JSON.stringify({ type: "error", message: "内部エラーが発生しました" }));
          socket.close();
        });
      } else if (data.type === "message") {
        if (!(socket as any).authenticated) {
          socket.send(JSON.stringify({ type: "error", message: "ログインしてください" }));
          return;
        }
        if (!rateLimit(socket)) {
          socket.send(JSON.stringify({ type: "error", message: "メッセージ送信が速すぎます" }));
          return;
        }
        let text = typeof data.text === "string" ? data.text.trim() : "";
        if (text.length === 0 || text.length > 500) {
          socket.send(JSON.stringify({ type: "error", message: "メッセージの長さが無効です" }));
          return;
        }
        // 追加機能：/coinflip コマンド
        if (text.startsWith("/coinflip")) {
          const result = Math.random() < 0.5 ? "Heads" : "Tails";
          const sysMsg = { type: "system", text: (socket as any).username + " のコイン投げ結果: " + result };
          if ((socket as any).username === "国産第1号") {
            // 中央からの送信なら全友達へ
            for (const client of clients) {
              if ((client as any).username !== "国産第1号" && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(sysMsg));
              }
            }
          } else {
            // 友達からは中央へ送信し、送信者にもエコー
            const central = getCentral();
            if (central && central.readyState === WebSocket.OPEN) {
              central.send(JSON.stringify(sysMsg));
              socket.send(JSON.stringify(sysMsg));
            } else {
              socket.send(JSON.stringify({ type: "error", message: "中央アカウント（国産第1号）が接続されていません" }));
            }
          }
          return;
        }
        // 通常のテキストメッセージ処理
        const message = { type: "message", username: (socket as any).username, text };
        if ((socket as any).username === "国産第1号") {
          // 中央からのメッセージは全友達へ
          for (const client of clients) {
            if ((client as any).username !== "国産第1号" && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(message));
            }
          }
        } else {
          // 友達からのメッセージは中央へ送信し、送信者にエコー
          const central = getCentral();
          if (central && central.readyState === WebSocket.OPEN) {
            central.send(JSON.stringify(message));
            socket.send(JSON.stringify(message));
          } else {
            socket.send(JSON.stringify({ type: "error", message: "中央アカウント（国産第1号）が接続されていません" }));
          }
        }
      } else if (data.type === "image") {
        // 画像メッセージもテキストメッセージ同様のルールで送信
        if (!(socket as any).authenticated) {
          socket.send(JSON.stringify({ type: "error", message: "ログインしてください" }));
          return;
        }
        if (!rateLimit(socket)) {
          socket.send(JSON.stringify({ type: "error", message: "送信が速すぎます" }));
          return;
        }
        const imageMsg = { type: "image", username: (socket as any).username, url: data.url };
        if ((socket as any).username === "国産第1号") {
          for (const client of clients) {
            if ((client as any).username !== "国産第1号" && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(imageMsg));
            }
          }
        } else {
          const central = getCentral();
          if (central && central.readyState === WebSocket.OPEN) {
            central.send(JSON.stringify(imageMsg));
            socket.send(JSON.stringify(imageMsg));
          } else {
            socket.send(JSON.stringify({ type: "error", message: "中央アカウント（国産第1号）が接続されていません" }));
          }
        }
      }
    } catch (err) {
      console.error("メッセージ処理中のエラー:", err);
      socket.send(JSON.stringify({ type: "error", message: "メッセージ処理中にエラーが発生しました" }));
    }
  };
  socket.onclose = () => {
    clients.delete(socket);
    console.log("WebSocket 切断");
  };
  socket.onerror = (e) => {
    console.error("WebSocket エラー", e);
  };
}

// 画像アップロードエンドポイント（POST /upload）
async function handleUpload(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const formData = await req.formData();
  const file = formData.get("image");
  if (!file || !(file instanceof File)) {
    return new Response("画像がアップロードされていません", { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return new Response("不正なファイル形式です", { status: 400 });
  }
  // ファイル内容を ArrayBuffer として取得し、base64 化
  const buf = await file.arrayBuffer();
  const uint8Array = new Uint8Array(buf);
  // base64 エンコード
  let binary = "";
  for (const byte of uint8Array) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  // 一意な ID を生成して KV に保存
  const imageId = crypto.randomUUID();
  await kv.set(["image", imageId], { content: base64, contentType: file.type, timestamp: Date.now() });
  // アップロード完了時は画像取得用の URL を返す
  return new Response(JSON.stringify({ id: imageId, url: "/image?id=" + imageId }), {
    headers: { "Content-Type": "application/json" },
  });
}

// 画像取得エンドポイント（GET /image?id=...）
async function handleGetImage(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return new Response("IDが指定されていません", { status: 400 });
  const res = await kv.get(["image", id]);
  if (!res.value) return new Response("Not Found", { status: 404 });
  const { content, contentType } = res.value as { content: string; contentType: string };
  // base64 から Uint8Array へ変換
  const binaryStr = atob(content);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new Response(bytes, { headers: { "Content-Type": contentType } });
}

// メインハンドラ
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // WebSocket 接続：Origin ヘッダー検査（HTTPS からのアクセスのみ許可）
  if (pathname === "/ws") {
    const origin = req.headers.get("origin") || "";
    if (!origin.startsWith("https://") && !origin.startsWith("http://localhost")) {
      return new Response("Forbidden", { status: 403 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleWebSocket(socket, req);
    return response;
  }

  // 画像アップロード（POST /upload）
  if (pathname === "/upload") {
    return await handleUpload(req);
  }

  // 画像取得（GET /image）
  if (pathname === "/image") {
    return await handleGetImage(req);
  }

  // ルートパス：HTML を返す
  if (pathname === "/") {
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return new Response("Not Found", { status: 404 });
}

console.log("サーバー起動中 http://localhost:8000");
serve(handler);
