import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Deno Deploy KV をオープン
const kv = await Deno.openKv();

// 接続中の WebSocket クライアントを管理するセット
const clients = new Set<WebSocket>();

// 全クライアントへデータをブロードキャスト
function broadcast(data: string, exclude?: WebSocket) {
  for (const client of clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// オンラインユーザー一覧を全クライアントに更新通知
function broadcastUpdateUsers() {
  const users: string[] = [];
  for (const client of clients) {
    if ((client as any).authenticated && (client as any).username) {
      users.push((client as any).username);
    }
  }
  const updateMsg = JSON.stringify({ type: "update_users", users });
  broadcast(updateMsg);
}

// HTML 部分：  
// ・ログイン画面はユーザー名入力のみ  
// ・チャット画面はサイドバーにオンラインユーザー一覧を表示し、各ユーザーをクリックするとその相手とのダイレクトメッセージ画面に切り替え  
// ・画像アップロードボタン付き、フェードインアニメーション・丸み・ホバーエフェクトなどでリッチな見た目に
const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Rich DM Chat</title>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;">
  <style>
    body {
      margin: 0;
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      background: linear-gradient(135deg, #2c3e50, #4ca1af);
      color: #ecf0f1;
      overflow: hidden;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    #loading {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: rgba(0,0,0,0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2rem;
      z-index: 1000;
      animation: fadeIn 0.5s ease-out;
    }
    #login, .container {
      animation: fadeIn 0.5s ease-out;
    }
    #login {
      position: fixed;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      background-color: rgba(0,0,0,0.85);
      padding: 20px;
      border-radius: 12px;
      z-index: 100;
      min-width: 300px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    }
    .container {
      display: flex;
      height: 100vh;
      border-radius: 10px;
      overflow: hidden;
      margin: 20px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    }
    .sidebar {
      width: 240px;
      background-color: rgba(44,62,80,0.95);
      padding: 15px;
      border-top-left-radius: 10px;
      border-bottom-left-radius: 10px;
    }
    .chat {
      flex: 1;
      display: flex;
      flex-direction: column;
      background-color: rgba(52,73,94,0.95);
      border-top-right-radius: 10px;
      border-bottom-right-radius: 10px;
    }
    .header {
      padding: 15px;
      background-color: rgba(52,73,94,1);
      border-bottom: 1px solid rgba(236,240,241,0.2);
    }
    .messages {
      flex: 1;
      padding: 15px;
      overflow-y: auto;
    }
    .input {
      padding: 15px;
      background-color: rgba(52,73,94,1);
      display: flex;
      gap: 10px;
      border-top: 1px solid rgba(236,240,241,0.2);
    }
    input, button {
      padding: 10px;
      font-size: 1rem;
      border: none;
      border-radius: 8px;
      outline: none;
      transition: background-color 0.2s ease;
    }
    input {
      flex: 1;
    }
    button {
      background-color: #3498db;
      color: white;
      cursor: pointer;
    }
    button:hover {
      background-color: #2980b9;
    }
    .message {
      margin-bottom: 10px;
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(236,240,241,0.1);
      animation: fadeIn 0.3s ease-out;
    }
    .message.system {
      font-style: italic;
      color: #bdc3c7;
      text-align: center;
    }
    .friend-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .friend-list li {
      margin-bottom: 8px;
      padding: 6px;
      border-radius: 6px;
      background: rgba(236,240,241,0.1);
      cursor: pointer;
      transition: background 0.2s;
    }
    .friend-list li:hover {
      background: rgba(236,240,241,0.2);
    }
    .friend-list li.selected {
      background: rgba(236,240,241,0.3);
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div id="loading">Loading...</div>
  <div id="login">
    <h2>ログイン</h2>
    <input id="username" placeholder="ユーザー名を入力" />
    <button id="loginBtn">ログイン</button>
  </div>
  <div class="container" id="chatContainer" style="display:none;">
    <div class="sidebar">
      <h3>オンラインユーザー</h3>
      <ul id="friendList" class="friend-list"></ul>
      <hr>
      <input type="file" id="imageInput" accept="image/*" />
      <button id="uploadBtn">画像をアップロード</button>
    </div>
    <div class="chat">
      <div class="header">
        <h2 id="chatHeader">チャットルーム</h2>
      </div>
      <div class="messages" id="messages"></div>
      <div class="input">
        <input id="messageInput" placeholder="メッセージを入力 (/coinflip でコイン投げ)" />
        <button id="sendBtn">送信</button>
      </div>
    </div>
  </div>
  <script>
    let ws;
    let myUsername = "";
    let selectedFriend = "";
    let dmMessages = [];
    
    // ロード完了後、loading 画面をフェードアウト
    window.onload = () => {
      const loading = document.getElementById('loading');
      loading.style.transition = 'opacity 0.5s ease-out';
      loading.style.opacity = '0';
      setTimeout(() => { loading.style.display = 'none'; }, 500);
    };
    
    const usernameInput = document.getElementById('username');
    document.getElementById('loginBtn').onclick = () => {
      const username = usernameInput.value.trim();
      if (!username) {
        alert("ユーザー名を入力してください");
        return;
      }
      myUsername = username;
      ws = new WebSocket(location.origin.replace(/^http/, 'ws') + "/ws");
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "login", username }));
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "login_success") {
          document.getElementById('login').style.display = 'none';
          document.getElementById('chatContainer').style.display = 'flex';
          addSystemMessage("ログインに成功しました");
        } else if (msg.type === "direct") {
          dmMessages.push({ from: msg.from, to: msg.to, text: msg.text, timestamp: Date.now() });
          // もし現在選択中の相手との会話なら更新
          if (selectedFriend && ((msg.from === selectedFriend && msg.to === myUsername) || (msg.from === myUsername && msg.to === selectedFriend))) {
            updateChatWindow();
          }
        } else if (msg.type === "system") {
          addSystemMessage(msg.text);
        } else if (msg.type === "image") {
          dmMessages.push({ from: msg.username, to: (msg.username === myUsername ? selectedFriend : myUsername), text: "[画像]", image: msg.url, timestamp: Date.now() });
          if (selectedFriend && ((msg.username === selectedFriend) || (msg.username === myUsername))) {
            updateChatWindow();
          }
        } else if (msg.type === "update_users") {
          updateFriendList(msg.users);
        } else if (msg.type === "error") {
          alert(msg.message);
        }
      };
      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
      };
    };
    
    function sendMessage() {
      if (!selectedFriend) {
        alert("チャット相手を選択してください");
        return;
      }
      const input = document.getElementById('messageInput');
      const text = input.value.trim();
      if (text && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "direct", to: selectedFriend, text }));
        input.value = "";
      }
    }
    
    document.getElementById('sendBtn').onclick = sendMessage;
    document.getElementById('messageInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
    
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
          ws.send(JSON.stringify({ type: "image", url: data.url, to: selectedFriend }));
        }
      } catch (err) {
        console.error("画像アップロードエラー:", err);
      }
    };
    
    function addMessageElement(from, text, imageUrl) {
      const messagesDiv = document.getElementById('messages');
      const messageElement = document.createElement('div');
      messageElement.className = 'message';
      if (from === myUsername) {
        messageElement.style.textAlign = 'right';
      }
      if (imageUrl) {
        const nameDiv = document.createElement('div');
        nameDiv.textContent = from + ":";
        const img = document.createElement('img');
        img.src = imageUrl;
        img.style.maxWidth = "300px";
        img.style.display = "block";
        img.style.borderRadius = "8px";
        messageElement.appendChild(nameDiv);
        messageElement.appendChild(img);
      } else {
        messageElement.textContent = from + ": " + text;
      }
      messagesDiv.appendChild(messageElement);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
    
    function addSystemMessage(text) {
      const messagesDiv = document.getElementById('messages');
      const messageElement = document.createElement('div');
      messageElement.className = 'message system';
      messageElement.textContent = text;
      messagesDiv.appendChild(messageElement);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
    
    function updateChatWindow() {
      const messagesDiv = document.getElementById('messages');
      messagesDiv.innerHTML = "";
      dmMessages.forEach(msg => {
        if ((msg.from === selectedFriend && msg.to === myUsername) ||
            (msg.from === myUsername && msg.to === selectedFriend)) {
          addMessageElement(msg.from, msg.text, msg.image);
        }
      });
    }
    
    function updateFriendList(users) {
      const friendList = document.getElementById('friendList');
      friendList.innerHTML = "";
      users.forEach(user => {
        if (user === myUsername) return;
        const li = document.createElement('li');
        li.textContent = user;
        li.onclick = () => {
          selectedFriend = user;
          updateChatWindow();
          const lis = friendList.getElementsByTagName("li");
          for (let i = 0; i < lis.length; i++) {
            lis[i].classList.remove("selected");
          }
          li.classList.add("selected");
          document.getElementById("chatHeader").textContent = "チャット: " + user;
        };
        friendList.appendChild(li);
      });
    }
  </script>
</body>
</html>`;

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

// WebSocket ハンドラ：ユーザー管理およびダイレクトメッセージ処理
async function handleWebSocket(socket: WebSocket, req: Request) {
  socket.onopen = () => {
    console.log("WebSocket 接続確立");
    (socket as any).authenticated = false;
  };
  socket.onmessage = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === "login") {
        (async () => {
          const username = typeof data.username === "string" ? data.username.trim() : "";
          if (!username || username.length > 20) {
            socket.send(JSON.stringify({ type: "error", message: "ユーザー名が無効です" }));
            socket.close();
            return;
          }
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
          broadcast(JSON.stringify({ type: "system", text: username + " が参加しました" }));
          broadcastUpdateUsers();
          console.log(username, "がログインしました");
        })().catch((err) => {
          console.error(err);
          socket.send(JSON.stringify({ type: "error", message: "内部エラーが発生しました" }));
          socket.close();
        });
      } else if (data.type === "direct") {
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
        let target = data.to;
        if (!target) {
          socket.send(JSON.stringify({ type: "error", message: "送信先が指定されていません" }));
          return;
        }
        const message = { type: "direct", from: (socket as any).username, to: target, text };
        let delivered = false;
        for (const client of clients) {
          if ((client as any).username === target && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
            delivered = true;
          }
        }
        socket.send(JSON.stringify(message));
        if (!delivered) {
          socket.send(JSON.stringify({ type: "error", message: target + " はオンラインではありません" }));
        }
      } else if (data.type === "image") {
        if (!(socket as any).authenticated) {
          socket.send(JSON.stringify({ type: "error", message: "ログインしてください" }));
          return;
        }
        if (!rateLimit(socket)) {
          socket.send(JSON.stringify({ type: "error", message: "送信が速すぎます" }));
          return;
        }
        let target = data.to;
        if (!target) {
          socket.send(JSON.stringify({ type: "error", message: "送信先が指定されていません" }));
          return;
        }
        const imageMsg = { type: "image", username: (socket as any).username, to: target, url: data.url };
        let delivered = false;
        for (const client of clients) {
          if ((client as any).username === target && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(imageMsg));
            delivered = true;
          }
        }
        socket.send(JSON.stringify(imageMsg));
        if (!delivered) {
          socket.send(JSON.stringify({ type: "error", message: target + " はオンラインではありません" }));
        }
      }
    } catch (err) {
      console.error("メッセージ処理中のエラー:", err);
      socket.send(JSON.stringify({ type: "error", message: "メッセージ処理中にエラーが発生しました" }));
    }
  };
  socket.onclose = () => {
    if ((socket as any).username) {
      broadcast(JSON.stringify({ type: "system", text: (socket as any).username + " が退出しました" }));
    }
    clients.delete(socket);
    broadcastUpdateUsers();
    console.log("WebSocket 切断");
  };
  socket.onerror = (e) => {
    console.error("WebSocket エラー", e);
  };
}

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
  const buf = await file.arrayBuffer();
  const uint8Array = new Uint8Array(buf);
  let binary = "";
  for (const byte of uint8Array) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  const imageId = crypto.randomUUID();
  await kv.set(["image", imageId], { content: base64, contentType: file.type, timestamp: Date.now() });
  return new Response(JSON.stringify({ id: imageId, url: "/image?id=" + imageId }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleGetImage(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return new Response("IDが指定されていません", { status: 400 });
  const res = await kv.get(["image", id]);
  if (!res.value) return new Response("Not Found", { status: 404 });
  const { content, contentType } = res.value as { content: string; contentType: string };
  const binaryStr = atob(content);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new Response(bytes, { headers: { "Content-Type": contentType } });
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;
  if (pathname === "/ws") {
    const origin = req.headers.get("origin") || "";
    if (!origin.startsWith("https://") && !origin.startsWith("http://localhost")) {
      return new Response("Forbidden", { status: 403 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleWebSocket(socket, req);
    return response;
  }
  if (pathname === "/upload") {
    return await handleUpload(req);
  }
  if (pathname === "/image") {
    return await handleGetImage(req);
  }
  if (pathname === "/") {
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return new Response("Not Found", { status: 404 });
}

console.log("サーバー起動中 http://localhost:8000");
serve(handler);
