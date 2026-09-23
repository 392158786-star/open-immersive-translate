(function () {
  "use strict";

  var g = globalThis;
  var doc = g.document;
  var storage = g.sessionStorage;
  var fetchFn = g.fetch;
  var TOKEN_KEY = "cloud-demo-api-token";
  var $ = function (id) { return doc.getElementById(id); };

  var tokenInput = $("api-token");
  var tokenStatus = $("token-status");
  var saveTokenBtn = $("save-token");
  var refreshHealthBtn = $("refresh-health");
  var refreshStatsBtn = $("refresh-stats");
  var refreshRequestsBtn = $("refresh-requests");
  var translateForm = $("translate-form");
  var sourceText = $("source-text");
  var fromLang = $("from-lang");
  var toLang = $("to-lang");
  var serviceId = $("service-id");
  var translateSubmit = $("translate-submit");
  var resultRequestId = $("result-request-id");
  var resultTargetText = $("result-target-text");
  var resultCacheLayer = $("result-cache-layer");
  var resultLatency = $("result-latency");
  var cacheRedisHits = $("cache-redis-hits");
  var cacheRdsHits = $("cache-rds-hits");
  var cacheUpstreamRequests = $("cache-upstream-requests");
  var cacheTotalMemory = $("cache-total-memory");
  var cacheTotalHits = $("cache-total-hits");
  var cacheTotalRequests = $("cache-total-requests");
  var requestsLimit = $("requests-limit");
  var requestsTbody = $("requests-tbody");
  var healthApi = $("health-api");
  var healthRds = $("health-rds");
  var healthRedis = $("health-redis");
  var lastError = $("last-error");

  function getToken() {
    try {
      return storage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function setToken(value) {
    try {
      if (value) {
        storage.setItem(TOKEN_KEY, value);
      } else {
        storage.removeItem(TOKEN_KEY);
      }
    } catch {
      // sessionStorage 不可用时静默降级
    }
  }

  function authHeaders() {
    var token = getToken();
    if (!token) return {};
    return { Authorization: "Bearer " + token };
  }

  function showError(message) {
    lastError.textContent = message || "";
  }

  function request(method, url, body) {
    var headers = authHeaders();
    var init = { method: method, headers: headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetchFn(url, init).then(function (resp) {
      if (resp.ok) {
        return resp.json();
      }
      return resp.text().then(function (text) {
        throw new Error("HTTP " + resp.status + ": " + text);
      });
    });
  }

  function setHealthPill(el, status, label) {
    el.textContent = label + ": " + status;
    el.className = "health-pill " + status;
  }

  function refreshHealth() {
    request("GET", "/health")
      .then(function (report) {
        setHealthPill(healthApi, report.checks.api.status, "API");
        setHealthPill(healthRds, report.checks.rds.status, "RDS");
        setHealthPill(healthRedis, report.checks.redis.status, "Redis");
        showError("");
      })
      .catch(function (err) {
        showError("健康检查失败: " + err.message);
      });
  }

  function refreshStats() {
    request("GET", "/v1/stats")
      .then(function (stats) {
        cacheRedisHits.textContent = String(stats.redisHits);
        cacheRdsHits.textContent = String(stats.rdsHits);
        cacheUpstreamRequests.textContent = String(stats.upstreamRequests);
        cacheTotalMemory.textContent = String(stats.totalMemory);
        cacheTotalHits.textContent = String(stats.totalHits);
        cacheTotalRequests.textContent = String(stats.totalRequests);
        showError("");
      })
      .catch(function (err) {
        showError("统计查询失败: " + err.message);
      });
  }

  function refreshRequests() {
    var limit = parseInt(requestsLimit.value, 10) || 20;
    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;
    request("GET", "/v1/requests?limit=" + limit)
      .then(function (data) {
        var items = data.items || [];
        if (items.length === 0) {
          requestsTbody.innerHTML =
            '<tr><td colspan="8">暂无记录</td></tr>';
          return;
        }
        var rows = items.map(function (item) {
          return (
            "<tr>" +
            "<td>" + escapeHtml(item.createdAt) + "</td>" +
            "<td>" + escapeHtml(item.requestId) + "</td>" +
            "<td>" + escapeHtml(item.fromLang) + "</td>" +
            "<td>" + escapeHtml(item.toLang) + "</td>" +
            "<td>" + escapeHtml(item.cacheLayer) + "</td>" +
            "<td>" + escapeHtml(String(item.latencyMs)) + "</td>" +
            "<td>" + escapeHtml(item.status) + "</td>" +
            "<td>" + escapeHtml(item.errorCode || "") + "</td>" +
            "</tr>"
          );
        });
        requestsTbody.innerHTML = rows.join("");
        showError("");
      })
      .catch(function (err) {
        showError("调用记录查询失败: " + err.message);
      });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function submitTranslate(event) {
    event.preventDefault();
    var text = sourceText.value;
    if (!text) {
      showError("请输入源文本");
      return;
    }
    translateSubmit.disabled = true;
    var body = {
      text: text,
      from: fromLang.value || "en",
      to: toLang.value || "zh",
    };
    if (serviceId.value) {
      body.serviceId = serviceId.value;
    }
    request("POST", "/v1/translate", body)
      .then(function (result) {
        resultRequestId.textContent = result.requestId || "—";
        resultTargetText.textContent = result.targetText || "—";
        resultCacheLayer.textContent = result.cacheLayer || "—";
        resultLatency.textContent =
          typeof result.latencyMs === "number"
            ? result.latencyMs + " ms"
            : "—";
        showError("");
        refreshStats();
        refreshRequests();
      })
      .catch(function (err) {
        showError("翻译失败: " + err.message);
        resultTargetText.textContent = "—";
      })
      .then(function () {
        translateSubmit.disabled = false;
      });
  }

  function saveToken() {
    setToken(tokenInput.value);
    updateTokenStatus();
  }

  function updateTokenStatus() {
    tokenStatus.textContent = getToken() ? "已保存到会话" : "未保存";
  }

  saveTokenBtn.addEventListener("click", saveToken);
  refreshHealthBtn.addEventListener("click", refreshHealth);
  refreshStatsBtn.addEventListener("click", refreshStats);
  refreshRequestsBtn.addEventListener("click", refreshRequests);
  translateForm.addEventListener("submit", submitTranslate);

  tokenInput.value = getToken();
  updateTokenStatus();
  refreshHealth();
  refreshStats();
  refreshRequests();
})();
