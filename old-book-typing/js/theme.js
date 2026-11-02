/* 하위 페이지용 테마 전환 (본 화면은 app.js 가 처리) */
(() => {
  const KEY = 'yetgeulja.v2';
  const read = () => { try{ return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }catch(e){ return {}; } };
  const btn = document.getElementById('themeBtn');
  function apply(){
    const s = read().settings || {};
    const dark = s.theme ? s.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    if(btn) btn.textContent = dark ? '☀️' : '🌙';
  }
  if(btn) btn.addEventListener('click', () => {
    const data = read();
    data.settings = Object.assign({}, data.settings, { theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' });
    try{ localStorage.setItem(KEY, JSON.stringify(data)); }catch(e){}
    apply();
  });
  apply();
})();
