// 飞书登录检查 - 全站通用
(function() {
    var helpers = window.authHelpers || {};
    if (!helpers.getSessionState || !helpers.redirectToLogin) {
        console.error('Missing auth helpers. Please load assets/js/auth-helpers.js before auth.js');
        return;
    }

    var state = helpers.getSessionState(window.location.pathname);
    if (state.isAuthenticated) {
        localStorage.setItem('feishu_user', JSON.stringify(state.user));
        return;
    }

    helpers.clearUserSession();
    if (!state.backendSession) {
        localStorage.removeItem('prompt_admin_reason');
    }

    helpers.redirectToLogin({
        targetUrl: state.path + window.location.search + window.location.hash,
        clearPromptAdmin: true,
    });
})();
