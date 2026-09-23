// 认证服务（v1 §2/§3）：DrissionPage 扫码登录 + /api/v4/me 验证，验证通过才写统一凭据库
import { getCookies, setCookies, loadStore } from './credentials.js';

const ME_URL = 'https://www.zhihu.com/api/v4/me';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// 用给定 cookie 串调 /api/v4/me 验证
export async function validateCookieString(cookieStr) {
  try {
    const resp = await fetch(ME_URL, {
      headers: { Cookie: cookieStr, 'User-Agent': UA },
      signal: AbortSignal.timeout(10000)
    });
    if (resp.status === 200) {
      const data = await resp.json();
      return { ok: true, user: { id: String(data.id ?? ''), name: data.name || '' } };
    }
    return { ok: false, info: `HTTP ${resp.status}` };
  } catch (e) {
    return { ok: false, info: `${e?.name || 'Error'}: ${e?.message || e}` };
  }
}

// 用当前凭据库验证
export async function validateCurrent() {
  const cookies = getCookies();
  const entries = Object.entries(cookies);
  if (!entries.length) return { ok: false, info: '凭据库为空' };
  return validateCookieString(entries.map(([k, v]) => `${k}=${v}`).join('; '));
}

// 浏览器登录：DrissionPage（Python 侧 login.py 已实现同样逻辑）。
// MCP 进程内不直接跑浏览器，改为引导用户运行 login.py，或从已有登录页 cookie 导入。
// 这里提供 DrissionPage 不可用时的说明 + 对已登录浏览器 cookie 的拉取（DevTools 协议直连）。
export async function browserLogin() {
  // 异步 spawn python login.py（扫码窗口最长 6 分钟）——绝不能 execFileSync，会冻结 HTTP event loop
  const { spawn } = await import('child_process');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const spiderDir = path.resolve(__dirname, '..');

  // login.py 是交互式（重登录要 stdin 确认），超时前用户扫码成功即正常退出
  const output = await new Promise((resolve, reject) => {
    const child = spawn('python', ['login.py'], { cwd: spiderDir, windowsHide: true });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('login.py 超时（360s）未完成扫码')); }, 360000);
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`python 启动失败: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`login.py 退出码 ${code}（未完成登录）`));
    });
  });

  try {
    // login.py 验证通过后已直写统一凭据库（sync_credentials_store）；此处读回验证并补全 user
    const fs = await import('fs');
    const cfgPath = path.join(spiderDir, 'config.json');
    let ok = false, user = null;
    if (fs.existsSync(cfgPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const cookies = {};
        for (const pair of (cfg.cookie || '').split(';')) {
          const i = pair.indexOf('=');
          if (i > 0) cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
        }
        if (Object.keys(cookies).length) {
          setCookies(cookies, { user: null, validated_at: null, replace: true });
          const v = await validateCurrent();
          if (v.ok) {
            setCookies({}, { user: v.user, validated_at: new Date().toISOString() });
            ok = true;
            user = v.user;
          }
        }
      } catch { /* fallthrough */ }
    }
    return { ok, user, output: output.slice(-800) };
  } catch (e) {
    return { ok: false, info: `login.py 执行失败: ${e.message?.slice(0, 200)}` };
  }
}
