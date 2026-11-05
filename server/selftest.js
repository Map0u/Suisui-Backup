/* ZIP 引擎自测（Node 环境，无 DOM）。验证 STORE 打包 + EOCD/CD 解析 + 按偏移切片还原。 */
'use strict';
var fs = require('fs');
var path = require('path');

// 最小 DOM shim，让 zip-engine.js 能在 Node 里加载
global.window = global;
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;
global.Blob = require('buffer').Blob;
global.Uint8Array = Uint8Array;

require(path.join(__dirname, '..', 'public', 'js', 'zip-engine.js'));

var W = global.SuisuiZipWriter;
var crc32 = global.__suisuiCrc32;

var w = new W();
w.add('data/archive.json', JSON.stringify({ hello: '岁岁', n: 42 }));
w.add('data/archive_bridge.js', 'window.__SUISUI_ARCHIVE__ = { hello: "岁岁" };');
w.add('README-如何查看我的回忆.txt', '测试说明');
w.add('media/a.png', new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5]));

w.finalize().then(function (blob) {
  return blob.arrayBuffer();
}).then(function (buf) {
  var bytes = new Uint8Array(buf);
  console.log('zip bytes:', bytes.length);

  // 找 EOCD
  var dv = new DataView(buf);
  var pos = -1;
  for (var i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { pos = i; break; }
  }
  if (pos < 0) throw new Error('EOCD not found');
  var count = dv.getUint16(pos + 10, true);
  var cdSize = dv.getUint32(pos + 12, true);
  var cdOffset = dv.getUint32(pos + 16, true);
  console.log('entries:', count, 'cdOffset:', cdOffset, 'cdSize:', cdSize);
  if (count !== 4) throw new Error('entry count mismatch: ' + count);

  // 解析 central directory，按偏移切片还原 data/archive.json
  var td = new TextDecoder();
  var p = cdOffset;
  var found = null;
  for (var n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad CD sig');
    var method = dv.getUint16(p + 10, true);
    var crc = dv.getUint32(p + 16, true);
    var csize = dv.getUint32(p + 20, true);
    var nlen = dv.getUint16(p + 28, true);
    var elen = dv.getUint16(p + 30, true);
    var clen = dv.getUint16(p + 32, true);
    var lho = dv.getUint32(p + 42, true);
    var name = td.decode(bytes.subarray(p + 46, p + 46 + nlen));
    if (method !== 0) throw new Error('expected STORE, got ' + method);
    if (name === 'data/archive.json') found = { lho: lho, csize: csize, crc: crc };
    p += 46 + nlen + elen + clen;
  }
  if (!found) throw new Error('archive.json not indexed');

  // 读 local header 拿数据起点
  var nlen2 = dv.getUint16(found.lho + 26, true);
  var elen2 = dv.getUint16(found.lho + 28, true);
  var dataStart = found.lho + 30 + nlen2 + elen2;
  var payload = bytes.subarray(dataStart, dataStart + found.csize);
  var text = td.decode(payload);
  console.log('archive.json restored:', text);
  if (crc32(payload) !== found.crc) throw new Error('CRC mismatch');
  var obj = JSON.parse(text);
  if (obj.hello !== '岁岁' || obj.n !== 42) throw new Error('content mismatch');

  console.log('SELFTEST PASS');
}).catch(function (e) {
  console.error('SELFTEST FAIL:', e);
  process.exit(1);
});
