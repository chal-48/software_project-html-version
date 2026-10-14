(() => {
  const requiredRole = document.currentScript?.dataset.role;
  try {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    const payload = token ? JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) : null;
    if (!user || !payload || payload.exp * 1000 <= Date.now()) throw new Error('Session expired');
    if (requiredRole && user.role !== requiredRole) {
      window.location.replace(user.role === 'driver' ? '../driver/index.html' : '../index.html');
    }
  } catch {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.replace('../login.html');
  }
})();
