import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

// VPNチェックAPI：proxycheck.ioを利用
async function isUsingVPN(req: Request): Promise<boolean> {
  // クライアントIPをヘッダから取得（Deno Deployでは "x-forwarded-for" が利用可能）
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
  const url = `https://proxycheck.io/v2/${ip}?vpn=1`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error("VPN APIリクエスト失敗");
      return false;
    }
    const data = await response.json();
    // レスポンス例：{ "クライアントIP": { "proxy": "yes" | "no", ... }, "status": "ok" }
    const ipData = data[ip];
    if (ipData && ipData.proxy === "yes") {
      return true;
    }
  } catch (e) {
    console.error("VPNチェック中のエラー:", e);
  }
  return false;
}

// 捨てメアドチェックAPI：Disifyを利用
async function isDisposableEmail(email: string): Promise<boolean> {
  try {
    const url = `https://disify.com/${encodeURIComponent(email)}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error("Disify APIリクエスト失敗");
      return false;
    }
    const data = await response.json();
    // レスポンス例：{ disposable: true | false, ... }
    return data.disposable;
  } catch (e) {
    console.error("捨てメアドチェック中のエラー:", e);
    return false;
  }
}

// 認証ページのHTML（背景画像、左上に「Kokusan_1」とフォームを配置）
function renderFormPage(): Response {
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Kokusan_1 認証ページ</title>
  <style>
    body {
      margin: 0;
      height: 100vh;
      background: url("https://i.pinimg.com/736x/85/50/ba/8550baecf1af87bd845ba38bf6dea821.jpg") no-repeat center center fixed;
      background-size: cover;
      font-family: sans-serif;
      color: white;
    }
    .header {
      position: absolute;
      top: 20px;
      left: 20px;
      font-size: 2em;
    }
    .form-container {
      background: rgba(0, 0, 0, 0.5);
      padding: 20px;
      border-radius: 8px;
      margin-top: 10px;
    }
    input, button {
      font-size: 1em;
    }
  </style>
</head>
<body>
  <div class="header">
    Kokusan_1
    <div class="form-container">
      <form method="POST" action="/">
        <label for="email">メールアドレス:</label><br>
        <input type="email" id="email" name="email" required><br><br>
        <button type="submit">認証</button>
      </form>
    </div>
  </div>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    return renderFormPage();
  } else if (req.method === "POST") {
    // VPNチェック（外部APIを利用）
    if (await isUsingVPN(req)) {
      return new Response("VPN接続は許可されていません", { status: 403 });
    }
    // フォームデータの取得
    const formData = await req.formData();
    const email = formData.get("email")?.toString() || "";
    
    // 捨てメアドチェック（外部APIを利用）
    if (await isDisposableEmail(email)) {
      return new Response("捨てメアドは使用できません", { status: 400 });
    }
    
    // ここに追加の認証処理等を実装可能です
    return new Response("認証成功", { status: 200 });
  }
  return new Response("Not Found", { status: 404 });
}

serve(handler);
