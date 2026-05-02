(function attachAudienceRepositoryApi(window) {
  const authHelpers = window.authHelpers || {};

  function getFunctionName() {
    return 'audience-repository';
  }

  async function request(method, body, query) {
    if (typeof authHelpers.fetchFunctionJson !== 'function') {
      throw new Error('缺少 authHelpers.fetchFunctionJson');
    }
    const { data } = await authHelpers.fetchFunctionJson(getFunctionName(), {
      method,
      body,
      query,
      includePromptAdminToken: true,
      useSessionToken: true,
      unauthorizedMessage: '登录状态已失效，请重新登录后再试。',
      onUnauthorized: () => {
        if (typeof authHelpers.handleReauthRequired === 'function') {
          authHelpers.handleReauthRequired({
            source: 'audience_repository',
            targetUrl: window.location.href,
            reason: 'audience_repository_reauth_required',
            message: '登录状态已失效，正在跳转重新登录...',
          });
        }
      },
    });
    return data;
  }

  function fetchList(query) {
    return request('GET', undefined, query || {});
  }

  function importAudiences(payload) {
    return request('POST', Object.assign({ action: 'import' }, payload));
  }

  function deleteAudience(audienceId) {
    return request('POST', { action: 'delete', audience_id: audienceId });
  }

  window.AudienceRepositoryApi = {
    fetchList,
    importAudiences,
    deleteAudience,
  };
})(window);
