(() => {
  const applyTheme = () => {
    try {
      const saved = window.localStorage.getItem('landing-theme');
      document.body.dataset.theme = saved === 'dark' ? 'dark' : 'light';
    } catch {
      document.body.dataset.theme = 'light';
    }
  };

  applyTheme();
  window.addEventListener('storage', (event) => {
    if (event.key === 'landing-theme') applyTheme();
  });
})();
