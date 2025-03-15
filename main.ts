import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

// VPNチェックAPI：proxycheck.ioを利用（無料プラン）
async function isUsingVPN(req: Request): Promise<boolean> {
  // Deno Deployでは x-forwarded-for ヘッダによりクライアントIPを取得可能
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
  const url = `https://proxycheck.io/v2/${ip}?vpn=1`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error("VPN APIリクエスト失敗");
      return false;
    }
    const data = await response.json();
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
    return data.disposable;
  } catch (e) {
    console.error("捨てメアドチェック中のエラー:", e);
    return false;
  }
}

// モダンな認証ページのHTMLを返す関数
function renderFormPage(): Response {
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Kokusan_1 認証ページ</title>
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: 'Roboto', sans-serif;
      background: url("https://i.pinimg.com/736x/85/50/ba/8550baecf1af87bd845ba38bf6dea821.jpg") no-repeat center center fixed;
      background-size: cover;
      position: relative;
      height: 100vh;
      color: #333;
    }
    /* ダークオーバーレイ */
    .overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      z-index: 1;
    }
    /* 左上のロゴ */
    .header {
      position: absolute;
      top: 20px;
      left: 20px;
      z-index: 2;
      color: #fff;
      font-size: 2rem;
      font-weight: 700;
    }
    /* フォームを中央に配置 */
    .form-wrapper {
      position: relative;
      z-index: 2;
      height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .auth-form {
      background: rgba(255, 255, 255, 0.95);
      padding: 30px;
      border-radius: 12px;
      width: 320px;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
      text-align: center;
    }
    .auth-form h2 {
      margin-top: 0;
      margin-bottom: 20px;
      color: #007BFF;
    }
    .form-group {
      margin-bottom: 20px;
      text-align: left;
    }
    .form-group label {
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
    }
    .form-group input {
      width: 100%;
      padding: 12px;
      border: 1px solid #ccc;
      border-radius: 6px;
      font-size: 1rem;
    }
    .auth-form button {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 6px;
      background-color: #007BFF;
      color: #fff;
      font-size: 1rem;
      cursor: pointer;
      transition: background-color 0.3s ease;
    }
    .auth-form button:hover {
      background-color: #0056b3;
    }
  </style>
</head>
<body>
  <div class="overlay"></div>
  <div class="header">
    Kokusan_1
  </div>
  <div class="form-wrapper">
    <form class="auth-form" method="POST" action="/">
      <h2>認証</h2>
      <div class="form-group">
        <label for="email">メールアドレス</label>
        <input type="email" id="email" name="email" placeholder="メールアドレスを入力" required>
      </div>
      <button type="submit">認証する</button>
    </form>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    return renderFormPage();
  } else if (req.method === "POST") {
    // VPNチェック
    if (await isUsingVPN(req)) {
      return new Response("VPN接続は許可されていません", { status: 403 });
    }
    // フォームデータの取得
    const formData = await req.formData();
    const email = formData.get("email")?.toString() || "";
    
    // 捨てメアドチェック
    if (await isDisposableEmail(email)) {
      return new Response("捨てメアドは使用できません", { status: 400 });
    }
    // 認証成功時のレスポンス
    return new Response("認証成功", { status: 200 });
  }
  return new Response("Not Found", { status: 404 });
}

serve(handler);
