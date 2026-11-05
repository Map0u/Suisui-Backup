'use strict';
var crypto = require('crypto');
var BASE_URL = 'https://suisui666.cn/treehole/';
var STATIC_SALT = '1a92e8977af72a433ecb389f';
var ALLOWED_MEDIA_HOSTS = ['suisui666.cn', 'myqcloud.com', 'aliyuncs.com', 'suisuiapp.com', 'iflytek.com'];
function isAllowedMediaHost(hostname) {
  var h = String(hostname || '').toLowerCase();
  return ALLOWED_MEDIA_HOSTS.some(function (domain) { return h === domain || h.endsWith('.' + domain); });
}
function headers(token, mobile, deviceId) {
  var ts = String(Date.now());
  var devId = deviceId || 'suisui_web_' + crypto.createHash('md5').update(String(token || mobile || 'guest')).digest('hex').slice(0, 16);
  var sign = crypto.createHash('md5').update(devId + ts + STATIC_SALT, 'utf8').digest('hex');
  var result = { 'Content-Type': 'application/json', lang: 'zh', deviceId: devId, ts: ts, version: '5.6', sign: sign };
  if (token) result.token = token;
  return result;
}
module.exports = { BASE_URL: BASE_URL, STATIC_SALT: STATIC_SALT, headers: headers, ALLOWED_MEDIA_HOSTS: ALLOWED_MEDIA_HOSTS, isAllowedMediaHost: isAllowedMediaHost, isConfigured: function () { return true; } };
