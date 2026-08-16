export function parseWebAddress(value: string): URL {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("内置浏览器仅支持 HTTP 或 HTTPS 地址。");
  if (url.username || url.password) throw new Error("出于安全考虑，网址中不能包含用户名或密码。");
  return url;
}
