/* ============================================================
 * 岁岁·时光纪念馆 — 零依赖流式 ZIP 引擎
 * ------------------------------------------------------------
 * SuisuiZipWriter : ZIP STORE (Method 0) 流式打包，含 CRC32。
 *                   图片/音频本身已压缩，二次 deflate 只会让手机 OOM。
 * SuisuiZipReader : 免解压随机切片读取。只读 EOCD + Central Directory
 *                   建索引，按需 file.slice() 取单条目，支持 STORE 与
 *                   DEFLATE (via DecompressionStream)。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- CRC32 ---------------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes, crc) {
    crc = (crc === undefined) ? 0xFFFFFFFF : (crc ^ 0xFFFFFFFF);
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  var te = new TextEncoder();
  var td = new TextDecoder();

  /* ---------------- ZIP Writer (STORE only) ----------------
   * Usage:
   *   var w = new SuisuiZipWriter();
   *   w.add('data/archive.json', jsonString);           // string -> utf8
   *   w.add('media/x.png', uint8ArrayOrArrayBufferOrBlobPromise);
   *   var blob = await w.finalize();                    // returns Blob
   * --------------------------------------------------------- */
  function SuisuiZipWriter() {
    this.entries = [];      // {name, blob, crc, size, source}
    this.parts = [];        // ordered Uint8Array/Blob chunks (local headers + data)
    this.offset = 0;
    this.totalBytes = 0;    // 已 add 的文件原始字节总数（供分卷判断实时读取）
    this.sealed = false;    // finalize 之后禁止再 add
  }

  SuisuiZipWriter.prototype._flushMeta = function () {
    /* 把已 add 的条目元数据定稿到 manifest：未 finalize 也能拿到 size/crc */
    this.entriesSnapshot = this.entries.map(function (e) { return { name: e.name, size: e.size || 0, crc: e.crc || 0 }; });
  };

  SuisuiZipWriter.prototype._push = function (part) {
    this.parts.push(part);
    this.offset += part.byteLength != null ? part.byteLength : (part.size != null ? part.size : (part.length || 0));
    /* 万级文件时散装 Uint8Array 会让 new Blob(parts) 卡死 WebView：
     * 每攒 200 个 chunk 先收敛成一个 Blob，保证 parts 数量级恒定在几百以内。 */
    if (this.parts.length >= 200) {
      this.parts = [new Blob(this.parts)];
    }
  };

  function u16(v) { return new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF]); }
  function u32(v) { return new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]); }
  function concat(list) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].length;
    var out = new Uint8Array(total), p = 0;
    for (i = 0; i < list.length; i++) { out.set(list[i], p); p += list[i].length; }
    return out;
  }

  // data: string | Uint8Array | ArrayBuffer | Blob | Promise<...>
  // 立即算 CRC 并把原始字节包进 Blob，绝不把 Uint8Array 挂在 entry 上，
  // 让调用方的大 buffer 立刻可被 GC（万级媒体文件时不至于撑爆 JS 堆）。
  SuisuiZipWriter.prototype.add = function (name, data) {
    if (this.sealed) throw new Error('该 ZIP 卷已经封盘，请新建 SuisuiZipWriter');
    if (this.entries.length >= 65535) {
      throw new Error('ZIP 条目数超过 65535，无法生成标准备份包');
    }
    var raw = null;
    if (data instanceof Uint8Array) raw = data;
    else if (data instanceof ArrayBuffer) raw = new Uint8Array(data);
    else if (typeof data === 'string') raw = te.encode(data);
    var entry = { name: String(name), blob: null, crc: 0, size: 0, source: null };
    if (raw) {
      entry.crc = crc32(raw);
      entry.size = raw.byteLength;
      entry.blob = new Blob([raw]);
      raw = null; // 立刻放开引用
    } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
      entry.blob = data;
      entry.source = data;
    } else {
      entry.source = data;
    }
    if (entry.size) this.totalBytes += entry.size;
    this.entries.push(entry);
  };

  SuisuiZipWriter.prototype._resolve = function (d) {
    if (d instanceof Uint8Array) return Promise.resolve(d);
    if (d instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(d));
    if (typeof d === 'string') return Promise.resolve(te.encode(d));
    if (d && typeof d.arrayBuffer === 'function') {
      return d.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }
    if (d && typeof d.then === 'function') return d.then(this._resolve.bind(this));
    return Promise.resolve(te.encode(String(d)));
  };

  // DOS date/time from a Date
  function dosDateTime(d) {
    var time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
    var date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F);
    return { time: time, date: date };
  }

  SuisuiZipWriter.prototype.finalize = function () {
    var self = this;
    if (this.entries.length > 65535) {
      return Promise.reject(new Error('ZIP 条目数超过 65535，无法生成标准备份包'));
    }
    var now = dosDateTime(new Date());
    var central = [];

    function prepareEntry(e) {
      if (!e.source) return Promise.resolve(e);
      if (e.source && typeof e.source.arrayBuffer === 'function') {
        return e.source.arrayBuffer().then(function (buf) {
          var bytes = new Uint8Array(buf);
          e.crc = crc32(bytes);
          e.size = bytes.byteLength;
          self.totalBytes += e.size;
          e.source = null;
          return e;
        });
      }
      return self._resolve(e.source).then(function (bytes) {
        e.crc = crc32(bytes);
        e.size = bytes.byteLength;
        self.totalBytes += e.size;
        e.blob = new Blob([bytes]);
        e.source = null;
        return e;
      });
    }

    function buildEntry(e) {
      return prepareEntry(e).then(function () {
        var nameBytes = te.encode(e.name);
        var localOffset = self.offset;

        // ---- Local File Header (30 bytes + name) ----
        // 合并 lh 与文件名成一个 Uint8Array，配合 _push 的 200-chunk 收敛，
        // 最终喂给 new Blob() 的 part 数保持在几百以内（万级文件防 WebView 卡死）。
        var lh = concat([
          u32(0x04034b50),          // signature
          u16(20),                  // version needed
          u16(0x0800),              // flags: UTF-8 name (bit 11)
          u16(0),                   // method 0 = STORE
          u16(now.time), u16(now.date),
          u32(e.crc),
          u32(e.size),              // compressed = uncompressed
          u32(e.size),
          u16(nameBytes.length),
          u16(0)                    // extra len
        ]);
        self._push(concat([lh, nameBytes]));
        self._push(e.blob);

        // ---- Central Directory record ----
        var cd = concat([
          u32(0x02014b50),
          u16(20),                  // version made by
          u16(20),                  // version needed
          u16(0x0800),
          u16(0),
          u16(now.time), u16(now.date),
          u32(e.crc),
          u32(e.size),
          u32(e.size),
          u16(nameBytes.length),
          u16(0), u16(0),           // extra, comment
          u16(0), u16(0),           // disk, internal attr
          u32(0),                   // external attr
          u32(localOffset),
          nameBytes
        ]);
        central.push(cd);
      });
    }

    // sequential to bound memory
    var p = Promise.resolve();
    this.entries.forEach(function (e) { p = p.then(function () { return buildEntry(e); }); });

    return p.then(function () {
      var cdOffset = self.offset;
      central.forEach(function (c) { self._push(c); });
      var cdSize = self.offset - cdOffset;
      var count = self.entries.length;
      var eocd = concat([
        u32(0x06054b50),
        u16(0), u16(0),
        u16(count), u16(count),
        u32(cdSize), u32(cdOffset),
        u16(0)
      ]);
      self._push(eocd);
      var blob = new Blob(self.parts, { type: 'application/zip' });
      self.parts = null;
      self.entries = [];
      self.sealed = true;
      return blob;
    });
  };

  /* ---------------- ZIP Reader (免解压随机读) ----------------
   * var r = new SuisuiZipReader(fileOrFileArray); // File / Blob / File[]
   * await r.load();                               // parse EOCD + CD（多文件自动合并索引）
   * r.list();                                     // [{name,offset,size,method}]
   * var json = await r.readJSON('data/archive.json');
   * var url  = await r.objectURL('media/a.png', 'image/png');
   *
   * v1.3.0 分卷协议：传入同一 exportId 的多个分卷文件时，各卷中央目录合并成
   * 一张索引（同名后卷覆盖先卷），media/* 条目按各自所在的卷文件切片读取。
   * 卷 manifest（manifest.json）中的 exportId/vol 供合并校验。
   * --------------------------------------------------------- */
  function SuisuiZipReader(file) {
    if (file && typeof file.length === 'number' && typeof file.slice !== 'function') {
      this.files = Array.prototype.slice.call(file); // FileList / File[]
    } else if (Array.isArray(file)) {
      this.files = file.slice();
    } else {
      this.files = file ? [file] : [];
    }
    this.file = this.files[0] || null; // 兼容旧字段
    this.index = Object.create(null); // name -> {file, offset, csize, usize, method, crc}
    this.names = [];
    this.volumes = [];                // [{exportId, vol, totalVols, accountKey}]
  }

  SuisuiZipReader.prototype.load = function () {
    var self = this;
    if (!this.files.length) return Promise.reject(new Error('没有选择备份包文件'));
    /* 逐卷解析中央目录并合并索引；同一 exportId 的多卷文件顺序无关，
     * 同名条目后载入的卷覆盖先载入的（索引卷放最后，天然覆盖媒体卷残留）。 */
    var chain = Promise.resolve();
    this.files.forEach(function (file) {
      chain = chain.then(function () { return self._loadOne(file); });
    });
    return chain.then(function () { return self; });
  };

  SuisuiZipReader.prototype._loadOne = function (file) {
    var self = this;
    var tailSize = Math.min(file.size, 22 + 65535); // EOCD + max comment
    return file.slice(file.size - tailSize, file.size).arrayBuffer().then(function (buf) {
      var dv = new DataView(buf);
      // scan backwards for EOCD signature 0x06054b50
      var pos = -1;
      for (var i = buf.byteLength - 22; i >= 0; i--) {
        if (dv.getUint32(i, true) === 0x06054b50) {
          var commentLen = dv.getUint16(i + 20, true);
          var actualEocdOffset = (file.size - tailSize) + i;
          if (actualEocdOffset + 22 + commentLen === file.size) {
            pos = i;
            break;
          }
        }
      }
      if (pos < 0) throw new Error('不是有效的 ZIP 文件（找不到目录表或文件尾损坏）');
      var count = dv.getUint16(pos + 10, true);
      var cdSize = dv.getUint32(pos + 12, true);
      var cdOffset = dv.getUint32(pos + 16, true);
      return file.slice(cdOffset, cdOffset + cdSize).arrayBuffer().then(function (cdbuf) {
        var cdv = new DataView(cdbuf);
        var p = 0;
        for (var n = 0; n < count; n++) {
          if (cdv.getUint32(p, true) !== 0x02014b50) break;
          var method = cdv.getUint16(p + 10, true);
          var csize = cdv.getUint32(p + 20, true);
          var usize = cdv.getUint32(p + 24, true);
          var nlen = cdv.getUint16(p + 28, true);
          var elen = cdv.getUint16(p + 30, true);
          var clen = cdv.getUint16(p + 32, true);
          var lho = cdv.getUint32(p + 42, true);
          var name = td.decode(new Uint8Array(cdbuf, p + 46, nlen));
          var entryCrc = cdv.getUint32(p + 16, true);
          if (!self.index[name]) self.names.push(name);
          self.index[name] = { file: file, offset: lho, csize: csize, usize: usize, method: method, crc: entryCrc };
          p += 46 + nlen + elen + clen;
        }
        /* 读取卷 manifest 记录 exportId / vol，供调用方校验卷齐不齐 */
        if (self.index['manifest.json'] && self.index['manifest.json'].file === file) {
          return self.readBytes('manifest.json').then(function (bytes) {
            try {
              var mf = JSON.parse(td.decode(bytes));
              if (mf && (mf.exportId || mf.vol != null)) {
                self.volumes.push({ exportId: mf.exportId || '', vol: String(mf.vol || ''), accountKey: mf.accountKey || '' });
              }
            } catch (e) {}
          }).catch(function () {});
        }
      });
    });
  };

  SuisuiZipReader.prototype.list = function () {
    var self = this;
    return this.names.map(function (n) {
      var e = self.index[n];
      return { name: n, size: e.usize, method: e.method };
    });
  };

  // slice the raw (possibly compressed) payload of an entry
  SuisuiZipReader.prototype._rawSlice = function (name) {
    var e = this.index[name];
    if (!e) return Promise.reject(new Error('包内未找到 ' + name));
    var file = e.file || this.file;
    // read local header to find data start (nameLen/extraLen may differ from CD)
    return file.slice(e.offset, e.offset + 30).arrayBuffer().then(function (h) {
      var dv = new DataView(h);
      if (dv.getUint32(0, true) !== 0x04034b50) throw new Error('ZIP 条目头损坏: ' + name);
      var nlen = dv.getUint16(26, true), elen = dv.getUint16(28, true);
      var dataStart = e.offset + 30 + nlen + elen;
      return file.slice(dataStart, dataStart + e.csize).arrayBuffer().then(function (b) {
        return { buf: b, entry: e };
      });
    });
  };

  SuisuiZipReader.prototype.readBytes = function (name) {
    return this._rawSlice(name).then(function (r) {
      if (r.entry.method === 0) return new Uint8Array(r.buf);
      if (r.entry.method === 8 && typeof DecompressionStream !== 'undefined') {
        var ds = new DecompressionStream('deflate-raw');
        var stream = new Blob([r.buf]).stream().pipeThrough(ds);
        return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
      }
      return Promise.reject(new Error('不支持的压缩方式 method=' + r.entry.method));
    }).then(function (bytes) {
      var entry = this.index[name];
      if (!entry) throw new Error('包内未找到 ' + name);
      if (bytes.byteLength !== entry.usize) {
        throw new Error('备份包文件损坏：' + name + ' 解压长度校验失败');
      }
      if (crc32(bytes) !== entry.crc) {
        throw new Error('备份包文件损坏：' + name + ' CRC32 校验失败');
      }
      return bytes;
    }.bind(this));
  };

  SuisuiZipReader.prototype.readText = function (name) {
    return this.readBytes(name).then(function (b) { return td.decode(b); });
  };

  SuisuiZipReader.prototype.readJSON = function (name) {
    return this.readText(name).then(function (t) { return JSON.parse(t); });
  };

  SuisuiZipReader.prototype.objectURL = function (name, mime) {
    return this.readBytes(name).then(function (b) {
      return URL.createObjectURL(new Blob([b], { type: mime || 'application/octet-stream' }));
    });
  };

  SuisuiZipReader.prototype.has = function (name) { return !!this.index[name]; };

  /* --------------------------------------------------------- */
  global.SuisuiZipWriter = SuisuiZipWriter;
  global.SuisuiZipReader = SuisuiZipReader;
  global.__suisuiCrc32 = crc32;
})(typeof window !== 'undefined' ? window : this);
